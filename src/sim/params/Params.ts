/**
 * The single chokepoint through which all simulation code reads parameters.
 *
 * Nothing else may read a raw content number. That rule is what makes ageing, weather,
 * policy and events additive later instead of a rewrite, and it is enforced by lint config
 * and by `tests/params.test.ts`.
 *
 * Two paths over the same evaluation:
 *   `get()`     — hot, returns a number, memoised per tick.
 *   `explain()` — cold, returns the whole chain with running subtotals for the inspector.
 */

import { ModifierRegistry } from './ModifierRegistry'
import {
  LAYER_ORDER,
  Layer,
  Op,
  PARAM_BOUNDS,
  Param,
  type Explanation,
  type ExplainStep,
  type Modifier,
} from './types'

/** Supplies the unmodified value of a parameter for a target. */
export type BaseProvider = (targetId: string, param: Param) => number | undefined

interface CacheSlot {
  tick: number
  epoch: number
  value: number
}

/**
 * Applies one layer's worth of modifiers to a running value.
 *
 * Within the layer, fractional contributions sum before being applied, absolute offsets
 * sum separately, and explicit multipliers compose. Across layers the caller multiplies,
 * by calling this once per layer in `LAYER_ORDER`.
 */
function applyLayer(running: number, mods: Modifier[], layer: Layer): number {
  let fracSum = 0
  let absSum = 0
  let mul = 1
  let any = false
  for (const m of mods) {
    if (m.layer !== layer) continue
    any = true
    if (m.op === Op.AddFrac) fracSum += m.value
    else if (m.op === Op.AddAbs) absSum += m.value
    else mul *= m.value
  }
  if (!any) return running
  return (running * (1 + fracSum) + absSum) * mul
}

export class Params {
  private cache = new Map<string, CacheSlot>()
  private currentTick = 0

  constructor(
    readonly registry: ModifierRegistry,
    private readonly baseProvider: BaseProvider,
  ) {}

  /** Called once per tick by the world before anything reads parameters. */
  setTick(tick: number): void {
    if (tick !== this.currentTick) {
      this.currentTick = tick
      this.cache.clear()
    }
  }

  /** Base value with no modifiers applied. Throws if the target has no such parameter. */
  base(targetId: string, param: Param): number {
    const b = this.baseProvider(targetId, param)
    if (b === undefined) {
      throw new Error(`No base value for parameter ${Param[param]} on target "${targetId}"`)
    }
    return b
  }

  /** Effective value after the whole modifier chain. */
  get(targetId: string, param: Param): number {
    const k = `${targetId}|${param}`
    const epoch = this.registry.epoch
    const hit = this.cache.get(k)
    if (hit && hit.tick === this.currentTick && hit.epoch === epoch) return hit.value

    const value = this.compute(targetId, param)
    this.cache.set(k, { tick: this.currentTick, epoch, value })
    return value
  }

  /** Same as `get`, but returns 0 instead of throwing when the target has no such base. */
  getOr(targetId: string, param: Param, fallback: number): number {
    if (this.baseProvider(targetId, param) === undefined) return fallback
    return this.get(targetId, param)
  }

  private compute(targetId: string, param: Param): number {
    const mods = this.registry.lookup(targetId, param)
    let running = this.base(targetId, param)
    if (mods.length > 0) {
      for (const layer of LAYER_ORDER) running = applyLayer(running, mods, layer)
    }
    const b = PARAM_BOUNDS[param]
    return Math.min(b.max, Math.max(b.min, running))
  }

  /**
   * The player-facing "why is this number what it is" breakdown. Deliberately allocates —
   * it runs when a panel is open, never in the dispatch loop.
   */
  explain(targetId: string, param: Param): Explanation {
    const mods = this.registry.lookup(targetId, param)
    const baseValue = this.base(targetId, param)
    let running = baseValue
    const steps: ExplainStep[] = []

    for (const layer of LAYER_ORDER) {
      const layerMods = mods.filter((m) => m.layer === layer)
      if (layerMods.length === 0) continue
      // Show each contribution individually, but keep the running total consistent with
      // `compute` by evaluating the layer as a whole after listing its parts.
      const after = applyLayer(running, layerMods, layer)
      for (let i = 0; i < layerMods.length; i++) {
        const m = layerMods[i]!
        const isLast = i === layerMods.length - 1
        const step: ExplainStep = {
          layer,
          reasonKey: m.reasonKey,
          op: m.op,
          value: m.value,
          runningValue: isLast ? after : running,
        }
        if (m.reasonParams) step.reasonParams = m.reasonParams
        steps.push(step)
      }
      running = after
    }

    const b = PARAM_BOUNDS[param]
    const finalValue = Math.min(b.max, Math.max(b.min, running))
    return { param, baseValue, steps, finalValue, clamped: finalValue !== running }
  }
}
