/**
 * Storage and lookup for modifiers.
 *
 * Modifiers are grouped by the system that produced them, because that is how they are
 * replaced: the weather system recomputes its whole contribution every tick and hands it
 * over in one call, rather than trying to remove yesterday's entries one by one.
 */

import { Layer, Op, type Modifier, type Param } from './types'

interface Entry {
  targetId: string
  mod: Modifier
}

function key(targetId: string, param: Param): string {
  return `${targetId}|${param}`
}

export class ModifierRegistry {
  private readonly bySource = new Map<string, Entry[]>()
  private index = new Map<string, Modifier[]>()
  private indexDirty = true

  /** Bumped on every mutation so caches downstream know to recompute. */
  private _epoch = 0
  get epoch(): number {
    return this._epoch
  }

  /**
   * Replace everything a given system contributes. This is the main entry point: weather
   * calls it once per tick, ageing once per month, policy when the regime changes.
   */
  setSource(sourceId: string, entries: Array<{ targetId: string; mod: Modifier }>): void {
    if (entries.length === 0 && !this.bySource.has(sourceId)) return
    if (entries.length === 0) this.bySource.delete(sourceId)
    else this.bySource.set(sourceId, entries)
    this.indexDirty = true
    this._epoch++
  }

  /** Add a single modifier under its own source id. Convenient for one-off event effects. */
  add(sourceId: string, targetId: string, mod: Modifier): void {
    const list = this.bySource.get(sourceId) ?? []
    list.push({ targetId, mod })
    this.bySource.set(sourceId, list)
    this.indexDirty = true
    this._epoch++
  }

  clearSource(sourceId: string): void {
    if (this.bySource.delete(sourceId)) {
      this.indexDirty = true
      this._epoch++
    }
  }

  /** Drop modifiers whose expiry has passed. Called once per tick by the world. */
  pruneExpired(tick: number): void {
    let changed = false
    for (const [sourceId, entries] of this.bySource) {
      const kept = entries.filter((e) => e.mod.expiresTick === undefined || e.mod.expiresTick > tick)
      if (kept.length !== entries.length) {
        changed = true
        if (kept.length === 0) this.bySource.delete(sourceId)
        else this.bySource.set(sourceId, kept)
      }
    }
    if (changed) {
      this.indexDirty = true
      this._epoch++
    }
  }

  private rebuildIndex(): void {
    this.index = new Map()
    for (const entries of this.bySource.values()) {
      for (const e of entries) {
        const k = key(e.targetId, e.mod.param)
        const list = this.index.get(k)
        if (list) list.push(e.mod)
        else this.index.set(k, [e.mod])
      }
    }
    this.indexDirty = false
  }

  /** All modifiers acting on one parameter of one target. */
  lookup(targetId: string, param: Param): Modifier[] {
    if (this.indexDirty) this.rebuildIndex()
    return this.index.get(key(targetId, param)) ?? []
  }

  /** Total number of registered modifiers. Diagnostics only. */
  size(): number {
    let n = 0
    for (const entries of this.bySource.values()) n += entries.length
    return n
  }
}

/** Convenience builder for the common "this is N% worse" case. */
export function frac(
  layer: Layer,
  param: Param,
  value: number,
  sourceKind: Modifier['sourceKind'],
  sourceId: string,
  reasonKey: string,
  reasonParams?: Record<string, string | number>,
): Modifier {
  const m: Modifier = { layer, param, op: Op.AddFrac, value, sourceKind, sourceId, reasonKey }
  if (reasonParams) m.reasonParams = reasonParams
  return m
}

/** Convenience builder for absolute offsets. */
export function abs(
  layer: Layer,
  param: Param,
  value: number,
  sourceKind: Modifier['sourceKind'],
  sourceId: string,
  reasonKey: string,
  reasonParams?: Record<string, string | number>,
): Modifier {
  const m: Modifier = { layer, param, op: Op.AddAbs, value, sourceKind, sourceId, reasonKey }
  if (reasonParams) m.reasonParams = reasonParams
  return m
}
