import { WORLD_CAPACITY, WORLD_SPARE_AT, type WorldInfo, type SeatResponse, type Zone } from "@dongjane/shared";

export const SEAT_RESERVATION_MS = 5000;
export const RELOCATION_GRACE_MS = 5000;
export const MAX_PENDING_SEATS = 200;

export interface WorldSnapshot {
  world: number;
  clients: number;
  pending: number;
  draining: boolean;
}

export interface WorldPlan {
  create: number | null;
  dispose: number[];
  relocation: { source: number; target: number } | null;
}

const load = (info: WorldSnapshot): number => info.clients + info.pending;
const byWorld = (a: WorldSnapshot, b: WorldSnapshot): number => a.world - b.world;

export function chooseSeat(worlds: readonly WorldSnapshot[], requested: number | null): { world: number; create: boolean } {
  const open = worlds.filter((info) => !info.draining && load(info) < WORLD_CAPACITY).sort(byWorld);
  const chosen = open.find((info) => info.world === requested && info.clients >= 1) ?? open[0];
  if (chosen) return { world: chosen.world, create: false };
  return { world: worlds.reduce((highest, info) => Math.max(highest, info.world), 0) + 1, create: true };
}

export function planWorlds(worlds: readonly WorldSnapshot[]): WorldPlan {
  const active = worlds.filter((info) => !info.draining);
  const top = active.filter((info) => info.clients > 0).sort(byWorld).at(-1);
  const spare = top !== undefined && top.clients >= WORLD_SPARE_AT ? top.world + 1 : null;

  return {
    create: spare !== null && !worlds.some((info) => info.world === spare) ? spare : null,
    dispose: worlds
      .filter((info) => load(info) === 0 && (info.draining || info.world !== spare))
      .sort(byWorld)
      .map((info) => info.world),
    relocation: worlds.some((info) => info.draining) ? null : planRelocation(active),
  };
}

function planRelocation(active: readonly WorldSnapshot[]): WorldPlan["relocation"] {
  const lone = active.filter((info) => info.clients === 1 && info.pending === 0).sort(byWorld).reverse();
  for (const source of lone) {
    const target = active
      .filter((info) => info.world !== source.world && info.clients >= 1 && load(info) < WORLD_CAPACITY)
      .sort(byWorld)[0];
    if (target) return { source: source.world, target: target.world };
  }
  return null;
}

export interface DirectoryRoom {
  readonly roomId: string;
  readonly world: number;
  readonly population: number;
  readonly zones: Readonly<Record<Zone, number>>;
  readonly draining: boolean;
  /** Starts the hand-over; must have cleared `draining` again if it rejects. */
  drain(target: number): Promise<void>;
  close(): Promise<unknown>;
}

export class WorldsBusyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorldsBusyError";
  }
}

export interface WorldDirectoryOptions {
  create(world: number): Promise<unknown>;
  onError?(error: unknown): void;
  reservationMs?: number;
  now?(): number;
}

export class WorldDirectory {
  private readonly rooms = new Map<number, DirectoryRoom>();
  private readonly reserved = new Map<number, number[]>();
  private readonly timers = new Set<NodeJS.Timeout>();
  private readonly reservationMs: number;
  private readonly now: () => number;
  private tail: Promise<unknown> = Promise.resolve();
  private reconcileQueued = false;
  private closing = false;

  constructor(private readonly options: WorldDirectoryOptions) {
    this.reservationMs = options.reservationMs ?? SEAT_RESERVATION_MS;
    this.now = options.now ?? Date.now;
  }

  register(room: DirectoryRoom): void {
    if (this.rooms.has(room.world)) throw new Error(`world ${room.world} already exists`);
    this.rooms.set(room.world, room);
  }

  unregister(room: DirectoryRoom): void {
    if (this.rooms.get(room.world) !== room) return;
    this.rooms.delete(room.world);
    this.reserved.delete(room.world);
    this.changed();
  }

  joined(room: DirectoryRoom): void {
    this.pending(room.world);
    this.reserved.get(room.world)?.shift();
    this.changed();
  }

  changed(): void {
    if (this.closing || this.reconcileQueued) return;
    this.reconcileQueued = true;
    this.enqueue(async () => {
      this.reconcileQueued = false;
      await this.reconcile();
    }).catch((error: unknown) => this.options.onError?.(error));
  }

  list(): WorldInfo[] {
    return [...this.rooms.values()]
      .filter((room) => !room.draining)
      .sort((a, b) => a.world - b.world)
      .map((room) => ({
        world: room.world,
        roomId: room.roomId,
        clients: room.population,
        capacity: WORLD_CAPACITY,
        full: room.population + this.pending(room.world) >= WORLD_CAPACITY,
        zones: { ...room.zones },
      }));
  }

  seat(requested: number | null): Promise<SeatResponse> {
    return this.enqueue(async () => {
      if (this.closing) throw new WorldsBusyError("server is shutting down");
      const snapshot = this.snapshot();
      if (snapshot.reduce((sum, info) => sum + info.pending, 0) >= MAX_PENDING_SEATS) {
        throw new WorldsBusyError("too many seats are being handed out");
      }
      const choice = chooseSeat(snapshot, requested);
      if (choice.create) await this.options.create(choice.world);
      const room = this.rooms.get(choice.world);
      if (!room) throw new Error(`world ${choice.world} was not registered`);
      this.reserve(choice.world);
      this.changed();
      return { world: choice.world, roomId: room.roomId, fellBack: requested !== null && choice.world !== requested };
    });
  }

  async close(): Promise<void> {
    this.closing = true;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    await this.tail;
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task);
    this.tail = result.catch(() => undefined);
    return result;
  }

  private async reconcile(): Promise<void> {
    if (this.closing) return;
    const plan = planWorlds(this.snapshot());
    for (const world of plan.dispose) await this.rooms.get(world)?.close();
    if (plan.create !== null && !this.closing) await this.options.create(plan.create);
    if (plan.relocation && !this.closing) {
      const { source, target } = plan.relocation;
      void this.rooms.get(source)?.drain(target).catch((error: unknown) => this.options.onError?.(error));
    }
  }

  private snapshot(): WorldSnapshot[] {
    return [...this.rooms.values()].map((room) => ({
      world: room.world,
      clients: room.population,
      pending: this.pending(room.world),
      draining: room.draining,
    }));
  }

  private pending(world: number): number {
    const list = this.reserved.get(world);
    if (!list) return 0;
    const now = this.now();
    const live = list.filter((expiresAt) => expiresAt > now);
    if (live.length === 0) this.reserved.delete(world);
    else if (live.length !== list.length) this.reserved.set(world, live);
    return live.length;
  }

  private reserve(world: number): void {
    const list = this.reserved.get(world) ?? [];
    list.push(this.now() + this.reservationMs);
    this.reserved.set(world, list);
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      this.changed();
    }, this.reservationMs + 25);
    timer.unref();
    this.timers.add(timer);
  }
}
