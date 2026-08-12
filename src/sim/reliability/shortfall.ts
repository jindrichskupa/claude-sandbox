/**
 * Why the lights went out, recorded as it happens.
 *
 * A post-mortem is worth having only if it is true, and the obvious version of this one would not
 * have been. The first design said "your firm capacity fell behind demand" and would have been
 * confidently wrong about the opening scenario: it fails its reliability objective in year one
 * while carrying 2530 MW of firm plant against an average demand of 909 MW — a 178% margin. A
 * probe over every failing hour of that year found 129 of the 163 were a *network* failure, not a
 * generation one. A single-circuit 220 kV line, thirty-five years old and the only link to the
 * north, faults; the north becomes an island with 25 MW of hydro in it and 175 MW of demand; and
 * two thousand megawatts of spare plant on the other side of the break cannot help.
 *
 * That is the whole reason this exists rather than a rule of thumb over the yearbook. The player
 * is owed the cause that actually applied, and the causes are genuinely different problems with
 * genuinely different answers — build a station, restring a corridor, mend a line, hold more
 * reserve. Telling them the wrong one wastes years of their run.
 *
 * Recorded as the hour passes rather than reconstructed at the end, because the state that
 * explains an hour — what was online, what was faulted, how the graph was cut — is gone by the
 * next one and replaying thirty years to find out is not an option.
 */

import { PLANT_TYPES } from '@content/plantTypes'
import { isDispatchable, type PlantAsset } from '../assets/types'
import type { Islands } from '../grid/islands'
import type { Network, NodeId } from '../grid/network'
import type { CityAsset } from '../assets/types'

/**
 * The ways a system fails to deliver, in the order they are tested.
 *
 * The order matters and is not arbitrary: it runs from the most specific explanation to the least,
 * so an hour is attributed to the smallest cause that accounts for it. An islanded town is short
 * whatever the fleet is doing, so islanding is decided first; a system genuinely without enough
 * plant would be short even with a perfect network, so capacity comes before the corridor; and a
 * fleet that is big enough but could not get there in time is `ramp` rather than `capacity`,
 * because the two have opposite answers — one says build more, the other says build something
 * quicker or put a store beside it.
 *
 * `unexplained` exists rather than a catch-all guess, because a post-mortem that quietly rounds
 * the unknown into the nearest known cause is exactly the lie this file was written to avoid. It
 * has also already earned its keep: thirty-six hours of the opening year landed there and were
 * not a mystery at all, but two cogeneration sets held down by their heat duty. The category is
 * what made them findable.
 */
export type ShortfallCause = 'islanded' | 'capacity' | 'ramp' | 'corridor' | 'unexplained'

export const SHORTFALL_CAUSES: ShortfallCause[] = [
  'islanded',
  'capacity',
  'ramp',
  'corridor',
  'unexplained',
]

/** Heat fails in two ways, and they are not the same problem at all. */
export type HeatShortfallCause = 'unconnected' | 'heatCapacity'

export interface ShortfallTally {
  hours: number
  mwh: number
  /** Energy not delivered, per city, so the worst-hit place can be named. */
  byCity: Record<string, number>
  /**
   * Energy short while a given line was out, per line.
   *
   * Only filled for `islanded`, and it is the actionable half of the whole file: the answer to a
   * town cut off is a name, not a category. A line counts here when it is down *and* mending it
   * would have rejoined the island to the rest of the system — which is a stronger claim than
   * "some line was broken somewhere".
   */
  byMissingLine: Record<string, number>
}

export interface ShortfallState {
  electric: Record<string, ShortfallTally>
  heat: Record<string, ShortfallTally>
}

function emptyTally(): ShortfallTally {
  return { hours: 0, mwh: 0, byCity: {}, byMissingLine: {} }
}

export function emptyShortfallState(): ShortfallState {
  return { electric: {}, heat: {} }
}

/** What one hour of failure looked like, before it is folded into the totals. */
export interface HourFacts {
  cause: ShortfallCause
  totalUnservedMw: number
  unservedByCity: Map<string, number>
  /** Lines whose repair would have reconnected a short island. Empty unless islanded. */
  missingLines: string[]
}

/**
 * Which cities were cut off from enough generation to serve them.
 *
 * "Cut off" is a statement about the island a town is in, not about the country: an island holding
 * a town and one small hydro station is short even when the rest of the map is awash. Compared
 * against the island's *own* demand and its *own* plant, which is the only comparison that means
 * anything once the graph is in pieces.
 */
/**
 * The two ceilings on one unit, which answer different questions.
 *
 * `structural` is what it could deliver given a free hand and enough notice: its capacity, less
 * what age and outage have taken, and never above what its heat duty leaves it. `now` is what the
 * dispatch could actually call on this hour, which is the same thing with the ramp limit applied.
 *
 * A shortfall against `structural` is a fleet that is too small. A shortfall against `now` alone
 * is a fleet that is big enough and could not get there in time — a different problem with a
 * different answer, and one worth being able to tell a player about.
 */
export interface PlantCeilings {
  structural: number
  now: number
}

function islandedCities(
  shortCities: Array<{ city: CityAsset; mw: number }>,
  islands: Islands,
  plants: PlantAsset[],
  cities: CityAsset[],
  ceilings: Map<string, PlantCeilings>,
  demandOf: (cityId: string) => number,
): Set<string> {
  const stranded = new Set<string>()
  if (islands.count <= 1) return stranded

  // Available generation and total demand, per island, computed once for the hour.
  const supply = new Map<number, number>()
  const demand = new Map<number, number>()
  for (const plant of plants) {
    if (!isDispatchable(plant) || !plant.online) continue
    if (PLANT_TYPES[plant.typeId].heatOnly) continue
    const island = islands.islandOf.get(plant.nodeId)
    if (island === undefined) continue
    // The structural ceiling, because a town on the wrong side of a break is cut off whether or
    // not the plant it cannot reach could have ramped in time.
    supply.set(island, (supply.get(island) ?? 0) + (ceilings.get(plant.id)?.structural ?? 0))
  }
  for (const city of cities) {
    const island = islands.islandOf.get(city.nodeId)
    if (island === undefined) continue
    demand.set(island, (demand.get(island) ?? 0) + demandOf(city.id))
  }

  for (const { city } of shortCities) {
    const island = islands.islandOf.get(city.nodeId)
    if (island === undefined) continue
    if ((supply.get(island) ?? 0) < (demand.get(island) ?? 0)) stranded.add(city.id)
  }
  return stranded
}

/**
 * Lines whose repair would have put a short island back in touch with the rest of the system.
 *
 * A de-energised line with one end inside the island and one end outside it is, by definition, a
 * cut in the graph at exactly the place that matters. Anything else that happens to be broken
 * elsewhere is somebody else's problem this hour, and naming it would send the player to mend the
 * wrong thing.
 */
function missingLinksTo(
  strandedNodes: Set<NodeId>,
  network: Network,
  islands: Islands,
): string[] {
  const out: string[] = []
  for (const edge of network.allEdges()) {
    if (edge.commodity !== 'electric' || edge.energised) continue
    const from = strandedNodes.has(edge.from)
    const to = strandedNodes.has(edge.to)
    if (from === to) continue
    // The far end must actually lead somewhere else, rather than to another corner of the same
    // island reached by a different route.
    if (islands.islandOf.get(edge.from) === islands.islandOf.get(edge.to)) continue
    out.push(edge.id)
  }
  return out
}

/**
 * Whether a corridor is at its limit, which is a different failure from having too little plant.
 *
 * The rating comes from the caller, which reads it the way the dispatch does. Taking it from the
 * catalogue instead is the same mistake as counting a cogeneration set at nameplate, and it was
 * made here too: a thirty-five-year-old 110 kV line rated 150 MW new was carrying 139 MW and
 * reported as 93% full, while the dispatch — which derates a worn corridor — had it hard against
 * its limit. Twenty-nine hours of the opening year were `unexplained` for that reason alone.
 */
function saturatedLines(
  network: Network,
  flowMw: Map<string, number>,
  capacityOf: (edgeId: string) => number,
): boolean {
  for (const edge of network.allEdges()) {
    if (edge.commodity !== 'electric' || edge.kv === 0 || !edge.energised) continue
    const capacity = capacityOf(edge.id)
    if (capacity > 0 && Math.abs(flowMw.get(edge.id) ?? 0) > capacity * 0.98) return true
  }
  return false
}

export interface ClassifyInput {
  network: Network
  islands: Islands
  plants: PlantAsset[]
  cities: CityAsset[]
  unservedByCity: Map<string, number>
  totalUnservedMw: number
  /**
   * Everything the generators actually had to cover: the towns, the losses in getting there, and
   * whatever the heat network's pumps and the stores were drawing. City demand alone would
   * understate it by the seventy-odd megawatts of line loss the opening scenario runs at.
   */
  totalLoadMw: number
  /**
   * What each unit could have delivered, structurally and this hour, from the same function the
   * dispatch itself bounded them with.
   *
   * Reading the ceiling off the catalogue instead is what produced the thirty-six unexplained
   * hours. The dump of one of them is unambiguous: every unit at its limit, the two cogeneration
   * sets held to 67 of 85 MW and 80 of 107 by their heat duty, and the town eight megawatts
   * short. Counting those two at nameplate availability meant a system with 45 MW it did not
   * have, and a post-mortem shrugging at a shortage it could perfectly well explain. Heat is led
   * and electricity is what is left over — the most characteristic constraint this game has, and
   * the one the post-mortem was blind to.
   */
  ceilings: Map<string, PlantCeilings>
  lineFlowMw: Map<string, number>
  /** A corridor's rating as the dispatch saw it, worn and modified, not as the catalogue has it. */
  lineCapacityMw: (edgeId: string) => number
  /** Demand seen by each city this hour, served plus unserved. */
  demandOf: (cityId: string) => number
}

/** What went wrong this hour, decided from what the dispatch had in front of it. */
export function classifyHour(input: ClassifyInput): HourFacts {
  const shortCities: Array<{ city: CityAsset; mw: number }> = []
  for (const [cityId, mw] of input.unservedByCity) {
    if (mw <= 0.01) continue
    const city = input.cities.find((c) => c.id === cityId)
    if (city) shortCities.push({ city, mw })
  }

  const stranded = islandedCities(
    shortCities,
    input.islands,
    input.plants,
    input.cities,
    input.ceilings,
    input.demandOf,
  )

  if (stranded.size > 0) {
    const nodes = new Set<NodeId>()
    for (const { city } of shortCities) {
      if (!stranded.has(city.id)) continue
      const island = input.islands.islandOf.get(city.nodeId)
      if (island === undefined) continue
      for (const nodeId of input.islands.members[island] ?? []) nodes.add(nodeId)
    }
    return {
      cause: 'islanded',
      totalUnservedMw: input.totalUnservedMw,
      unservedByCity: input.unservedByCity,
      missingLines: missingLinksTo(nodes, input.network, input.islands),
    }
  }

  // What the fleet had, and what it could get to in one hour.
  let structural = 0
  let now = 0
  for (const plant of input.plants) {
    if (!isDispatchable(plant) || !plant.online) continue
    if (PLANT_TYPES[plant.typeId].heatOnly) continue
    const ceiling = input.ceilings.get(plant.id)
    if (!ceiling) continue
    structural += ceiling.structural
    now += ceiling.now
  }

  const cause: ShortfallCause =
    structural < input.totalLoadMw
      ? 'capacity'
      : now < input.totalLoadMw
        ? 'ramp'
        : saturatedLines(input.network, input.lineFlowMw, input.lineCapacityMw)
          ? 'corridor'
          : 'unexplained'

  return { cause, totalUnservedMw: input.totalUnservedMw, unservedByCity: input.unservedByCity, missingLines: [] }
}

/**
 * The running record. Kept on the world and saved with it, because it is the accumulated history
 * of every failing hour of the run and nothing short of replaying the run would rebuild it.
 */
export class ShortfallLog {
  constructor(private state: ShortfallState = emptyShortfallState()) {}

  private tally(side: 'electric' | 'heat', cause: string): ShortfallTally {
    const bucket = this.state[side]
    const existing = bucket[cause]
    if (existing) return existing
    const created = emptyTally()
    bucket[cause] = created
    return created
  }

  record(facts: HourFacts): void {
    const tally = this.tally('electric', facts.cause)
    tally.hours++
    tally.mwh += facts.totalUnservedMw
    for (const [cityId, mw] of facts.unservedByCity) {
      if (mw <= 0.01) continue
      tally.byCity[cityId] = (tally.byCity[cityId] ?? 0) + mw
    }
    // The whole hour's shortfall against each line that would have relieved it. Deliberately not
    // divided between them: two breaks that each stranded the same town are each fully responsible
    // for it, and splitting the blame would make a corridor look half as urgent as it is.
    for (const edgeId of facts.missingLines) {
      tally.byMissingLine[edgeId] = (tally.byMissingLine[edgeId] ?? 0) + facts.totalUnservedMw
    }
  }

  recordHeat(cause: HeatShortfallCause, mwByCity: Map<string, number>, totalMw: number): void {
    const tally = this.tally('heat', cause)
    tally.hours++
    tally.mwh += totalMw
    for (const [cityId, mw] of mwByCity) {
      if (mw <= 0.01) continue
      tally.byCity[cityId] = (tally.byCity[cityId] ?? 0) + mw
    }
  }

  /** Causes with anything against them, worst first by energy. */
  ranked(side: 'electric' | 'heat' = 'electric'): Array<{ cause: string; tally: ShortfallTally }> {
    return Object.entries(this.state[side])
      .filter(([, tally]) => tally.mwh > 0.01)
      .map(([cause, tally]) => ({ cause, tally }))
      .sort((a, b) => b.tally.mwh - a.tally.mwh)
  }

  /** The single thing that most explains the run, or null if nothing ever went short. */
  dominant(side: 'electric' | 'heat' = 'electric'): { cause: string; tally: ShortfallTally } | null {
    return this.ranked(side)[0] ?? null
  }

  /** Total energy not delivered, across every cause. */
  totalMwh(side: 'electric' | 'heat' = 'electric'): number {
    return Object.values(this.state[side]).reduce((sum, tally) => sum + tally.mwh, 0)
  }

  toJSON(): ShortfallState {
    return this.state
  }

  /** Adopt a saved log, or an empty one for a save that predates this being recorded. */
  replace(state: ShortfallState | undefined): void {
    this.state = state ?? emptyShortfallState()
  }

  static fromJSON(state: ShortfallState | undefined): ShortfallLog {
    return new ShortfallLog(state ?? emptyShortfallState())
  }
}

/** The worst-hit entry of a `byCity` or `byMissingLine` map, which is what a headline names. */
export function worstOf(record: Record<string, number>): { id: string; mwh: number } | null {
  let best: { id: string; mwh: number } | null = null
  for (const [id, mwh] of Object.entries(record)) {
    if (!best || mwh > best.mwh) best = { id, mwh }
  }
  return best
}
