"""Describes one output file as JSON for the device test matrix (tests/e2e/matrix.js).

Prints {"type", "width", "height", "durationMs", "channels", "frames", "loop", "pages", "encrypted",
"title", "error"}: whatever applies to the file. "type" comes from the file's own bytes, not its name.
Needs: pip install pillow pillow-heif tinytag hachoir pypdf
"""
import json
import re
import sys

path = sys.argv[1]
data = open(path, "rb").read()
info = {"size": len(data)}


def magic(b):
    if b[:3] == b"\xff\xd8\xff":
        return "jpg"
    if b[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if b[:4] == b"RIFF" and b[8:12] == b"WEBP":
        return "webp"
    if b[:4] == b"RIFF" and b[8:12] == b"WAVE":
        return "wav"
    if b[:4] == b"RIFF" and b[8:12] == b"AVI ":
        return "avi"
    if b[:2] == b"BM":
        return "bmp"
    if b[:4] in (b"II*\x00", b"MM\x00*"):
        return "tiff"
    if b[:4] == b"\x00\x00\x01\x00":
        return "ico"
    if b[:4] == b"GIF8":
        return "gif"
    if b[:4] == b"%PDF":
        return "pdf"
    if b[:4] == b"fLaC":
        return "flac"
    if b[:4] == b"OggS":
        return "ogg"
    if b[:4] == b"\x1a\x45\xdf\xa3":
        return "webm" if b"webm" in b[:64] else "mkv"
    if b[4:8] == b"ftyp":
        brand = b[8:12]
        if brand.startswith(b"qt"):
            return "mov"
        if brand.startswith((b"M4A", b"M4B")):
            return "m4a"
        if brand.startswith((b"heic", b"heix", b"mif1", b"avif")):
            return "heif"
        return "mp4"
    if b[:3] == b"ID3" or (b[0] == 0xFF and (b[1] & 0xE0) == 0xE0 and (b[1] & 0x06) != 0):
        return "mp3"
    if b[0] == 0xFF and (b[1] & 0xF6) == 0xF0:
        return "aac"
    if b[:2] == b"PK":
        return "zip"
    return "unknown"


info["type"] = magic(data)
try:
    if info["type"] in ("jpg", "png", "webp", "bmp", "tiff", "ico", "gif", "heif"):
        from PIL import Image
        import pillow_heif

        pillow_heif.register_heif_opener()
        with Image.open(path) as image:
            info["width"], info["height"] = image.size
            info["frames"] = getattr(image, "n_frames", 1)
            if info["type"] == "gif":
                info["loop"] = image.info.get("loop")
                info["colors"] = len(image.getcolors(256) or []) if info["frames"] == 1 else None
            info["mode"] = image.mode
            # Personal metadata only: GPS, camera make and model, date, the EXIF block. TIFF always has
            # structural tags (size, compression) in the same table, which are not personal.
            personal = {0x8825, 0x010F, 0x0110, 0x0132, 0x8769, 0x9003}
            info["exif"] = bool(personal & set(image.getexif().keys()))
    elif info["type"] in ("mp3", "m4a", "aac", "ogg", "wav", "flac"):
        from tinytag import TinyTag

        tag = TinyTag.get(path)
        info["durationMs"] = round((tag.duration or 0) * 1000)
        info["channels"] = tag.channels
        info["title"] = tag.title
        info["artist"] = tag.artist
        info["album"] = tag.album
        info["year"] = tag.year
        info["bitrate"] = round(tag.bitrate or 0)
        if info["type"] == "aac":
            # tinytag guesses a raw AAC (ADTS) file's length from its first frame. Count the frames instead:
            # each holds 1024 samples.
            rates = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350]
            offset = frames = 0
            rate = 44100
            while offset + 7 <= len(data) and data[offset] == 0xFF and (data[offset + 1] & 0xF6) == 0xF0:
                rate = rates[(data[offset + 2] >> 2) & 0xF]
                info["channels"] = ((data[offset + 2] & 1) << 2) | (data[offset + 3] >> 6)
                length = ((data[offset + 3] & 3) << 11) | (data[offset + 4] << 3) | (data[offset + 5] >> 5)
                if length < 7:
                    break
                frames += 1
                offset += length
            info["durationMs"] = round(frames * 1024 / rate * 1000)
    elif info["type"] in ("mp4", "mov", "mkv", "webm", "avi"):
        from hachoir.metadata import extractMetadata
        from hachoir.parser import createParser

        with createParser(path) as parser:
            meta = extractMetadata(parser)
        values = {}
        for group in [meta] + list(getattr(meta, "iterGroups", lambda: [])()):
            for item in group:
                if item.values and item.key not in values:
                    values[item.key] = item.values[0].value
        info["width"] = values.get("width")
        info["height"] = values.get("height")
        duration = values.get("duration")
        info["durationMs"] = round(duration.total_seconds() * 1000) if duration else None
        info["hasAudio"] = bool(re.search(rb"soun|A_OPUS|A_AAC|A_VORBIS|auds", data[:4_000_000] + data[-4_000_000:]))
        info["gps"] = b"\xa9xyz" in data or b"location" in data[:200000]
    elif info["type"] == "pdf":
        # A real parser: pdf-lib keeps page objects in compressed object streams, invisible to a text search.
        from pypdf import PdfReader

        reader = PdfReader(path)
        info["encrypted"] = reader.is_encrypted
        if reader.is_encrypted:
            info["pages"] = len(re.findall(rb"/Type\s*/Page[^s]", data)) or None
            info["rotations"] = []
        else:
            info["pages"] = len(reader.pages)
            info["rotations"] = [page.rotation for page in reader.pages]
except Exception as error:  # noqa: BLE001 - any parse failure is reported, not raised
    info["error"] = f"{type(error).__name__}: {error}"

print(json.dumps(info, default=str))
