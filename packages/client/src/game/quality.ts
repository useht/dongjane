export interface QualityEnv {
  devicePixelRatio: number;
  cores: number | undefined;
  memoryGb: number | undefined;
  coarsePointer: boolean;
  maxAnisotropy: number;
}

export interface QualityProfile {
  pixelRatioCap: number;
  shadows: boolean;
  shadowMapSize: number;
  leaves: number;
  precipitation: number;
  anisotropy: number;
  lanterns: number;
  videoWidth: number;
  videoHeight: number;
  weak: boolean;
}

export function detectQuality(env: QualityEnv): QualityProfile {
  const dpr = Number.isFinite(env.devicePixelRatio) && env.devicePixelRatio > 0 ? env.devicePixelRatio : 1;
  const weak =
    (env.coarsePointer && ((env.cores ?? 8) <= 4 || (env.memoryGb ?? 8) <= 3)) ||
    ((env.cores ?? 8) <= 2 && (env.memoryGb ?? 8) <= 4);
  return {
    pixelRatioCap: Math.min(dpr, weak ? 1.25 : env.coarsePointer ? 1.75 : 2),
    shadows: true,
    shadowMapSize: weak ? 512 : 1024,
    leaves: weak ? 40 : 90,
    precipitation: weak ? 420 : 900,
    anisotropy: Math.max(1, Math.min(env.maxAnisotropy, weak ? 2 : 8)),
    lanterns: weak ? 90 : 180,
    videoWidth: weak ? 640 : 960,
    videoHeight: weak ? 360 : 540,
    weak,
  };
}

// Lowers the render scale when frames run long and cautiously raises it again when there is headroom.
export class AdaptiveScale {
  private readonly samples: number[] = [];
  private calmWindows = 0;

  constructor(
    public ratio: number,
    private readonly cap: number,
    private readonly floor = 0.75,
    private readonly windowSize = 60,
  ) {}

  push(frameMs: number): number | null {
    if (!Number.isFinite(frameMs) || frameMs <= 0 || frameMs > 1000) return null;
    this.samples.push(frameMs);
    if (this.samples.length < this.windowSize) return null;
    const average = this.samples.reduce((sum, value) => sum + value, 0) / this.samples.length;
    this.samples.length = 0;

    if (average > 27 && this.ratio > this.floor) {
      this.calmWindows = 0;
      this.ratio = Math.max(this.floor, this.ratio - 0.25);
      return this.ratio;
    }
    if (average < 15) {
      this.calmWindows += 1;
      if (this.calmWindows >= 3 && this.ratio < this.cap) {
        this.calmWindows = 0;
        this.ratio = Math.min(this.cap, this.ratio + 0.25);
        return this.ratio;
      }
    } else {
      this.calmWindows = 0;
    }
    return null;
  }
}
