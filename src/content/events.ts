/**
 * Unforeseen events: failures, disasters, price shocks, politics.
 *
 * The design constraint here is stricter than "make it data-driven". An event may issue only
 * two kinds of consequence — a **time-limited modifier** through the parameter pipeline, or a
 * **declared state transition** such as taking a unit out of service. It may not contain code.
 * That is what keeps the event table authorable, testable, and — importantly — explainable:
 * every effect an event has shows up in the inspector's modifier chain with the event named as
 * its source, so a player who wonders why their gas station suddenly costs a fortune to run can
 * find out in two clicks rather than concluding the game is cheating.
 *
 * ## Why randomness is bearable here
 *
 * A tycoon game that hits the player with unavoidable disasters is not tense, it is annoying.
 * Five mechanisms make the difference, and all five are needed:
 *
 * 1. **Forewarning.** Political and market events arrive with a visible run-up — a consultation,
 *    a supply warning, a drifting index. Only technical and natural events strike without
 *    notice, and those are exactly the ones insurance exists for.
 * 2. **A severity director.** There is an annual budget of total severity, scaled to what the
 *    player can actually absorb. When it is spent, heavy events are deferred rather than piled
 *    on. This is the difference between a hard year and a player closing the tab.
 * 3. **Nothing unavoidable.** Every severe event offers at least one painful but *available*
 *    response. `tests/events.test.ts` checks this over the whole table rather than trusting it.
 * 4. **A grace period and a cooldown.** No events in the first year of a scenario, and no second
 *    heavy blow immediately after the first.
 * 5. **Real counterplay.** Deferred maintenance raises failure rates; insurance turns a capital
 *    shock into an operating cost. Both are the player's choice, which means a bad year is
 *    usually traceable to a decision rather than to a die roll.
 *
 * The severity numbers below are game design, not measurements, and say so. The *rates* lean on
 * published failure and outage statistics where those exist.
 */

import { Layer, Op, Param } from '../sim/params/types'
import { sourced, type Sourced } from './schema'

export type EventCategory = 'technical' | 'natural' | 'economic' | 'geopolitical' | 'political' | 'social'

/**
 * Conditions that make an event more likely.
 *
 * A closed set, evaluated by the simulation, so that content stays data. Adding a condition is
 * a deliberate act with one place to implement it, rather than a predicate smuggled into the
 * event table.
 */
export type RiskCondition =
  | 'storm'
  | 'drought'
  | 'heatwave'
  | 'freeze'
  | 'agedFleet'
  | 'poorCondition'
  | 'deferredMaintenance'
  | 'gasDependent'
  | 'coalDependent'
  | 'lowPublicOpinion'
  | 'heavilyIndebted'
  | 'recentBlackout'

export interface RiskFactor {
  condition: RiskCondition
  multiplier: Sourced<number>
}

/** Which assets an effect lands on. Resolved by the director, never by content. */
export type EffectTarget =
  | { kind: 'world' }
  | { kind: 'allCities' }
  | { kind: 'allLines' }
  /** Every plant burning a given fuel. */
  | { kind: 'byFuel'; fuel: string }
  /** Every plant of a category. */
  | { kind: 'byCategory'; category: string }
  /** One plant, chosen by the director from those that match. */
  | { kind: 'onePlant'; category?: string; fuel?: string }

export interface EventEffect {
  target: EffectTarget
  param: Param
  op: Op
  value: number
  /** How long it lasts. Zero means for the rest of the scenario. */
  durationHours: number
}

/**
 * A forced outage the event causes. Kept separate from the modifiers because "this unit is
 * broken" is a state, not a derating — the same distinction `LifecyclePhase` draws.
 */
export interface EventOutage {
  target: EffectTarget
  hours: number
}

export interface EventChoice {
  id: string
  labelKey: string
  /** Money spent immediately. Zero for accepting the consequences. */
  costEur: number
  /** Fraction of the event's effects this removes, 0..1. */
  mitigation: number
  /** Fraction of the outage duration this removes. */
  outageMitigation: number
  /** Only offered if the utility carries insurance; the insurer pays `costEur` instead. */
  requiresInsurance?: boolean
  /** Extra consequences the choice brings with it. A real trade, not a free out. */
  effects?: EventEffect[]
}

export interface EventDef {
  id: string
  nameKey: string
  descriptionKey: string
  category: EventCategory
  /**
   * How heavy this event is, 1–10. Spends the director's annual budget and decides whether it
   * counts as severe for the cooldown. A design number, not a measurement.
   */
  severity: Sourced<number>
  /** Expected occurrences per year under baseline conditions. */
  baseRatePerYear: Sourced<number>
  /** Hours between the warning appearing and the effects landing. */
  forewarningHours: Sourced<number>
  /** Earliest year this event can occur at all. */
  fromYear?: number
  riskFactors: RiskFactor[]
  effects: EventEffect[]
  outage?: EventOutage
  /** Always at least two, and at least one of them affordable. */
  choices: EventChoice[]
}

const G = 2024

/** Accepting what happened. Always available, always free, never good. */
function acceptChoice(labelKey = 'event.choice.accept'): EventChoice {
  return { id: 'accept', labelKey, costEur: 0, mitigation: 0, outageMitigation: 0 }
}

export const EVENTS: EventDef[] = [
  // --- Technical --------------------------------------------------------
  {
    id: 'turbine_failure',
    nameKey: 'event.turbineFailure.name',
    descriptionKey: 'event.turbineFailure.description',
    category: 'technical',
    severity: sourced(4, 'count', 'game-design', G),
    baseRatePerYear: sourced(0.35, 'count', 'entsoe-factsheet', 2022, 'Major unplanned outages per fleet-year'),
    forewarningHours: sourced(0, 'hours', 'game-design', G, 'Machinery does not send a consultation letter'),
    riskFactors: [
      { condition: 'agedFleet', multiplier: sourced(2.5, 'fraction', 'engineering-standard', 2023, 'Bathtub curve: failures rise steeply past design life') },
      { condition: 'poorCondition', multiplier: sourced(2.0, 'fraction', 'engineering-standard', 2023) },
      { condition: 'deferredMaintenance', multiplier: sourced(2.2, 'fraction', 'engineering-standard', 2023, 'The single strongest thing the player controls') },
    ],
    effects: [],
    outage: { target: { kind: 'onePlant' }, hours: 24 * 21 },
    choices: [
      acceptChoice('event.choice.waitForParts'),
      {
        id: 'expedite',
        labelKey: 'event.choice.expediteRepair',
        costEur: 18_000_000,
        mitigation: 0,
        outageMitigation: 0.6,
        requiresInsurance: false,
      },
      {
        id: 'claim',
        labelKey: 'event.choice.claimOnInsurance',
        costEur: 0,
        mitigation: 0,
        outageMitigation: 0.6,
        requiresInsurance: true,
      },
    ],
  },

  {
    id: 'line_fault',
    nameKey: 'event.lineFault.name',
    descriptionKey: 'event.lineFault.description',
    category: 'technical',
    severity: sourced(2, 'count', 'game-design', G),
    baseRatePerYear: sourced(1.2, 'count', 'entsoe-factsheet', 2022),
    forewarningHours: sourced(0, 'hours', 'game-design', G),
    riskFactors: [
      { condition: 'storm', multiplier: sourced(20, 'fraction', 'entsoe-factsheet', 2022, 'Storms dominate transmission fault statistics') },
      { condition: 'freeze', multiplier: sourced(6, 'fraction', 'entsoe-factsheet', 2022, 'Ice loading and galloping conductors') },
    ],
    effects: [
      {
        target: { kind: 'allLines' },
        param: Param.LineCapacityMw,
        op: Op.AddFrac,
        value: -0.25,
        durationHours: 36,
      },
    ],
    choices: [
      acceptChoice(),
      {
        id: 'crews',
        labelKey: 'event.choice.callOutCrews',
        costEur: 2_500_000,
        mitigation: 0.75,
        outageMitigation: 0,
      },
    ],
  },

  // --- Natural ----------------------------------------------------------
  {
    id: 'drought',
    nameKey: 'event.drought.name',
    descriptionKey: 'event.drought.description',
    category: 'natural',
    severity: sourced(5, 'count', 'game-design', G),
    baseRatePerYear: sourced(0.2, 'count', 'iea-weo', 2023, 'Multi-week low-flow episodes'),
    forewarningHours: sourced(24 * 10, 'hours', 'game-design', G, 'River levels fall visibly before they bite'),
    riskFactors: [
      { condition: 'drought', multiplier: sourced(5, 'fraction', 'iea-weo', 2023) },
      { condition: 'heatwave', multiplier: sourced(3, 'fraction', 'iea-weo', 2023) },
    ],
    effects: [
      // One cause, two separate operational problems: no water to turn the turbines, and no
      // water to cool the thermal fleet. This coincidence is why droughts are so awkward.
      {
        target: { kind: 'byCategory', category: 'hydro' },
        param: Param.Availability,
        op: Op.AddFrac,
        value: -0.45,
        durationHours: 24 * 45,
      },
      {
        target: { kind: 'byCategory', category: 'thermal' },
        param: Param.Availability,
        op: Op.AddFrac,
        value: -0.18,
        durationHours: 24 * 45,
      },
    ],
    choices: [
      acceptChoice(),
      {
        id: 'abstraction',
        labelKey: 'event.choice.buyAbstractionRights',
        costEur: 9_000_000,
        mitigation: 0.5,
        outageMitigation: 0,
        effects: [
          // Taking water from a river in a drought is noticed, and not forgiven quickly.
          {
            target: { kind: 'world' },
            param: Param.TariffPerMwh,
            op: Op.AddFrac,
            value: -0.04,
            durationHours: 24 * 180,
          },
        ],
      },
    ],
  },

  {
    id: 'severe_storm',
    nameKey: 'event.severeStorm.name',
    descriptionKey: 'event.severeStorm.description',
    category: 'natural',
    severity: sourced(6, 'count', 'game-design', G),
    baseRatePerYear: sourced(0.15, 'count', 'entsoe-factsheet', 2022),
    forewarningHours: sourced(24, 'hours', 'game-design', G, 'A day of warning, as the forecasters give'),
    riskFactors: [{ condition: 'storm', multiplier: sourced(15, 'fraction', 'entsoe-factsheet', 2022) }],
    effects: [
      {
        target: { kind: 'allLines' },
        param: Param.LineCapacityMw,
        op: Op.AddFrac,
        value: -0.4,
        durationHours: 24 * 4,
      },
    ],
    outage: { target: { kind: 'onePlant', category: 'wind' }, hours: 24 * 5 },
    choices: [
      acceptChoice(),
      {
        id: 'preposition',
        labelKey: 'event.choice.prepositionCrews',
        costEur: 5_000_000,
        mitigation: 0.6,
        outageMitigation: 0.5,
      },
    ],
  },

  {
    id: 'deep_freeze',
    nameKey: 'event.deepFreeze.name',
    descriptionKey: 'event.deepFreeze.description',
    category: 'natural',
    severity: sourced(6, 'count', 'game-design', G),
    baseRatePerYear: sourced(0.18, 'count', 'entsoe-factsheet', 2022),
    forewarningHours: sourced(48, 'hours', 'game-design', G),
    riskFactors: [{ condition: 'freeze', multiplier: sourced(8, 'fraction', 'entsoe-factsheet', 2022) }],
    effects: [
      {
        target: { kind: 'allCities' },
        param: Param.DemandMw,
        op: Op.AddFrac,
        value: 0.12,
        durationHours: 24 * 6,
      },
      // The heat network is where a freeze really hurts, and it is the one load that cannot
      // be shed.
      {
        target: { kind: 'allCities' },
        param: Param.HeatDemandMw,
        op: Op.AddFrac,
        value: 0.2,
        durationHours: 24 * 6,
      },
    ],
    choices: [
      acceptChoice(),
      {
        id: 'fillStores',
        labelKey: 'event.choice.fillFuelAndHeatStores',
        costEur: 7_000_000,
        mitigation: 0.55,
        outageMitigation: 0,
      },
    ],
  },

  // --- Economic ---------------------------------------------------------
  {
    id: 'fuel_price_spike',
    nameKey: 'event.fuelPriceSpike.name',
    descriptionKey: 'event.fuelPriceSpike.description',
    category: 'economic',
    severity: sourced(5, 'count', 'game-design', G),
    baseRatePerYear: sourced(0.25, 'count', 'iea-weo', 2023, 'Gas has done this repeatedly'),
    forewarningHours: sourced(24 * 14, 'hours', 'game-design', G, 'Forward curves move before spot does'),
    riskFactors: [
      { condition: 'gasDependent', multiplier: sourced(2.5, 'fraction', 'iea-weo', 2023) },
    ],
    effects: [
      {
        target: { kind: 'byFuel', fuel: 'gas' },
        param: Param.FuelPricePerMwhThermal,
        op: Op.AddFrac,
        value: 1.4,
        durationHours: 24 * 120,
      },
    ],
    choices: [
      acceptChoice('event.choice.buyAtSpot'),
      {
        id: 'hedge',
        labelKey: 'event.choice.hedgeForward',
        costEur: 25_000_000,
        mitigation: 0.7,
        outageMitigation: 0,
      },
    ],
  },

  {
    id: 'interest_shock',
    nameKey: 'event.interestShock.name',
    descriptionKey: 'event.interestShock.description',
    category: 'economic',
    severity: sourced(4, 'count', 'game-design', G),
    baseRatePerYear: sourced(0.2, 'count', 'iea-weo', 2023),
    forewarningHours: sourced(24 * 21, 'hours', 'game-design', G),
    riskFactors: [
      { condition: 'heavilyIndebted', multiplier: sourced(1.8, 'fraction', 'game-design', G, 'Not more likely, but far more painful; the director weights it') },
    ],
    effects: [
      {
        target: { kind: 'world' },
        param: Param.CapexPerKw,
        op: Op.AddFrac,
        value: 0.15,
        durationHours: 24 * 365,
      },
    ],
    choices: [
      acceptChoice(),
      {
        id: 'refinance',
        labelKey: 'event.choice.refinance',
        costEur: 12_000_000,
        mitigation: 0.6,
        outageMitigation: 0,
      },
    ],
  },

  // --- Geopolitical -----------------------------------------------------
  {
    id: 'gas_supply_interruption',
    nameKey: 'event.gasSupplyInterruption.name',
    descriptionKey: 'event.gasSupplyInterruption.description',
    category: 'geopolitical',
    severity: sourced(7, 'count', 'game-design', G),
    baseRatePerYear: sourced(0.08, 'count', 'iea-weo', 2023),
    forewarningHours: sourced(24 * 7, 'hours', 'game-design', G, 'Supply warnings precede the cut'),
    riskFactors: [{ condition: 'gasDependent', multiplier: sourced(3, 'fraction', 'iea-weo', 2023) }],
    effects: [
      {
        target: { kind: 'byFuel', fuel: 'gas' },
        param: Param.Availability,
        op: Op.AddFrac,
        value: -0.55,
        durationHours: 24 * 60,
      },
      {
        target: { kind: 'byFuel', fuel: 'gas' },
        param: Param.FuelPricePerMwhThermal,
        op: Op.AddFrac,
        value: 1.8,
        durationHours: 24 * 90,
      },
    ],
    choices: [
      acceptChoice(),
      {
        id: 'alternativeSupply',
        labelKey: 'event.choice.buyAlternativeSupply',
        costEur: 30_000_000,
        mitigation: 0.65,
        outageMitigation: 0,
      },
      {
        id: 'runCoalHarder',
        labelKey: 'event.choice.runCoalHarder',
        costEur: 0,
        mitigation: 0.35,
        outageMitigation: 0,
        effects: [
          // Burning more coal to cover a gas cut is a real answer with a real price attached.
          {
            target: { kind: 'byFuel', fuel: 'coal' },
            param: Param.VarOpexPerMwh,
            op: Op.AddFrac,
            value: 0.25,
            durationHours: 24 * 60,
          },
        ],
      },
    ],
  },

  {
    id: 'coal_supply_disruption',
    nameKey: 'event.coalSupplyDisruption.name',
    descriptionKey: 'event.coalSupplyDisruption.description',
    category: 'geopolitical',
    severity: sourced(5, 'count', 'game-design', G),
    baseRatePerYear: sourced(0.12, 'count', 'iea-weo', 2023),
    forewarningHours: sourced(24 * 5, 'hours', 'game-design', G),
    riskFactors: [{ condition: 'coalDependent', multiplier: sourced(2.5, 'fraction', 'iea-weo', 2023) }],
    effects: [
      {
        target: { kind: 'byFuel', fuel: 'coal' },
        param: Param.FuelPricePerMwhThermal,
        op: Op.AddFrac,
        value: 0.9,
        durationHours: 24 * 70,
      },
    ],
    choices: [
      acceptChoice(),
      {
        id: 'drawStockpile',
        labelKey: 'event.choice.drawOnStockpile',
        costEur: 6_000_000,
        mitigation: 0.6,
        outageMitigation: 0,
      },
    ],
  },

  // --- Social -----------------------------------------------------------
  {
    id: 'construction_blockade',
    nameKey: 'event.constructionBlockade.name',
    descriptionKey: 'event.constructionBlockade.description',
    category: 'social',
    severity: sourced(3, 'count', 'game-design', G),
    baseRatePerYear: sourced(0.25, 'count', 'game-design', G),
    forewarningHours: sourced(24 * 20, 'hours', 'game-design', G, 'Objections are filed long before anyone sits down in front of a lorry'),
    riskFactors: [
      { condition: 'lowPublicOpinion', multiplier: sourced(3, 'fraction', 'game-design', G) },
      { condition: 'recentBlackout', multiplier: sourced(1.8, 'fraction', 'game-design', G) },
    ],
    effects: [
      {
        target: { kind: 'world' },
        param: Param.BuildTimeMonths,
        op: Op.AddFrac,
        value: 0.3,
        durationHours: 24 * 200,
      },
    ],
    choices: [
      acceptChoice('event.choice.waitItOut'),
      {
        id: 'communityFund',
        labelKey: 'event.choice.communityFund',
        costEur: 8_000_000,
        mitigation: 0.8,
        outageMitigation: 0,
      },
    ],
  },
]

export const EVENTS_BY_ID = new Map(EVENTS.map((e) => [e.id, e]))

/** An event heavy enough to trigger the director's cooldown. */
export const SEVERE_THRESHOLD = 5

/**
 * Which modifier layer an event's effects belong in.
 *
 * Not decoration: the layer decides where in the chain the effect multiplies, and the global
 * order in `LAYER_ORDER` says geopolitics acts on the result of everything else. A gas cut is a
 * different kind of fact from a broken turbine, and putting them in the same layer would let
 * them add together as though they were the same kind of derating.
 */
export function layerForCategory(category: EventCategory): Layer {
  if (category === 'geopolitical') return Layer.Geopolitics
  if (category === 'political') return Layer.Policy
  return Layer.Event
}
