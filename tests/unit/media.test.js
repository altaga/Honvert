import { getEncoders, probe } from "../../modules/honvert-engine";
import { buildAudioArgs, buildGifArgs, buildImageArgs, buildVideoArgs, cropFilter, hasHardwareH264, probeFile } from "../../src/engine/media";

jest.mock("../../modules/honvert-engine", () => ({ probe: jest.fn(), getEncoders: jest.fn() }));

const valueAfter = (args, flag) => args[args.indexOf(flag) + 1];

describe("cropFilter", () => {
  it("centers the crop for each ratio", () => {
    expect(cropFilter("16:9", 1080, 1920)).toBe("crop=1080:608:0:656");
    expect(cropFilter("1:1", 1920, 1080)).toBe("crop=1080:1080:420:0");
    expect(cropFilter("4:3", 1920, 1080)).toBe("crop=1440:1080:240:0");
  });

  it("returns null when there is nothing to crop", () => {
    expect(cropFilter("original", 1920, 1080)).toBeNull();
    expect(cropFilter("unknown-ratio", 1920, 1080)).toBeNull();
    expect(cropFilter("16:9", 0, 1080)).toBeNull();
  });

  it("returns null for a picture too small to crop without an empty side", () => {
    expect(cropFilter("16:9", 1, 1)).toBeNull();
    expect(cropFilter("16:9", 4096, 1)).toBeNull();
  });
});

describe("buildImageArgs", () => {
  it("writes one frame as JPEG using the mapped quality", () => {
    expect(buildImageArgs({ input: "in.heic", output: "out.jpg", format: "jpg", quality: 90 })).toEqual([
      "-y", "-i", "in.heic", "-frames:v", "1", "-c:v", "mjpeg", "-q:v", "5", "out.jpg",
    ]);
  });

  it("maps quality 100 to the best JPEG scale and quality 1 to the worst", () => {
    expect(valueAfter(buildImageArgs({ input: "a", output: "b.jpg", format: "jpg", quality: 100 }), "-q:v")).toBe("2");
    expect(valueAfter(buildImageArgs({ input: "a", output: "b.jpg", format: "jpg", quality: 1 }), "-q:v")).toBe("31");
  });

  it("flattens transparency onto white for BMP and JPEG when the size is known", () => {
    expect(buildImageArgs({ input: "in.png", output: "out.bmp", format: "bmp", width: 4, height: 2 })).toEqual([
      "-y", "-i", "in.png", "-filter_complex",
      "color=c=white:s=4x2,format=rgba[bg];[0:v]format=rgba[fg];[bg][fg]overlay=format=auto,format=bgr24[out]",
      "-map", "[out]", "-frames:v", "1", "-c:v", "bmp", "out.bmp",
    ]);
  });

  it("scales down without going below 2 px", () => {
    const args = buildImageArgs({ input: "a.png", output: "b.png", format: "png", scalePercent: 50 });
    expect(valueAfter(args, "-vf")).toBe("scale=max(2\\,trunc(iw*0.5/2)*2):max(2\\,trunc(ih*0.5/2)*2)");
  });

  it("refuses formats that do not go through FFmpeg (WEBP is encoded natively)", () => {
    expect(() => buildImageArgs({ input: "a", output: "b", format: "webp" })).toThrow();
  });
});

describe("buildGifArgs", () => {
  it("builds a two-pass palette GIF that loops forever", () => {
    expect(buildGifArgs({ input: "clip.mp4", output: "out.gif" })).toEqual([
      "-y", "-i", "clip.mp4", "-filter_complex",
      "[0:v]fps=15,scale='min(iw\\,480)':-2:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer",
      "-an", "-loop", "0", "out.gif",
    ]);
  });

  it("drops the frame-rate filter for a single still frame", () => {
    const graph = valueAfter(buildGifArgs({ input: "still.png", output: "out.gif", still: true }), "-filter_complex");
    expect(graph).not.toContain("fps=");
  });

  it("applies speed before the palette", () => {
    const graph = valueAfter(buildGifArgs({ input: "clip.mp4", output: "out.gif", speed: 2 }), "-filter_complex");
    expect(graph.startsWith("[0:v]setpts=PTS/2,")).toBe(true);
  });
});

describe("buildAudioArgs", () => {
  it("maps each format to its codec and bitrate", () => {
    expect(buildAudioArgs({ input: "a.mp4", output: "a.mp3", format: "mp3", bitrate: 192 })).toEqual([
      "-y", "-i", "a.mp4", "-vn", "-c:a", "libmp3lame", "-b:a", "192k", "a.mp3",
    ]);
    expect(buildAudioArgs({ input: "a.mp4", output: "a.ogg", format: "ogg", bitrate: 96 })).toEqual([
      "-y", "-i", "a.mp4", "-vn", "-c:a", "libopus", "-b:a", "96k", "a.ogg",
    ]);
    expect(buildAudioArgs({ input: "a.mp4", output: "a.wav", format: "wav" })).toEqual([
      "-y", "-i", "a.mp4", "-vn", "-c:a", "pcm_s16le", "a.wav",
    ]);
    expect(buildAudioArgs({ input: "a.mp4", output: "a.flac", format: "flac" })).toEqual([
      "-y", "-i", "a.mp4", "-vn", "-c:a", "flac", "a.flac",
    ]);
  });

  it("changes the tempo only when the speed differs from 1", () => {
    expect(valueAfter(buildAudioArgs({ input: "a", output: "b.m4a", format: "m4a", speed: 1.5 }), "-af")).toBe("atempo=1.5");
    expect(buildAudioArgs({ input: "a", output: "b.m4a", format: "m4a" })).not.toContain("-af");
  });
});

describe("buildVideoArgs", () => {
  it("encodes MP4 with H.264 and AAC, faststart, and a player-friendly pixel format", () => {
    expect(buildVideoArgs({ input: "in.mov", output: "out.mp4", format: "mp4" })).toEqual([
      "-y", "-i", "in.mov", "-vf", "format=yuv420p",
      "-c:v", "libopenh264", "-b:v", "2000k",
      "-c:a", "aac", "-b:a", "128k",
      "-movflags", "+faststart", "out.mp4",
    ]);
  });

  it("encodes WEBM with VP8 and Opus, always in software", () => {
    expect(buildVideoArgs({ input: "in.mov", output: "out.webm", format: "webm", hardware: true })).toEqual([
      "-y", "-i", "in.mov", "-vf", "format=yuv420p",
      "-c:v", "libvpx", "-b:v", "2000k", "-deadline", "realtime", "-cpu-used", "6",
      "-c:a", "libopus", "-b:a", "96k", "out.webm",
    ]);
  });

  it("uses the hardware encoder for MP4 only when asked", () => {
    expect(valueAfter(buildVideoArgs({ input: "a", output: "b.mp4", format: "mp4", hardware: true }), "-c:v")).toBe("h264_mediacodec");
  });

  it("drops the audio track when asked and scales only when a height is set", () => {
    const args = buildVideoArgs({ input: "a", output: "b.mp4", format: "mp4", keepAudio: false, height: 480 });
    expect(args).toContain("-an");
    expect(args).not.toContain("-c:a");
    expect(valueAfter(args, "-vf")).toBe("scale=-2:min(ih\\,480),format=yuv420p");
  });
});

describe("probeFile", () => {
  it("reads duration, size, codec and streams", async () => {
    probe.mockResolvedValueOnce(JSON.stringify({
      format: { duration: "12.5" },
      streams: [{ codec_type: "video", codec_name: "h264", width: 1920, height: 1080 }, { codec_type: "audio" }],
    }));
    expect(await probeFile("a.mp4")).toEqual({ durationMs: 12500, width: 1920, height: 1080, codec: "h264", hasVideo: true, hasAudio: true });
  });

  it("swaps width and height for a 90 or 270 degree rotation", async () => {
    probe.mockResolvedValueOnce(JSON.stringify({
      streams: [{ codec_type: "video", width: 1920, height: 1080, side_data_list: [{ rotation: -90 }] }],
    }));
    const info = await probeFile("phone.mp4");
    expect([info.width, info.height]).toEqual([1080, 1920]);
  });

  it("reads the rotate tag and keeps the size for 180 degrees", async () => {
    probe.mockResolvedValueOnce(JSON.stringify({
      streams: [{ codec_type: "video", width: 640, height: 480, tags: { rotate: "180" } }],
    }));
    const info = await probeFile("flipped.mp4");
    expect([info.width, info.height]).toEqual([640, 480]);
  });

  it("reports zero for missing or unreadable durations and empty files", async () => {
    probe.mockResolvedValueOnce(JSON.stringify({ format: { duration: "N/A" }, streams: [] }));
    expect(await probeFile("x")).toEqual({ durationMs: 0, width: 0, height: 0, codec: "", hasVideo: false, hasAudio: false });
  });
});

describe("hasHardwareH264", () => {
  it("is true only when a hardware AVC encoder exists", () => {
    getEncoders.mockReturnValueOnce([{ hardware: false }, { hardware: true }]);
    expect(hasHardwareH264()).toBe(true);
    getEncoders.mockReturnValueOnce([{ hardware: false }]);
    expect(hasHardwareH264()).toBe(false);
  });

  it("treats a failing native call as no hardware", () => {
    getEncoders.mockImplementationOnce(() => {
      throw new Error("no module");
    });
    expect(hasHardwareH264()).toBe(false);
  });
});
