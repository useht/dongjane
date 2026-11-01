import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const audioDir = join(dirname(fileURLToPath(import.meta.url)), "../src/assets/audio");
const CASINO_SOUND_MAX_BYTES = 300 * 1024;
const CASINO_SOUNDS = [
  { file: "coin.mp3", freesound: 510735, page: "https://freesound.org/people/HoseNoseSounds/sounds/510735/", author: "HoseNoseSounds" },
  { file: "click.mp3", freesound: 538727, page: "https://freesound.org/people/AndrewEathan/sounds/538727/", author: "AndrewEathan" },
  { file: "jackpot.mp3", freesound: 860886, page: "https://freesound.org/people/Johnmode/sounds/860886/", author: "Johnmode" },
] as const;

// MPEG-1 Layer III, the only kind the game ships.
const BITRATES = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const SAMPLE_RATES = [44100, 48000, 32000];

interface Mp3 {
  frames: number;
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
  const found: Mp3 = { frames: 0, channelModes: new Set(), sampleRates: new Set(), seconds: 0 };
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
    if (!isInfoFrame) found.frames += 1;
    found.channelModes.add((head >>> 6) & 3);
    found.sampleRates.add(rate);
    at += length;
  }
  const rate = [...found.sampleRates][0] ?? 44100;
  found.seconds = (found.frames * 1152) / rate;
  return found;
}

describe("audio files", () => {
  it("ship only the three casino sounds", () => {
    expect(readdirSync(audioDir).sort()).toEqual(["click.mp3", "coin.mp3", "jackpot.mp3", "sources.md"]);
  });

  it("keep every casino sound under 300 KB, as a short mono MP3", () => {
    for (const { file } of CASINO_SOUNDS) {
      const path = join(audioDir, file);
      expect(statSync(path).size, file).toBeLessThanOrEqual(CASINO_SOUND_MAX_BYTES);
      const mp3 = parseMp3(readFileSync(path));
      expect(mp3.frames, file).toBeGreaterThan(5);
      expect([...mp3.channelModes], file).toEqual([3]);
      expect([...mp3.sampleRates], file).toEqual([44100]);
      expect(mp3.seconds, file).toBeLessThan(10);
    }
  });

  it("say that the 법당 sound and the concert are YouTube embeds, with the rights left to whoever runs the game", () => {
    const sources = readFileSync(join(audioDir, "sources.md"), "utf8");
    expect(sources).toContain("10TrBnVkPgc");
    expect(sources).toContain("ykT0Ezc9k-E");
    expect(sources).toContain("embedding permission");
  });

  it("record every casino sound as CC0, with its page and its author", () => {
    const sources = readFileSync(join(audioDir, "sources.md"), "utf8");
    for (const { file, freesound, page, author } of CASINO_SOUNDS) {
      const section = sources.split(/^#{2,3} /m).find((part) => part.startsWith(`\`${file}\``));
      expect(section, file).toBeDefined();
      expect(section, file).toContain("**CC0**");
      expect(section, file).toContain(page);
      expect(section, file).toContain(String(freesound));
      expect(section, file).toContain(author);
    }
  });
});
