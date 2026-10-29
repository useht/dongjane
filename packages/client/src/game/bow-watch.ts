export interface WatchedMonk {
  id: string;
  slot: number;
  x: number;
  z: number;
  mode: string;
}

export interface BowReport {
  selfStarted: boolean;
  greeters: number[];
}

export const NEARBY_METERS = 5;
const PER_MONK_QUIET_MS = 8000;
const GLOBAL_QUIET_MS = 1500;

// Notices when a monk begins a bow. Neighbours within earshot are reported once per three-bow set, not per bow.
export class BowWatcher {
  private readonly modes = new Map<string, string>();
  private readonly spoke = new Map<string, number>();
  private lastReport = Number.NEGATIVE_INFINITY;

  reset(): void {
    this.modes.clear();
    this.spoke.clear();
    this.lastReport = Number.NEGATIVE_INFINITY;
  }

  update(monks: readonly WatchedMonk[], selfId: string | null, now: number): BowReport {
    const report: BowReport = { selfStarted: false, greeters: [] };
    const self = selfId ? monks.find((monk) => monk.id === selfId) : undefined;
    const seen = new Set<string>();

    for (const monk of monks) {
      seen.add(monk.id);
      const before = this.modes.get(monk.id);
      this.modes.set(monk.id, monk.mode);
      if (before === undefined || before === "bow" || monk.mode !== "bow") continue;

      if (monk.id === selfId) {
        report.selfStarted = true;
        continue;
      }
      if (!self || Math.hypot(monk.x - self.x, monk.z - self.z) > NEARBY_METERS) continue;
      if (now - (this.spoke.get(monk.id) ?? Number.NEGATIVE_INFINITY) < PER_MONK_QUIET_MS) continue;
      if (now - this.lastReport < GLOBAL_QUIET_MS) continue;
      this.spoke.set(monk.id, now);
      this.lastReport = now;
      report.greeters.push(monk.slot);
    }

    for (const id of [...this.modes.keys()]) {
      if (!seen.has(id)) {
        this.modes.delete(id);
        this.spoke.delete(id);
      }
    }
    return report;
  }
}
