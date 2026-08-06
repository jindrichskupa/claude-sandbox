/**
 * What the player is looking at, and what needs attention now.
 *
 * The playability review's verdict was that this game is not too hard and not too complex — it is
 * too *passive and badly introduced*. A new player arrives to a map of thirteen stations they did
 * not build, a clock already running, and six panels, and nothing anywhere says what the situation
 * is or what would be a reasonable first move. They then watch a load curve breathe for a few
 * minutes and conclude, not unreasonably, that there is nothing to do. Everything that is wrong
 * with the first ten minutes is that sentence.
 *
 * ## Read, never authored
 *
 * Every line here is measured from the world at the moment it is asked for. None of it is written
 * prose about the scenario, and that is the whole design: authored briefing text is correct on the
 * day it is written and quietly wrong forever after, because the numbers it describes live in
 * `content/` and move. A brief that says "you have 2.5 GW against a 1.5 GW peak" has to be reading
 * the fleet, or the first balance change makes a liar of it.
 *
 * It also means this works for any scenario, including ones that do not exist yet, which is the
 * other reason not to write it by hand.
 *
 * ## Facts, not advice
 *
 * The opening brief states the position; it does not tell the player what to do about it. That is
 * a deliberate line, and it is the same line the neutrality rule draws everywhere else in this
 * project: the moment a briefing says "you should build gas", the game has an opinion about the
 * answer, and the player is following instructions rather than running a system. Naming the
 * constraint is help; naming the solution is not.
 *
 * `nextConcern` sits just on the permitted side of it. It says what is *about to go wrong* — a
 * station reaching the end of its life with nothing replacing it, a fleet that will not cover the
 * winter — and stops there. What to do about it is the game.
 */

import { PLANT_TYPES } from '@content/plantTypes'
import { LINE_TYPES, type VoltageLevel } from '@content/lineTypes'
import { isDispatchable, LifecyclePhase } from '../assets/types'
import { ageYears, lifeFraction } from '../assets/aging'
import { Param } from '../params/types'
import { TICKS_PER_YEAR } from '../core/time'
import type { World } from '../world'

/** One statement of fact about the position, with the numbers already in it. */
export interface BriefLine {
  key: string
  params: Record<string, string | number>
}

/**
 * Something about to go wrong, and what it is about.
 *
 * `subjectId` is a node, plant or edge, so the interface can take the player to it — the same
 * convention the news desk uses, and for the same reason: a warning you cannot point at is a
 * warning the player has to go and find.
 */
export interface Concern {
  key: string
  params: Record<string, string | number>
  subjectId?: string
  subjectKind?: 'node' | 'plant' | 'edge'
}

/** Firm capacity as the dispatch will actually see it, not as the catalogue lists it. */
export function availableFirmMw(world: World): number {
  let mw = 0
  for (const plant of world.plants) {
    if (plant.phase !== LifecyclePhase.Operating) continue
    const type = PLANT_TYPES[plant.typeId]
    if (type.heatOnly || type.weatherDependence !== 'none' || !isDispatchable(plant)) continue
    const capacity = world.params.get(plant.id, Param.CapacityMw)
    const availability = world.params.getOr(plant.id, Param.Availability, 1)
    mw += capacity * Math.max(0, Math.min(1, availability))
  }
  return mw
}

/** Total demand right now, or the base demand if the world has not dispatched yet. */
function demandMw(world: World): number {
  const now = world.lastDispatch?.totalDemandMw ?? 0
  if (now > 0) return now
  return world.cities.reduce((sum, city) => sum + city.baseDemandMw, 0)
}

/** The station nearest the end of its life, which is the one the scenario is usually about. */
function oldest(world: World) {
  let worst: { id: string; fraction: number } | null = null
  for (const plant of world.plants) {
    if (plant.phase !== LifecyclePhase.Operating) continue
    if (PLANT_TYPES[plant.typeId].heatOnly) continue
    const fraction = lifeFraction(plant, world.tick)
    if (!worst || fraction > worst.fraction) worst = { id: plant.id, fraction }
  }
  return worst
}

/**
 * The position, in five lines.
 *
 * Enough to know what was inherited and what it is judged against, and no more: a briefing long
 * enough to skim past is a briefing nobody reads, and the panels are all still there for anybody
 * who wants the detail.
 */
export function openingBrief(world: World): BriefLine[] {
  const lines: BriefLine[] = []
  const firm = availableFirmMw(world)
  const demand = demandMw(world)

  lines.push({
    key: 'brief.fleet',
    params: {
      firm: Math.round(firm),
      demand: Math.round(demand),
      margin: demand > 0 ? Math.round((firm / demand - 1) * 100) : 0,
    },
  })

  const worst = oldest(world)
  if (worst) {
    const plant = world.getPlant(worst.id)!
    const left = Math.round(plant.designLifeYears - ageYears(plant, world.tick))
    lines.push({
      key: left > 0 ? 'brief.ageing' : 'brief.overdue',
      params: {
        plant: world.plantDisplayName(plant.id),
        mw: Math.round(world.params.get(plant.id, Param.CapacityMw)),
        years: Math.abs(left),
      },
    })
  }

  // The corridor most likely to be the constraint: longest at the lowest voltage carrying the
  // most. Named rather than diagnosed — whether it actually binds is for the player to find out,
  // and `paceProbe` says it usually does not bind first, which is exactly why this does not claim
  // that it does.
  let tightest: { id: string; loading: number } | null = null
  for (const edge of world.network.allEdges()) {
    if (edge.commodity !== 'electric' || edge.kv === 0) continue
    const capacity = LINE_TYPES[edge.kv as VoltageLevel].capacityMw.value * Math.max(1, edge.circuits)
    const flow = Math.abs(world.lastDispatch?.lineFlowMw.get(edge.id) ?? 0)
    const loading = capacity > 0 ? flow / capacity : 0
    if (!tightest || loading > tightest.loading) tightest = { id: edge.id, loading }
  }
  if (tightest && tightest.loading > 0.3) {
    const edge = world.network.getEdge(tightest.id)!
    lines.push({
      key: 'brief.corridor',
      params: {
        from: world.nodeName(edge.from),
        to: world.nodeName(edge.to),
        pct: Math.round(tightest.loading * 100),
      },
    })
  }

  lines.push({
    key: 'brief.money',
    params: {
      cash: Math.round(world.finances.cash / 1e6),
      debt: Math.round(world.finances.debt / 1e6),
      tariff: Math.round(world.state.regulatedTariffPerMwh),
    },
  })

  lines.push({
    key: 'brief.deadline',
    params: { year: world.scenario.endYear, years: world.scenario.endYear - world.scenario.startYear },
  })

  return lines
}

/**
 * The most pressing thing, or nothing at all.
 *
 * Ordered by how soon it becomes irreversible rather than by how large it is, because that is the
 * ordering a player cannot work out for themselves without having played the scenario once. A
 * station reaching end of life outranks a thin margin, because building takes years and the margin
 * can be fixed in a season; both outrank money, which is a symptom of the other two.
 *
 * Returns null when there is genuinely nothing — a quiet system should say so by being quiet,
 * and an interface that always has a warning on it has no warnings at all.
 */
export function nextConcern(world: World): Concern | null {
  const building = world.plants.some((p) => p.phase === LifecyclePhase.Building)

  // 1. A station at the end of its life with nothing on the way. The one thing that cannot be
  //    fixed once it happens, because the replacement takes years the player no longer has.
  for (const plant of world.plants) {
    if (plant.phase !== LifecyclePhase.Operating) continue
    const type = PLANT_TYPES[plant.typeId]
    if (type.heatOnly) continue
    const left = plant.designLifeYears - ageYears(plant, world.tick)
    if (left > 5 || building) continue
    return {
      key: left > 0 ? 'concern.endOfLife' : 'concern.pastLife',
      params: {
        plant: world.plantDisplayName(plant.id),
        mw: Math.round(world.params.get(plant.id, Param.CapacityMw)),
        years: Math.max(0, Math.round(left)),
        months: Math.round(type.buildTimeMonths.value),
      },
      subjectId: plant.id,
      subjectKind: 'plant',
    }
  }

  // 2. Not enough plant that will actually turn up. Measured against what the system has already
  //    been asked for, so it is a fact about this run rather than a rule of thumb.
  // The highest demand the system has actually been asked for, out of the snapshot ring — which
  // holds a year, and a year is exactly the window a system is sized against.
  const firm = availableFirmMw(world)
  let peak = 0
  for (const snapshot of world.recentHistory(TICKS_PER_YEAR)) {
    if (snapshot.demandMw > peak) peak = snapshot.demandMw
  }
  if (peak > 0 && firm < peak * 1.1) {
    return {
      key: 'concern.thinMargin',
      params: { firm: Math.round(firm), peak: Math.round(peak) },
    }
  }

  // 3. The lights went out recently. Last, not first, because by the time this fires the other
  //    two have usually been true for years — it is the symptom, and the player has already been
  //    told about the causes.
  if (world.lastMonthLedger.energyUnservedMwh > 0) {
    return {
      key: 'concern.unserved',
      params: { mwh: Math.round(world.lastMonthLedger.energyUnservedMwh) },
    }
  }

  // 4. Money, once it is clearly going the wrong way rather than merely dipping in a bad month.
  if (world.finances.cash <= 0 && world.finances.debt > 0) {
    return {
      key: 'concern.borrowing',
      params: { debt: Math.round(world.finances.debt / 1e6) },
    }
  }

  return null
}

/** How long, in years, until the scenario is judged. For a header that counts down. */
export function yearsLeft(world: World): number {
  return Math.max(0, world.scenario.endYear - world.date.year - world.tick / TICKS_PER_YEAR + Math.floor(world.tick / TICKS_PER_YEAR))
}
