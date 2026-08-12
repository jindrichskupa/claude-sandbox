/**
 * The event director.
 *
 * Its job is not to roll dice. Any implementation can roll dice; what makes random adversity
 * bearable in a game about thirty-year investments is everything *around* the roll, and that is
 * what this file is. See the header of `content/events.ts` for the five mechanisms and why each
 * one is needed. Here is what they cost in code:
 *
 *   - **Forewarning** — an event is raised at one tick and lands at another, with the gap taken
 *     from its definition. Between the two the player can see it coming and choose a response.
 *   - **The severity budget** — an annual allowance of total severity, scaled to what the player
 *     could actually absorb. A utility with no borrowing headroom left simply gets fewer heavy
 *     events, which is the difference between a hard year and an unwinnable one.
 *   - **Grace period and cooldown** — nothing at all in the first year, and no second heavy blow
 *     for a month after the first.
 *   - **Counterplay** — every event carries choices, and taking one mitigates it. Deferred
 *     maintenance and insurance are standing decisions that move the odds before anything
 *     happens at all.
 *
 * Everything an event does goes out as a modifier through the parameter pipeline, tagged with
 * the event as its source, or as an explicit outage. Nothing here reaches into the dispatch, the
 * economy or the assets directly — which is why the inspector can explain any consequence back
 * to the event that caused it.
 */

import {
  EVENTS,
  EVENTS_BY_ID,
  layerForCategory,
  SEVERE_THRESHOLD,
  type EffectTarget,
  type EventChoice,
  type EventDef,
  type EventEffect,
  type RiskCondition,
} from '@content/events'
import { PLANT_TYPES } from '@content/plantTypes'
import { MONTHS_PER_YEAR, TICKS_PER_YEAR } from '../core/time'
import { lifeFraction } from '../assets/aging'
import { isDispatchable, LifecyclePhase, type CityAsset, type PlantAsset } from '../assets/types'
import type { Network } from '../grid/network'
import { ALL_TARGETS, type ModifierRegistry } from '../params/ModifierRegistry'
import { Op, type Modifier, type Param } from '../params/types'
import type { RandomStream } from '../core/rng'
import type { Weather } from '../weather/weather'
import type { Finances } from '../economy/economy'

/** An event that has been raised but has not landed yet. The player's window to respond. */
export interface PendingEvent {
  uid: string
  defId: string
  raisedTick: number
  /** When the effects land. Equal to `raisedTick` for events with no warning. */
  landsTick: number
  /** What the player picked, or null while they are still deciding. */
  choiceId: string | null
}

/** An event whose effects are currently in force. */
export interface ActiveEvent {
  uid: string
  defId: string
  landedTick: number
  /** When the last of its effects expires. */
  endsTick: number
  choiceId: string
  /** Plant the outage fell on, if any. */
  outagePlantId?: string
  outageUntilTick?: number
  /** Project this event held up, and by how many ticks, so the interface can name it. */
  delayedPlantId?: string
  delayTicks?: number
}

export interface DirectorState {
  pending: PendingEvent[]
  active: ActiveEvent[]
  /** Severity spent in the current year. Reset annually. */
  severitySpent: number
  /** Tick of the last severe event, for the cooldown. */
  lastSevereTick: number
  /** Everything that has landed, newest first. Capped, for the event log. */
  log: Array<{ uid: string; defId: string; tick: number; choiceId: string }>
  nextUid: number
}

export function emptyDirectorState(): DirectorState {
  return { pending: [], active: [], severitySpent: 0, lastSevereTick: -Infinity, log: [], nextUid: 1 }
}

/** No events at all before this much of the scenario has elapsed. */
const TICKS_PER_MONTH = TICKS_PER_YEAR / MONTHS_PER_YEAR

export const GRACE_TICKS = TICKS_PER_YEAR
/** After a severe event, no other severe event for this long. */
export const SEVERE_COOLDOWN_TICKS = 24 * 30
/** Severity points a year at a comfortable balance sheet. */
export const BASE_SEVERITY_BUDGET = 14
/** How long the log keeps entries. */
const LOG_LIMIT = 40

export interface DirectorContext {
  tick: number
  year: number
  weather: Weather
  plants: PlantAsset[]
  cities: CityAsset[]
  network: Network
  finances: Finances
  publicOpinion: number
  /** 0.6 deferred, 1 normal, 1.4 thorough. Multiplies fixed cost and divides failure risk. */
  maintenanceLevel: number
  insured: boolean
  /** Whether the system has failed to supply recently. Feeds the social risk factors. */
  recentBlackout: boolean
  registry: ModifierRegistry
  stream: RandomStream
}

// ---------------------------------------------------------------------------
// Risk
// ---------------------------------------------------------------------------

/** Share of dispatchable capacity burning a given fuel. */
function fuelShare(plants: PlantAsset[], fuels: string[]): number {
  let total = 0
  let matching = 0
  for (const p of plants) {
    if (!isDispatchable(p)) continue
    const type = PLANT_TYPES[p.typeId]
    total += type.capacityMw.value
    if (fuels.includes(type.fuel)) matching += type.capacityMw.value
  }
  return total > 0 ? matching / total : 0
}

/**
 * Whether a condition holds right now.
 *
 * A closed set with one implementation each, so the event table stays data. The thresholds are
 * deliberately blunt: this decides whether a rate is multiplied, not how much output a plant
 * makes, and precision here would be false precision.
 */
export function conditionHolds(condition: RiskCondition, context: DirectorContext): boolean {
  const { weather, plants, finances, tick } = context
  switch (condition) {
    case 'storm':
      return weather.stormIndex > 0.3
    case 'drought':
      return weather.riverFlowIndex < 0.6
    case 'heatwave':
      return weather.tempC > 28
    case 'freeze':
      return weather.tempC < -5
    case 'agedFleet': {
      const operating = plants.filter((p) => p.phase === LifecyclePhase.Operating)
      if (operating.length === 0) return false
      const mean = operating.reduce((sum, p) => sum + lifeFraction(p, tick), 0) / operating.length
      return mean > 0.75
    }
    case 'poorCondition': {
      const operating = plants.filter((p) => p.phase === LifecyclePhase.Operating)
      if (operating.length === 0) return false
      const mean = operating.reduce((sum, p) => sum + p.conditionPct, 0) / operating.length
      return mean < 0.7
    }
    case 'deferredMaintenance':
      return context.maintenanceLevel < 0.9
    case 'gasDependent':
      return fuelShare(plants, ['gas']) > 0.3
    case 'coalDependent':
      return fuelShare(plants, ['coal', 'lignite']) > 0.4
    case 'lowPublicOpinion':
      return context.publicOpinion < 0.35
    case 'heavilyIndebted':
      return finances.debt > finances.trailingRevenue * 2
    case 'recentBlackout':
      return context.recentBlackout
  }
}

/** Hourly probability of an event, after every condition that applies has multiplied it up. */
export function hourlyRate(def: EventDef, context: DirectorContext): number {
  let rate = def.baseRatePerYear.value
  for (const factor of def.riskFactors) {
    if (conditionHolds(factor.condition, context)) rate *= factor.multiplier.value
  }
  // Thorough maintenance buys down the technical risks and nothing else, which is honest:
  // no amount of it prevents a gas cut.
  if (def.category === 'technical' && context.maintenanceLevel > 1) {
    rate /= context.maintenanceLevel
  }
  // A rate above one event per hour is meaningless and would only come from a content mistake.
  return Math.min(0.5, rate / TICKS_PER_YEAR)
}

/**
 * How much severity the director will spend this year.
 *
 * Scaled by what the utility could put behind a problem, relative to its turnover. A player
 * with cash and borrowing headroom gets a full year of adversity; one that is already stretched
 * gets a quieter one. This is the single most important thing in the file for whether the game
 * is enjoyable, and it is deliberately not subtle.
 */
export function severityBudget(finances: Finances): number {
  const capacity = finances.cash + Math.max(0, finances.trailingRevenue * 4 - finances.debt)
  const ratio = capacity / Math.max(1, finances.trailingRevenue)
  return BASE_SEVERITY_BUDGET * Math.max(0.35, Math.min(1.5, ratio / 3))
}

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

/** Which target ids an effect lands on. */
function resolveTargets(
  target: EffectTarget,
  context: DirectorContext,
  stream: RandomStream,
  tick: number,
): string[] {
  switch (target.kind) {
    case 'world':
      return [ALL_TARGETS]
    case 'allCities':
      return context.cities.map((c) => c.id)
    case 'allLines':
      return context.network.allEdges().filter((e) => e.commodity === 'electric').map((e) => e.id)
    case 'byFuel':
      return context.plants.filter((p) => PLANT_TYPES[p.typeId].fuel === target.fuel).map((p) => p.id)
    case 'byCategory':
      return context.plants.filter((p) => PLANT_TYPES[p.typeId].category === target.category).map((p) => p.id)
    case 'onePlant': {
      const candidates = context.plants.filter((p) => {
        if (p.phase !== LifecyclePhase.Operating) return false
        const type = PLANT_TYPES[p.typeId]
        if (target.category && type.category !== target.category) return false
        if (target.fuel && type.fuel !== target.fuel) return false
        return true
      })
      if (candidates.length === 0) return []
      return [candidates[stream.int(tick, candidates.length, 7717)]!.id]
    }
    case 'oneUnderConstruction': {
      const candidates = context.plants.filter((p) => p.phase === LifecyclePhase.Building)
      if (candidates.length === 0) return []
      return [candidates[stream.int(tick, candidates.length, 4231)]!.id]
    }
  }
}

function toModifier(def: EventDef, effect: EventEffect, scale: number, tick: number, uid: string): Modifier {
  const mod: Modifier = {
    layer: layerForCategory(def.category),
    param: effect.param as Param,
    op: effect.op as Op,
    value: effect.value * scale,
    sourceKind: def.category === 'geopolitical' ? 'geopolitics' : 'event',
    sourceId: `event:${uid}`,
    reasonKey: def.nameKey,
  }
  if (effect.durationHours > 0) mod.expiresTick = tick + effect.durationHours
  return mod
}

// ---------------------------------------------------------------------------
// The director
// ---------------------------------------------------------------------------

export class EventDirector {
  constructor(readonly state: DirectorState = emptyDirectorState()) {}

  /** Reset the annual severity allowance. Called on the year boundary. */
  startYear(): void {
    this.state.severitySpent = 0
  }

  /** The player's response to a pending event. Ignored once it has landed. */
  choose(uid: string, choiceId: string): boolean {
    const pending = this.state.pending.find((p) => p.uid === uid)
    if (!pending) return false
    const def = EVENTS_BY_ID.get(pending.defId)
    if (!def || !def.choices.some((c) => c.id === choiceId)) return false
    pending.choiceId = choiceId
    return true
  }

  /**
   * Advance one tick: land whatever is due, retire whatever has expired, and consider raising
   * something new. Returns the money the player's choices cost this tick, for the ledger.
   */
  step(context: DirectorContext): { spent: number; landed: ActiveEvent[] } {
    const landed = this.land(context)
    this.retire(context)
    this.maybeRaise(context)

    let spent = 0
    for (const event of landed) {
      const def = EVENTS_BY_ID.get(event.defId)
      const choice = def?.choices.find((c) => c.id === event.choiceId)
      if (!choice) continue
      // Insurance turns a capital shock into a premium already paid. That is what insurance is
      // for, and making it work is what stops a bad roll from being simply unaffordable.
      if (choice.requiresInsurance && context.insured) continue
      spent += choice.costEur
    }
    return { spent, landed }
  }

  /** Events whose warning period has run out. */
  private land(context: DirectorContext): ActiveEvent[] {
    const landed: ActiveEvent[] = []
    for (let i = this.state.pending.length - 1; i >= 0; i--) {
      const pending = this.state.pending[i]!
      if (context.tick < pending.landsTick) continue
      this.state.pending.splice(i, 1)

      const def = EVENTS_BY_ID.get(pending.defId)
      if (!def) continue

      // No answer by the deadline is itself an answer, and it is the one that costs nothing
      // and helps least. A player who was not watching is not punished with something worse
      // than the event itself.
      const chosen = this.pickChoice(def, pending.choiceId, context)
      const scale = 1 - chosen.mitigation

      let endsTick = context.tick
      for (const effect of def.effects) {
        if (scale <= 0) continue
        for (const targetId of resolveTargets(effect.target, context, context.stream, context.tick)) {
          const mod = toModifier(def, effect, scale, context.tick, pending.uid)
          context.registry.add(`event:${pending.uid}`, targetId, mod)
          endsTick = Math.max(endsTick, mod.expiresTick ?? Number.MAX_SAFE_INTEGER)
        }
      }
      // A choice can bring its own consequences — running the coal fleet harder to cover a gas
      // cut is a real answer with a real price, not a free escape.
      for (const effect of chosen.effects ?? []) {
        for (const targetId of resolveTargets(effect.target, context, context.stream, context.tick)) {
          const mod = toModifier(def, effect, 1, context.tick, pending.uid)
          context.registry.add(`event:${pending.uid}`, targetId, mod)
          endsTick = Math.max(endsTick, mod.expiresTick ?? Number.MAX_SAFE_INTEGER)
        }
      }

      const active: ActiveEvent = {
        uid: pending.uid,
        defId: def.id,
        landedTick: context.tick,
        endsTick,
        choiceId: chosen.id,
      }

      if (def.outage) {
        const hours = Math.round(def.outage.hours * (1 - chosen.outageMitigation))
        const [plantId] = resolveTargets(def.outage.target, context, context.stream, context.tick)
        if (plantId && hours > 0) {
          const plant = context.plants.find((p) => p.id === plantId)
          if (plant) {
            // A state transition, not an availability of zero: the machine is broken, not
            // derated, and the rest of the simulation should be able to tell the difference.
            plant.online = false
            plant.outputMw = 0
            active.outagePlantId = plantId
            active.outageUntilTick = context.tick + hours
            endsTick = Math.max(endsTick, active.outageUntilTick)
            active.endsTick = endsTick
          }
        }
      }

      // A project held up, by name. Applied to `phaseEndsTick` directly: the schedule of a
      // particular job is the thing being changed, and no parameter can reach it.
      if (def.delay) {
        const months = def.delay.months.value * (1 - chosen.mitigation)
        const [plantId] = resolveTargets(def.delay.target, context, context.stream, context.tick)
        const plant = plantId ? context.plants.find((p) => p.id === plantId) : undefined
        if (plant && months > 0) {
          const ticks = Math.round(months * TICKS_PER_MONTH)
          plant.phaseEndsTick += ticks
          // Commissioning moves with it. It is the date the plant's age is measured from, so a
          // station held up nine months and left commissioning on the old date would arrive late
          // *and* be nine months old on its first day.
          plant.commissionedTick += ticks
          active.delayedPlantId = plantId
          active.delayTicks = ticks
        }
      }

      this.state.active.push(active)
      this.state.log.unshift({ uid: pending.uid, defId: def.id, tick: context.tick, choiceId: chosen.id })
      if (this.state.log.length > LOG_LIMIT) this.state.log.length = LOG_LIMIT
      landed.push(active)
    }
    return landed
  }

  private pickChoice(def: EventDef, chosenId: string | null, context: DirectorContext): EventChoice {
    const fallback = def.choices[0]!
    if (!chosenId) return fallback
    const choice = def.choices.find((c) => c.id === chosenId)
    if (!choice) return fallback
    // A choice the player can no longer afford quietly reverts to doing nothing, rather than
    // pushing them into a bankruptcy they did not agree to.
    if (choice.requiresInsurance && !context.insured) return fallback
    const payable = choice.requiresInsurance && context.insured ? 0 : choice.costEur
    if (payable > context.finances.cash) return fallback
    return choice
  }

  /** Drop finished events and bring repaired units back. */
  private retire(context: DirectorContext): void {
    for (let i = this.state.active.length - 1; i >= 0; i--) {
      const active = this.state.active[i]!
      if (active.outagePlantId && active.outageUntilTick !== undefined && context.tick >= active.outageUntilTick) {
        const plant = context.plants.find((p) => p.id === active.outagePlantId)
        if (plant && plant.phase === LifecyclePhase.Operating) plant.online = true
        delete active.outagePlantId
        delete active.outageUntilTick
      }
      if (context.tick >= active.endsTick) {
        context.registry.clearSource(`event:${active.uid}`)
        this.state.active.splice(i, 1)
      }
    }
  }

  /** Consider raising one new event. At most one per tick, by construction. */
  private maybeRaise(context: DirectorContext): void {
    if (context.tick < GRACE_TICKS) return

    const budget = severityBudget(context.finances)
    const budgetSpent = this.state.severitySpent >= budget
    const inCooldown = context.tick - this.state.lastSevereTick < SEVERE_COOLDOWN_TICKS

    for (let i = 0; i < EVENTS.length; i++) {
      const def = EVENTS[i]!
      if (def.fromYear !== undefined && context.year < def.fromYear) continue

      const severe = def.severity.value >= SEVERE_THRESHOLD
      // A spent budget or an active cooldown suppresses the heavy events only. Small ones keep
      // happening, because a world where nothing goes wrong reads as a world with no weather.
      if (severe && (budgetSpent || inCooldown)) continue

      // Never raise the same event twice while it is still pending or in force.
      if (this.state.pending.some((p) => p.defId === def.id)) continue
      if (this.state.active.some((a) => a.defId === def.id)) continue

      if (!context.stream.chance(context.tick, hourlyRate(def, context), i + 1)) continue

      const uid = `e${this.state.nextUid++}`
      this.state.pending.push({
        uid,
        defId: def.id,
        raisedTick: context.tick,
        landsTick: context.tick + def.forewarningHours.value,
        choiceId: null,
      })
      this.state.severitySpent += def.severity.value
      if (severe) this.state.lastSevereTick = context.tick
      // One at a time. Two disasters raised in the same hour is a coincidence the player has
      // no way to read as anything but the game being unfair.
      return
    }
  }
}
