import { BEDS, type Bed } from "../src/audio/soundscape.ts";

export class FakeParam {
  value = 0;
  readonly targets: { value: number; tau: number }[] = [];
  readonly ramps: number[] = [];
  cancelled = 0;
  setValueAtTime(): this {
    return this;
  }
  linearRampToValueAtTime(value: number): this {
    this.ramps.push(value);
    return this;
  }
  exponentialRampToValueAtTime(): this {
    return this;
  }
  setTargetAtTime(value: number, _at: number, tau: number): this {
    this.targets.push({ value, tau });
    return this;
  }
  cancelScheduledValues(): this {
    this.cancelled += 1;
    return this;
  }
}

export class FakeNode {
  type = "";
  loop = false;
  buffer: { length: number } | null = null;
  started: number[][] = [];
  readonly outputs: unknown[] = [];
  readonly frequency = new FakeParam();
  readonly gain = new FakeParam();
  readonly Q = new FakeParam();
  constructor(readonly kind: string) {}
  connect<T>(next: T): T {
    this.outputs.push(next);
    return next;
  }
  start(...args: number[]): void {
    this.started.push(args);
  }
  stop(): void {}
}

export const graph: { nodes: FakeNode[]; context: FakeAudioContext | null } = { nodes: [], context: null };

export function resetGraph(): void {
  graph.nodes = [];
  graph.context = null;
}

export class FakeAudioContext {
  state = "running";
  currentTime = 0;
  sampleRate = 44100;
  destination = new FakeNode("destination");
  constructor() {
    graph.context = this;
  }
  private make(kind: string): FakeNode {
    const node = new FakeNode(kind);
    graph.nodes.push(node);
    return node;
  }
  createGain = () => this.make("gain");
  createOscillator = () => this.make("oscillator");
  createBufferSource = () => this.make("bufferSource");
  createBiquadFilter = () => this.make("filter");
  createBuffer = (_channels: number, length: number) => ({ length, getChannelData: () => new Float32Array(length) });
  decodeAudioData = () => Promise.reject(new Error("no samples in tests"));
  resume = () => Promise.resolve();
  close = () => Promise.resolve();
  addEventListener = () => undefined;
}

export function reachableFrom(from: FakeNode): FakeNode[] {
  const seen = new Set<FakeNode>();
  const queue = [from];
  for (let node = queue.pop(); node; node = queue.pop()) {
    if (seen.has(node)) continue;
    seen.add(node);
    for (const out of node.outputs) if (out instanceof FakeNode) queue.push(out);
  }
  return [...seen];
}

// The engine's first gain is the effects bus and its second the ambience bus.
export const ambienceBus = (): FakeNode => graph.nodes.filter((node) => node.kind === "gain")[1] as FakeNode;

// Each ambient bed ends in one gain that feeds the ambience bus; they are made in the order of BEDS.
export function bedGains(): Record<Bed, FakeNode> {
  const bus = ambienceBus();
  const gains = graph.nodes.filter((node) => node.kind === "gain" && node.outputs.includes(bus));
  if (gains.length !== BEDS.length) throw new Error(`expected ${BEDS.length} beds on the ambience bus, found ${gains.length}`);
  return Object.fromEntries(BEDS.map((bed, i) => [bed, gains[i]])) as Record<Bed, FakeNode>;
}

// A drop is a one-shot slice of the shared noise; the beds are the looping sources.
export const droplets = (): FakeNode[] => graph.nodes.filter((node) => node.kind === "bufferSource" && !node.loop && node.started.length > 0);
