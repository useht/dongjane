import { HALL_CAPACITY, HALL_SPARE_AT, type HallInfo, type SeatResponse } from "@dongjane/shared";

export const SEAT_RESERVATION_MS = 5000;
export const RELOCATION_GRACE_MS = 5000;
const MAX_PENDING_SEATS = 200;

export interface HallSnapshot {
  hall: number;
  clients: number;
  pending: number;
  draining: boolean;
}

export interface HallPlan {
  create: number | null;
  dispose: number[];
  relocation: { source: number; target: number } | null;
}

const load = (info: HallSnapshot): number => info.clients + info.pending;
const byHall = (a: HallSnapshot, b: HallSnapshot): number => a.hall - b.hall;

export function chooseSeat(halls: readonly HallSnapshot[], requested: number | null): { hall: number; create: boolean } {
  const open = halls.filter((info) => !info.draining && load(info) < HALL_CAPACITY).sort(byHall);
  const chosen = open.find((info) => info.hall === requested) ?? open[0];
  if (chosen) return { hall: chosen.hall, create: false };
  return { hall: halls.reduce((highest, info) => Math.max(highest, info.hall), 0) + 1, create: true };
}

export function planHalls(halls: readonly HallSnapshot[]): HallPlan {
  const active = halls.filter((info) => !info.draining);
  const top = active.filter((info) => load(info) > 0).sort(byHall).at(-1);
  const spare = top !== undefined && load(top) >= HALL_SPARE_AT ? top.hall + 1 : null;

  return {
    create: spare !== null && !halls.some((info) => info.hall === spare) ? spare : null,
    dispose: halls
      .filter((info) => load(info) === 0 && (info.draining || info.hall !== spare))
      .sort(byHall)
      .map((info) => info.hall),
    relocation: halls.some((info) => info.draining) ? null : planRelocation(active),
  };
}

function planRelocation(active: readonly HallSnapshot[]): HallPlan["relocation"] {
  const lone = active.filter((info) => info.clients === 1 && info.pending === 0).sort(byHall).reverse();
  for (const source of lone) {
    const target = active
      .filter((info) => info.hall !== source.hall && load(info) >= 1 && load(info) < HALL_CAPACITY)
      .sort(byHall)[0];
    if (target) return { source: source.hall, target: target.hall };
  }
  return null;
}

export interface DirectoryRoom {
  readonly roomId: string;
  readonly hall: number;
  readonly population: number;
  readonly draining: boolean;
  drain(target: number): Promise<void>;
  close(): Promise<unknown>;
}

export class HallsBusyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HallsBusyError";
  }
}

export interface HallDirectoryOptions {
  create(hall: number): Promise<unknown>;
  onError?(error: unknown): void;
  reservationMs?: number;
  now?(): number;
}

export class HallDirectory {
  private readonly rooms = new Map<number, DirectoryRoom>();
  private readonly reserved = new Map<number, number[]>();
  private readonly timers = new Set<NodeJS.Timeout>();
  private readonly reservationMs: number;
  private readonly now: () => number;
  private tail: Promise<unknown> = Promise.resolve();
  private reconcileQueued = false;
  private closing = false;

  constructor(private readonly options: HallDirectoryOptions) {
    this.reservationMs = options.reservationMs ?? SEAT_RESERVATION_MS;
    this.now = options.now ?? Date.now;
  }

  register(room: DirectoryRoom): void {
    if (this.rooms.has(room.hall)) throw new Error(`hall ${room.hall} already exists`);
    this.rooms.set(room.hall, room);
  }

  unregister(room: DirectoryRoom): void {
    if (this.rooms.get(room.hall) !== room) return;
    this.rooms.delete(room.hall);
    this.reserved.delete(room.hall);
    this.changed();
  }

  joined(room: DirectoryRoom): void {
    this.pending(room.hall);
    this.reserved.get(room.hall)?.shift();
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

  list(): HallInfo[] {
    return [...this.rooms.values()]
      .filter((room) => !room.draining)
      .sort((a, b) => a.hall - b.hall)
      .map((room) => ({
        hall: room.hall,
        roomId: room.roomId,
        clients: room.population,
        capacity: HALL_CAPACITY,
        full: room.population + this.pending(room.hall) >= HALL_CAPACITY,
      }));
  }

  seat(requested: number | null): Promise<SeatResponse> {
    return this.enqueue(async () => {
      if (this.closing) throw new HallsBusyError("server is shutting down");
      const snapshot = this.snapshot();
      if (snapshot.reduce((sum, info) => sum + info.pending, 0) >= MAX_PENDING_SEATS) {
        throw new HallsBusyError("too many seats are being handed out");
      }
      const choice = chooseSeat(snapshot, requested);
      if (choice.create) await this.options.create(choice.hall);
      const room = this.rooms.get(choice.hall);
      if (!room) throw new Error(`hall ${choice.hall} was not registered`);
      this.reserve(choice.hall);
      this.changed();
      return { hall: choice.hall, roomId: room.roomId, fellBack: requested !== null && choice.hall !== requested };
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
    const plan = planHalls(this.snapshot());
    for (const hall of plan.dispose) await this.rooms.get(hall)?.close();
    if (plan.create !== null && !this.closing) await this.options.create(plan.create);
    if (plan.relocation && !this.closing) {
      await this.rooms.get(plan.relocation.source)?.drain(plan.relocation.target);
    }
  }

  private snapshot(): HallSnapshot[] {
    return [...this.rooms.values()].map((room) => ({
      hall: room.hall,
      clients: room.population,
      pending: this.pending(room.hall),
      draining: room.draining,
    }));
  }

  private pending(hall: number): number {
    const list = this.reserved.get(hall);
    if (!list) return 0;
    const now = this.now();
    const live = list.filter((expiresAt) => expiresAt > now);
    if (live.length === 0) this.reserved.delete(hall);
    else if (live.length !== list.length) this.reserved.set(hall, live);
    return live.length;
  }

  private reserve(hall: number): void {
    const list = this.reserved.get(hall) ?? [];
    list.push(this.now() + this.reservationMs);
    this.reserved.set(hall, list);
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      this.changed();
    }, this.reservationMs + 25);
    timer.unref();
    this.timers.add(timer);
  }
}
