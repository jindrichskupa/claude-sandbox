/**
 * Lines that age, fault and can be renewed.
 *
 * Until now a corridor was scenery. Power stations had condition, wear, maintenance, forced
 * outages, refurbishment and — since the wear-out model — the possibility of failing beyond
 * repair. A transmission line had a `builtTick` and nothing else: it never got worse, never
 * failed, never cost anything to keep, and the only thing the player could ever do to one was
 * string a second circuit. So the whole ageing-and-renewal half of the game applied to generation
 * only, in a game whose own premise is that the corridor is the interesting constraint.
 *
 * ## Three things a line does that a station does not
 *
 * **It costs money to own even when nothing is flowing.** Vegetation management, tower painting,
 * insulator washing, patrols, easement payments. The content has carried `fixedOpexPerKmYear`
 * since the first milestone and nobody was ever charged it, which meant the network was free —
 * and a network that is free is one the player has no reason to think about.
 *
 * **It faults, individually and briefly.** Not the forced outage of a machine, which is measured
 * in weeks: lightning, a tree, ice, an excavator, and it is back inside a day. What makes that
 * interesting is not the duration but the *place* — a corridor down for eighteen hours in a
 * February peak is a region islanded from its generation, and the min-cost flow already models
 * exactly that. This is where a network with no redundancy stops being an economy and becomes a
 * risk.
 *
 * **It is renewed rather than replaced.** Towers and foundations outlive several generations of
 * the plant they connect; what wears out is the conductor and the fittings. So a line's answer to
 * age is re-conductoring at about a third of the cost of a new one — and the reason the voltage
 * upgrade path exists at all is that while the towers are down, rebuilding to a higher standard
 * is a fraction of what it would cost on a green field.
 *
 * ## Why faults are not events
 *
 * The event director already has storms that cut ratings across the network. This is the other
 * thing: a specific line, out now, for a day. Keeping them apart matters because they teach
 * different lessons — a storm is weather the player insures against, and a fault on the one
 * corridor feeding a city is a design flaw they built themselves.
 */

import { LINE_TYPES } from '@content/lineTypes'
import { RELIABILITY } from '@content/reliability'
import { TICKS_PER_YEAR } from '../core/time'
import { Layer, Op, Param, type Modifier } from '../params/types'
import type { GridEdge } from './network'

export const LINE_AGE_SOURCE = 'line-age'

/** Age of a line in years. Scenario lines carry a negative `builtTick`, exactly as plants do. */
export function lineAgeYears(edge: GridEdge, tick: number): number {
  return Math.max(0, (tick - edge.builtTick) / TICKS_PER_YEAR)
}

/** How far through its design life, where 1 means it has reached the end of it. */
export function lineLifeFraction(edge: GridEdge, tick: number): number {
  if (edge.kv === 0) return 0
  const life = LINE_TYPES[edge.kv].designLifeYears.value
  return lineAgeYears(edge, tick) / Math.max(1, life)
}

/**
 * Condition a line of this age should have settled at.
 *
 * Gentler than a power station's, and it should be: there is no combustion, no rotating mass and
 * no thermal cycling in a conductor, only corrosion, fatigue at the clamps and forty years of
 * weather. A line at the end of its design life is worn, not wrecked.
 */
export function expectedLineCondition(edge: GridEdge, tick: number): number {
  const f = lineLifeFraction(edge, tick)
  if (f <= 1) return Math.max(0, 1 - 0.3 * f)
  return Math.max(0.25, 0.7 - 0.35 * (f - 1))
}

/** Drift one tick towards the condition the line's age implies. */
export function advanceLineCondition(edge: GridEdge, tick: number): void {
  if (edge.commodity !== 'electric' || edge.kv === 0) return
  const target = expectedLineCondition(edge, tick)
  edge.conditionPct += (target - edge.conditionPct) * 0.002
  edge.conditionPct = Math.max(0, Math.min(1, edge.conditionPct))
}

/**
 * Faults per year on this corridor, right now.
 *
 * Length matters most — a fault is a thing that happens *somewhere along* a line, so a corridor
 * twice as long faults twice as often. Voltage matters because higher levels are built to a
 * higher standard, which is a real argument for 220 over more 110 and one the player can now
 * discover. Condition and maintenance are the two levers they hold.
 *
 * Shared with the forecast that warns about it, for the same reason the plant version is: the
 * warning and the dice must not be able to disagree.
 */
export function lineFaultRate(edge: GridEdge, maintenanceLevel: number): number {
  if (edge.commodity !== 'electric' || edge.kv === 0) return 0
  const base = (LINE_TYPES[edge.kv].faultsPer100KmYear.value * edge.lengthKm) / 100
  // Same shape as a machine's: neglect roughly triples the rate at the bottom of the scale.
  const wear = 1 + (1 - edge.conditionPct) * 2
  return (base * wear) / Math.max(0.1, maintenanceLevel)
}

/**
 * What age has taken off a corridor's usable rating.
 *
 * A worn line is derated rather than disconnected: sagging clearances in hot weather, joints that
 * run warm, fittings the operator will not push. Small — a few percent — but it lands precisely on
 * the constraint the scenario is built around, and it is the mechanism by which a network left
 * alone slowly stops being able to do the job it was designed for.
 */
export function lineAgingModifiers(edges: GridEdge[]): Array<{ targetId: string; mod: Modifier }> {
  const out: Array<{ targetId: string; mod: Modifier }> = []
  for (const edge of edges) {
    if (edge.commodity !== 'electric' || edge.kv === 0) continue
    const derate = -Math.min(0.25, (1 - edge.conditionPct) * 0.3)
    if (derate > -0.005) continue
    out.push({
      targetId: edge.id,
      mod: {
        layer: Layer.Age,
        param: Param.LineCapacityMw,
        op: Op.AddFrac,
        value: derate,
        sourceKind: 'age',
        sourceId: LINE_AGE_SOURCE,
        reasonKey: 'reason.lineCondition',
        reasonParams: { condition: Math.round(edge.conditionPct * 100) },
      },
    })
  }
  return out
}

/**
 * How long this fault takes to clear, in ticks.
 *
 * The type's own repair time, stretched by how worn the line is — an old corridor is one where
 * the fault is harder to find, the spares are obsolete and the access roads have not been
 * maintained either.
 */
export function repairTicks(edge: GridEdge): number {
  if (edge.kv === 0) return 24
  const base = LINE_TYPES[edge.kv].repairHours.value
  return Math.max(1, Math.round(base * (1 + (1 - edge.conditionPct))))
}

/**
 * Whether a line is old enough that re-conductoring is worth offering.
 *
 * Deliberately not "past its design life". Renewal is a decision taken *before* the thing falls
 * over, and offering it only once the corridor is failing would make it a repair rather than a
 * plan — which is exactly the mistake the game is trying to let the player avoid.
 */
export function isWorthRenewing(edge: GridEdge, tick: number): boolean {
  return lineLifeFraction(edge, tick) > 0.5
}

/**
 * The wear factor a line's fault rate carries past design life.
 *
 * The same bathtub shape the fleet uses — see `content/reliability.ts` — because it is the same
 * physics. Lines do not fail beyond repair, though: a corridor is rebuilt on its own towers, and
 * "beyond economic repair" for a transmission line just means the renewal is overdue.
 */
export function lineWearFactor(edge: GridEdge, tick: number): number {
  const overrun = Math.max(0, lineLifeFraction(edge, tick) - 1)
  return Math.pow(1 + overrun, RELIABILITY.wearOutExponent.value)
}
