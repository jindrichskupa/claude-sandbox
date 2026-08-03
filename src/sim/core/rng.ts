/**
 * Deterministic randomness.
 *
 * Every random draw in the simulation is a pure function of (worldSeed, streamName, tick,
 * salt). Nothing carries mutable generator state across ticks. That is what lets us add a
 * new event definition, a new weather variable or a new failure mode later without shifting
 * the number sequence of everything that already exists — the usual way a simulation game
 * breaks its own save files and snapshot tests.
 */

/** FNV-1a over a string, used to turn a stream name into a stable 32-bit salt. */
export function hashString(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Integer avalanche (splitmix32 finalizer). Good enough scrambling for game randomness. */
function mix32(x: number): number {
  let z = x >>> 0
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad)
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97)
  return (z ^ (z >>> 15)) >>> 0
}

function combine(...parts: number[]): number {
  let acc = 0x9e3779b9
  for (const p of parts) acc = mix32(acc ^ (p >>> 0)) >>> 0
  return acc
}

/**
 * A named, stateless random stream. Two streams with different names never interfere,
 * so systems can be added independently.
 */
export class RandomStream {
  private readonly salt: number

  constructor(
    private readonly worldSeed: number,
    readonly name: string,
  ) {
    this.salt = hashString(name)
  }

  /** Uniform in [0, 1). `key` distinguishes several draws within one tick (e.g. per asset). */
  float(tick: number, key = 0): number {
    return combine(this.worldSeed, this.salt, tick, key) / 0x1_0000_0000
  }

  /** Uniform in [min, max). */
  range(tick: number, min: number, max: number, key = 0): number {
    return min + this.float(tick, key) * (max - min)
  }

  /** Integer in [0, n). */
  int(tick: number, n: number, key = 0): number {
    return Math.min(n - 1, Math.floor(this.float(tick, key) * n))
  }

  /** True with probability p. */
  chance(tick: number, p: number, key = 0): boolean {
    return this.float(tick, key) < p
  }

  /**
   * Approximately standard-normal via the sum of 4 uniforms. Cheap, bounded, and plenty
   * for weather noise where true Gaussian tails would only produce absurd outliers.
   */
  normal(tick: number, key = 0): number {
    let s = 0
    for (let i = 0; i < 4; i++) s += this.float(tick, key * 977 + i)
    return (s - 2) * 1.732
  }
}

/** Owns the world seed and hands out named streams. One per world. */
export class RandomSource {
  private readonly streams = new Map<string, RandomStream>()

  constructor(readonly seed: number) {}

  streamFor(name: string): RandomStream {
    let s = this.streams.get(name)
    if (!s) {
      s = new RandomStream(this.seed, name)
      this.streams.set(name, s)
    }
    return s
  }
}

/**
 * Smooth 1-D value noise over ticks, used for weather variables that must drift rather
 * than jump. `period` is the correlation length in ticks.
 */
export function smoothNoise(stream: RandomStream, tick: number, period: number, key = 0): number {
  const t = tick / period
  const i = Math.floor(t)
  const f = t - i
  // Smoothstep keeps the first derivative continuous, so the weather has no visible kinks.
  const w = f * f * (3 - 2 * f)
  const a = stream.float(i, key)
  const b = stream.float(i + 1, key)
  return a + (b - a) * w
}
