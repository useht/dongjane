import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SUTRA_SECONDS } from "../src/audio/music.ts";

const audioDir = join(dirname(fileURLToPath(import.meta.url)), "../src/assets/audio");
const MAX_BYTES = 2.5 * 1024 * 1024;

// MPEG-1 Layer III, the only kind the game ships.
const BITRATES = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const SAMPLE_RATES = [44100, 48000, 32000];

interface Mp3 {
  frames: number;
  bitrates: Set<number>;
  channelModes: Set<number>;
  sampleRates: Set<number>;
  seconds: number;
}

function parseMp3(bytes: Buffer): Mp3 {
  let at = 0;
  if (bytes.toString("latin1", 0, 3) === "ID3") {
    const size = ((bytes[6] ?? 0) << 21) | ((bytes[7] ?? 0) << 14) | ((bytes[8] ?? 0) << 7) | (bytes[9] ?? 0);
    at = 10 + size;
  }
  const found: Mp3 = { frames: 0, bitrates: new Set(), channelModes: new Set(), sampleRates: new Set(), seconds: 0 };
  while (at + 4 <= bytes.length) {
    const head = bytes.readUInt32BE(at);
    const sync = (head >>> 21) === 0x7ff;
    const version = (head >>> 19) & 3;
    const layer = (head >>> 17) & 3;
    const bitrate = BITRATES[(head >>> 12) & 15];
    const rate = SAMPLE_RATES[(head >>> 10) & 3];
    if (!sync || version !== 3 || layer !== 1 || !bitrate || !rate) break;
    const padding = (head >>> 9) & 1;
    const length = Math.floor((144 * bitrate * 1000) / rate) + padding;
    const info = at + 4 + 32;
    const isInfoFrame = ["Info", "Xing"].includes(bytes.toString("latin1", info, info + 4));
    if (!isInfoFrame) {
      found.frames += 1;
      found.bitrates.add(bitrate);
    }
    found.channelModes.add((head >>> 6) & 3);
    found.sampleRates.add(rate);
    at += length;
  }
  const rate = [...found.sampleRates][0] ?? 44100;
  found.seconds = (found.frames * 1152) / rate;
  return found;
}

describe("audio files", () => {
  it("ship only the Korean chant", () => {
    expect(readdirSync(audioDir).sort()).toEqual(["sources.md", "sutra.mp3"]);
  });

  it("keep the sutra small", () => {
    expect(statSync(join(audioDir, "sutra.mp3")).size).toBeLessThanOrEqual(MAX_BYTES);
  });

  it("make the sutra a mono, constant-bit-rate MP3 whose length every browser agrees on", () => {
    const mp3 = parseMp3(readFileSync(join(audioDir, "sutra.mp3")));
    expect(mp3.frames).toBeGreaterThan(1000);
    expect([...mp3.bitrates]).toEqual([128]);
    expect([...mp3.channelModes]).toEqual([3]);
    expect([...mp3.sampleRates]).toEqual([44100]);
  });

  it("make the sutra as long as SUTRA_SECONDS, which every visitor's place in the loop is worked out from", () => {
    const mp3 = parseMp3(readFileSync(join(audioDir, "sutra.mp3")));
    expect(mp3.seconds).toBeGreaterThanOrEqual(SUTRA_SECONDS);
    expect(mp3.seconds).toBeLessThan(SUTRA_SECONDS + 0.1);
  });

  it("record where the chant came from and under what licence", () => {
    const sources = readFileSync(join(audioDir, "sources.md"), "utf8");
    expect(sources).toContain("김용배");
    expect(sources).toContain("CC BY");
    expect(sources).toContain("`ko`");
  });
});
