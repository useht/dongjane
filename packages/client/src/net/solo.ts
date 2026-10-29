import {
  type BowMessage,
  NPC_PER_ZONE,
  TICK_MS,
  TempleSim,
  type TempleState,
  type Zone,
  normalizeHue,
  randomHue,
} from "@dongjane/shared";
import type { SessionHandlers } from "./session.ts";

const SOLO_ID = "solo";

export class SoloSession {
  readonly sessionId = SOLO_ID;
  private readonly sim = new TempleSim({ npcCount: NPC_PER_ZONE });
  private readonly timer: ReturnType<typeof setInterval>;
  private closed = false;

  constructor(hue: unknown, handlers: Pick<SessionHandlers, "onState">) {
    this.sim.join(SOLO_ID, normalizeHue(hue) ?? randomHue());
    let last = performance.now();
    this.timer = setInterval(() => {
      const now = performance.now();
      this.sim.tick(now - last);
      last = now;
      this.sim.updateChant();
      handlers.onState(this.sim.state);
    }, TICK_MS);
  }

  get state(): TempleState {
    return this.sim.state;
  }

  get isOpen(): boolean {
    return !this.closed;
  }

  move(x: number, z: number, seq?: number): void {
    if (!this.closed) this.sim.move(SOLO_ID, x, z, seq);
  }

  sit(zone: Zone, seatId: number): void {
    if (!this.closed) this.sim.sit(SOLO_ID, zone, seatId);
  }

  stand(): void {
    if (!this.closed) this.sim.stand(SOLO_ID);
  }

  jump(): void {
    if (!this.closed) this.sim.jump(SOLO_ID);
  }

  bow(times: BowMessage["times"]): void {
    if (!this.closed) this.sim.bow(SOLO_ID, times);
  }

  emote(id: number): void {
    if (!this.closed) this.sim.emote(SOLO_ID, id);
  }

  async leave(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.timer);
  }
}
