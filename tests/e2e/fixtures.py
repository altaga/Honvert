"""Builds the input files for the device test matrix (tests/e2e/matrix.js) into the given folder.

Every file is synthetic: gradients, tones and generated pages, never anyone's photos or recordings.
Needs: pip install pillow pillow-heif lameenc
Usage: python tests/e2e/fixtures.py <out-folder>
"""
import io
import math
import os
import struct
import sys
import wave
import zipfile

from PIL import Image, ImageDraw

out = sys.argv[1]
os.makedirs(out, exist_ok=True)
path = lambda name: os.path.join(out, name)


def picture(width, height, alpha=False):
    image = Image.new("RGBA" if alpha else "RGB", (width, height))
    draw = ImageDraw.Draw(image)
    for x in range(0, width, 4):
        draw.rectangle([x, 0, x + 3, height], fill=(x * 255 // width, 120, 255 - x * 255 // width, 255 if not alpha else 90 + x * 160 // width))
    # An arrow in the top-left corner shows rotation and mirroring at a glance.
    draw.polygon([(20, 20), (width // 3, 20), (width // 3, height // 6), (20, height // 6)], fill=(255, 255, 255, 255))
    draw.polygon([(width // 3, 5), (width // 3 + height // 8, height // 12 + 12), (width // 3, height // 6 + 15)], fill=(255, 220, 0, 255))
    return image


base = picture(1600, 1200)
base.save(path("photo.jpg"), quality=90)
picture(800, 600, alpha=True).save(path("photo.png"))
base.save(path("photo.webp"), quality=85)
base.save(path("photo.bmp"))
base.save(path("photo.tiff"))
base.save(path("photo.avif"), quality=70)
import pillow_heif  # noqa: E402

pillow_heif.register_heif_opener()
base.save(path("photo.heic"), quality=80)

# EXIF orientation 6: stored landscape, shown portrait. The app must turn it upright.
exif = Image.Exif()
exif[0x0112] = 6
base.save(path("photo-exif6.jpg"), quality=90, exif=exif.tobytes())

# 35 MP. FFmpeg reads the JPG at full size; the WEBP goes through Android's decoder, which keeps to a 24 MP
# budget, so its result must be downscaled with a note.
huge = picture(7000, 5000)
huge.save(path("huge.jpg"), quality=70)
huge.save(path("huge.webp"), quality=60)

frames = [picture(320, 240).rotate(angle * 18) for angle in range(20)]
frames[0].save(path("anim.gif"), save_all=True, append_images=frames[1:], duration=80, loop=0)

# Six seconds of a stereo tone that rises, so trims and speed changes are measurable.
rate, seconds = 44100, 6
samples = []
for i in range(rate * seconds):
    left = int(9000 * math.sin(2 * math.pi * (300 + i / rate * 80) * i / rate))
    right = int(6000 * math.sin(2 * math.pi * 520 * i / rate))
    samples.append(struct.pack("<hh", left, right))
with wave.open(path("tone.wav"), "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(rate)
    w.writeframes(b"".join(samples))

import lameenc  # noqa: E402

encoder = lameenc.Encoder()
encoder.set_bit_rate(128)
encoder.set_in_sample_rate(rate)
encoder.set_channels(2)
encoder.set_quality(2)
mp3 = encoder.encode(b"".join(samples)) + encoder.flush()
open(path("tone.mp3"), "wb").write(mp3)


def pdf(name, pages, size=(595, 842)):
    images = []
    for page in range(pages):
        image = Image.new("RGB", size, "white")
        draw = ImageDraw.Draw(image)
        draw.rectangle([40, 40, size[0] - 40, 140], fill=(30, 90, 200))
        draw.text((60, 70), f"{name} page {page + 1}", fill="white")
        images.append(image)
    images[0].save(path(name), save_all=True, append_images=images[1:])


pdf("doc3.pdf", 3)
pdf("doc2.pdf", 2)


def avi(name, width, height, fps, seconds):
    """A small AVI: MJPEG frames and 16-bit stereo PCM, written by hand so no encoder is needed."""
    jpegs = []
    for index in range(fps * seconds):
        frame = picture(width, height)
        ImageDraw.Draw(frame).rectangle([index * width // (fps * seconds), height - 60, index * width // (fps * seconds) + 50, height - 10], fill=(255, 40, 40))
        buffer = io.BytesIO()
        frame.save(buffer, "JPEG", quality=80)
        jpegs.append(buffer.getvalue())
    audio_per_frame = rate // fps
    pcm = b"".join(samples)[: rate * seconds * 4]

    def chunk(fourcc, payload):
        return fourcc + struct.pack("<I", len(payload)) + payload + (b"\x00" if len(payload) % 2 else b"")

    def lst(kind, payload):
        return b"LIST" + struct.pack("<I", len(payload) + 4) + kind + payload

    frames_total = len(jpegs)
    largest = max(len(j) for j in jpegs)
    avih = struct.pack("<IIIIIIIIIIIIII", 1_000_000 // fps, 0, 0, 0x10, frames_total, 0, 2, largest, width, height, 0, 0, 0, 0)
    vstrh = struct.pack("<4s4sIHHIIIIIIIIhhhh", b"vids", b"MJPG", 0, 0, 0, 0, 1, fps, 0, frames_total, largest, 0xFFFFFFFF, 0, 0, 0, width, height)
    vstrf = struct.pack("<IiiHH4sIiiII", 40, width, height, 1, 24, b"MJPG", width * height * 3, 0, 0, 0, 0)
    astrh = struct.pack("<4s4sIHHIIIIIIIIhhhh", b"auds", b"\x00\x00\x00\x00", 0, 0, 0, 0, 4, rate * 4, 0, len(pcm) // 4, rate * 4, 0xFFFFFFFF, 4, 0, 0, 0, 0)
    astrf = struct.pack("<HHIIHH", 1, 2, rate, rate * 4, 4, 16)
    hdrl = lst(b"hdrl", chunk(b"avih", avih) + lst(b"strl", chunk(b"strh", vstrh) + chunk(b"strf", vstrf)) + lst(b"strl", chunk(b"strh", astrh) + chunk(b"strf", astrf)))
    movi_body = b""
    index_entries = b""
    for i, jpeg in enumerate(jpegs):
        offset = len(movi_body) + 4
        movi_body += chunk(b"00dc", jpeg)
        index_entries += struct.pack("<4sIII", b"00dc", 0x10, offset, len(jpeg))
        piece = pcm[i * audio_per_frame * 4 : (i + 1) * audio_per_frame * 4]
        offset = len(movi_body) + 4
        movi_body += chunk(b"01wb", piece)
        index_entries += struct.pack("<4sIII", b"01wb", 0x10, offset, len(piece))
    body = b"AVI " + hdrl + lst(b"movi", movi_body) + chunk(b"idx1", index_entries)
    open(path(name), "wb").write(b"RIFF" + struct.pack("<I", len(body)) + body)


# 1280x720, 4 seconds, with sound: the source for the video and audio-extraction tests.
avi("clip.avi", 1280, 720, 10, 4)

# Damaged files for the repair tool: cut short, or with a broken structure.
open(path("cut.jpg"), "wb").write(open(path("photo.jpg"), "rb").read()[:-4000])
open(path("cut.png"), "wb").write(open(path("photo.png"), "rb").read()[:-3000])
open(path("cut.gif"), "wb").write(open(path("anim.gif"), "rb").read()[:-500])
open(path("cut.mp3"), "wb").write(mp3[: len(mp3) * 2 // 3])
doc = open(path("doc3.pdf"), "rb").read()
open(path("badxref.pdf"), "wb").write(doc.replace(b"startxref", b"startxref\n999999\n%%junk", 1))
zipped = io.BytesIO()
with zipfile.ZipFile(zipped, "w", zipfile.ZIP_DEFLATED) as archive:
    archive.writestr("readme.txt", "Honvert test archive\n" * 200)
    archive.writestr("data/numbers.csv", "\n".join(str(n) for n in range(5000)))
open(path("cut.zip"), "wb").write(zipped.getvalue()[:-60])
docx = io.BytesIO()
with zipfile.ZipFile(docx, "w", zipfile.ZIP_DEFLATED) as archive:
    archive.writestr("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>')
    archive.writestr("word/document.xml", "<w:document>" + "<w:p>text</w:p>" * 500 + "</w:document>")
open(path("cut.docx"), "wb").write(docx.getvalue()[:-40])
# Junk in front of a good JPEG, as left by some recovery tools.
open(path("prefixed.jpg"), "wb").write(b"\x00" * 512 + open(path("photo.jpg"), "rb").read())

print("\n".join(sorted(os.listdir(out))))
