/**
 * Storage and lookup for modifiers.
 *
 * Modifiers are grouped by the system that produced them, because that is how they are
 * replaced: the weather system recomputes its whole contribution every tick and hands it
 * over in one call, rather than trying to remove yesterday's entries one by one.
 */

import { Layer, Op, type Modifier, type Param } from './types'

/**
 * Target id meaning "everything".
 *
 * A modifier registered against this applies to every asset in the game, on top of whatever is
 * registered against the asset itself. It exists because several real forces genuinely are
 * global — an interest-rate shock raises the cost of *all* capital, a permitting slowdown
 * lengthens *all* builds, a carbon price touches everything that burns — and the alternative
 * would be for each such force to enumerate the fleet and re-register itself every time the
 * player builds something. That enumeration is exactly the kind of bookkeeping that quietly
 * goes wrong.
 */
export const ALL_TARGETS = '*'

export interface Entry {
  targetId: string
  mod: Modifier
}

function key(targetId: string, param: Param): string {
  return `${targetId}|${param}`
}

export class ModifierRegistry {
  private readonly bySource = new Map<string, Entry[]>()
  private index = new Map<string, Modifier[]>()
  /** Modifiers registered against `ALL_TARGETS`, keyed by parameter alone. */
  private globalIndex = new Map<string, Modifier[]>()
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
    this.globalIndex = new Map()
    for (const entries of this.bySource.values()) {
      for (const e of entries) {
        const target = e.targetId === ALL_TARGETS ? this.globalIndex : this.index
        const k = e.targetId === ALL_TARGETS ? String(e.mod.param) : key(e.targetId, e.mod.param)
        const list = target.get(k)
        if (list) list.push(e.mod)
        else target.set(k, [e.mod])
      }
    }
    this.indexDirty = false
  }

  /** All modifiers acting on one parameter of one target, including the global ones. */
  lookup(targetId: string, param: Param): Modifier[] {
    if (this.indexDirty) this.rebuildIndex()
    const own = this.index.get(key(targetId, param))
    const global = this.globalIndex.get(String(param))
    // The overwhelmingly common case is neither, and the next is one or the other. Only
    // allocate a joined array when both actually exist.
    if (!global) return own ?? []
    if (!own) return global
    return [...own, ...global]
  }

  /**
   * Everything registered, as plain data.
   *
   * Only exists for saving a game. Most sources re-register themselves within a tick or a month
   * — weather every hour, ageing and policy every month — but an event's effects carry an expiry
   * and belong to an event that is already in force, so they cannot be recomputed from anything
   * cheaper than the save itself.
   */
  toJSON(): Array<{ sourceId: string; entries: Entry[] }> {
    return [...this.bySource].map(([sourceId, entries]) => ({ sourceId, entries }))
  }

  /** Replace everything with a saved snapshot. */
  loadJSON(data: Array<{ sourceId: string; entries: Entry[] }>): void {
    this.bySource.clear()
    for (const { sourceId, entries } of data) this.bySource.set(sourceId, entries)
    this.indexDirty = true
    this._epoch++
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
