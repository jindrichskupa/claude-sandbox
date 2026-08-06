/**
 * What the regulator lets the utility charge.
 *
 * ## The formula this replaces, and why it could not work
 *
 * The tariff used to reset to `average clearing price × (1 + retail margin)`. That is a *supply*
 * margin — the cost of metering, billing and selling to a household on top of power bought at
 * wholesale — and it is the right formula for a retailer who buys everything it sells. This
 * utility is not a retailer. It owns the stations, and the clearing price it is being paid is the
 * marginal cost of the cheapest plant that had to run: fuel and carbon, and nothing else.
 *
 * So the formula paid short-run marginal cost plus a supply margin, against a business whose
 * costs are mostly fixed and mostly capital. It could not recover a station's fixed operating
 * cost, its interest, or one euro of the capital that built it. Measured over the opening
 * scenario, the consequence was not subtle:
 *
 *   - By 1997 the tariff had fallen from 85 to 32 EUR/MWh, which was exactly its floor — the
 *     reset wanted to go lower still, because cheap lignite was setting the price.
 *   - Fuel alone was 21 EUR/MWh and fixed operating cost 13. The utility lost money on every
 *     megawatt-hour it sold before paying for a single asset.
 *   - Every strategy that spent money therefore died sooner than one that spent none. A player
 *     who did nothing at all survived to 2013; every version that built, overhauled or planned
 *     properly went bankrupt between 1998 and 2010. When inaction dominates, the game is not
 *     hard — it is broken.
 *
 * ## What replaces it: the revenue requirement
 *
 * This is how a vertically integrated regulated utility is actually paid, and it is one idea: the
 * regulator works out what it costs to provide the service for a year, and divides by the energy
 * delivered. The cost has two halves.
 *
 * **What it cost to run.** Fuel, carbon, variable and fixed operating cost, interest, insurance,
 * and what it paid households for the power off their roofs. All taken from the year's own
 * ledger, so a player who runs an expensive fleet is charging their customers for it — visibly.
 *
 * **What it costs to keep standing.** Not the historical price of the assets, which nobody has
 * and which inflation makes meaningless, but what it would cost to build the same system today,
 * recovered over its design life, plus a return on the average value of it. That is the *modern
 * equivalent asset* basis real regulators use for exactly this reason. It also means a fleet the
 * player has let wear out costs the same to fund as a new one, which is correct: depreciation is
 * a claim on the future, not a reward for neglect.
 *
 * ## What is deliberately excluded
 *
 * The exclusions are where the difficulty lives, and each is a real regulatory principle.
 *
 * **Penalties for energy not delivered.** A regulator does not let a utility bill its customers
 * for failing to supply them. This is what keeps reliability a genuine constraint: the shortfall
 * cost stays with the player, permanently.
 *
 * **Tax, windfall levies and the cost of responding to events.** Taxes are levied on what is
 * left; a windfall levy exists precisely to *not* be passed through; and how the player answers
 * an event is a decision, not a cost of service.
 *
 * **This year's costs, this year.** The tariff is set from the year that just closed and moves
 * only part of the way, exactly as before. A regulator reviews, it does not track. So a cost that
 * jumps — a carbon price tripling overnight, a fuel crisis — is absorbed by the utility first and
 * recovered afterwards, which is both what happens and where the pressure comes from.
 */

import { LINE_TYPES, type VoltageLevel } from '@content/lineTypes'
import { HEAT_PIPE_TYPES, type PipeSize } from '@content/heatPipeTypes'
import { PLANT_TYPES } from '@content/plantTypes'
import { sourced, type Sourced } from '@content/schema'
import { LifecyclePhase, type PlantAsset } from '../assets/types'
import type { GridEdge } from '../grid/network'
import type { PeriodLedger } from './economy'

export const REGULATION = {
  /**
   * Return the regulator allows on the capital employed, per year, in real terms.
   *
   * A regulated network business is a low-risk one and is paid accordingly: the allowed weighted
   * cost of capital in European electricity determinations has sat in this region for two
   * decades. It is not a profit target the player can beat by being clever — it is the price of
   * having the capital tied up at all.
   */
  allowedReturnOnCapital: sourced(0.06, 'fraction', 'eu-energy-policy', 2022, 'Allowed real WACC in European network determinations'),
  /**
   * The share of replacement cost treated as capital currently employed.
   *
   * A fleet renewed steadily sits at about half its replacement cost once depreciation is taken
   * off — the standard steady-state approximation, and far more honest here than pretending to
   * track the book value of assets the scenario inherited without a purchase price.
   */
  averageNetBookShare: sourced(0.5, 'fraction', 'engineering-standard', 2023, 'Mid-life net book value of a fleet in steady state'),
  /**
   * How far the tariff moves towards the calculated requirement each year.
   *
   * A regulator reviews rather than tracks. Below one, and a step change in costs is absorbed by
   * the utility before it is recovered — which is the whole of the pressure in this model.
   */
  reviewSpeed: sourced(0.6, 'fraction', 'game-design', 2024, 'A price control is reopened, not recalculated hourly'),
} as const satisfies Record<string, Sourced<number>>

/** What it would cost, at today's prices, to build the system the utility currently owns. */
export interface RateBase {
  /** Replacement cost of everything owned, EUR. */
  replacementCost: number
  /** Straight-line recovery of that cost over the assets' design lives, EUR per year. */
  depreciationPerYear: number
}

/**
 * Value the fleet and the network at what it would cost to build them now.
 *
 * Plant under construction is excluded: it is not yet serving anybody, and a regulator does not
 * put work in progress into the rate base until it does. That matters for the game as well as for
 * the accounting — it means a player cannot raise the tariff by starting projects.
 */
export function rateBase(
  plants: PlantAsset[],
  edges: GridEdge[],
  capexPerKw: (plant: PlantAsset) => number,
): RateBase {
  let replacementCost = 0
  let depreciationPerYear = 0

  for (const plant of plants) {
    if (plant.phase !== LifecyclePhase.Operating && plant.phase !== LifecyclePhase.Mothballed) continue
    const type = PLANT_TYPES[plant.typeId]
    const cost = capexPerKw(plant) * 1000 * type.capacityMw.value
    replacementCost += cost
    depreciationPerYear += cost / Math.max(5, plant.designLifeYears)
  }

  for (const edge of edges) {
    let cost = 0
    let life = 50
    if (edge.commodity === 'heat' && edge.dn !== undefined) {
      const pipe = HEAT_PIPE_TYPES[edge.dn as PipeSize]
      cost = pipe.capexPerKm.value * edge.lengthKm * Math.max(1, edge.circuits)
      life = pipe.designLifeYears.value
    } else if (edge.kv !== 0) {
      const line = LINE_TYPES[edge.kv as VoltageLevel]
      cost = line.capexPerKm.value * edge.lengthKm * Math.max(1, edge.circuits)
      life = line.designLifeYears.value
    }
    replacementCost += cost
    depreciationPerYear += cost / Math.max(5, life)
  }

  return { replacementCost, depreciationPerYear }
}

/**
 * The costs a regulator lets the utility recover, out of a year's ledger.
 *
 * Everything here was spent providing the service. What is left out — the penalty for energy not
 * delivered, tax, the windfall levy, and what the player chose to spend answering events — is
 * left out on purpose; see the note at the top of this file.
 */
export function recoverableCosts(ledger: PeriodLedger): number {
  return (
    ledger.fuelCost +
    ledger.carbonCost +
    ledger.varOpex +
    ledger.fixedOpex +
    ledger.interest +
    ledger.insurancePremium +
    ledger.rooftopPurchases +
    ledger.decommissioningCost -
    ledger.recyclingIncome
  )
}

/**
 * What the tariff would have to be, per MWh, to fund the year that just closed.
 *
 * Heat revenue is netted off rather than given a requirement of its own. The heat business is
 * billed separately and far more cheaply, and its costs are already inside the figures above —
 * so without this the electricity customer would be charged for the boilers twice.
 */
export function revenueRequirementPerMwh(input: {
  ledger: PeriodLedger
  rateBase: RateBase
  energySoldMwh: number
}): number {
  if (input.energySoldMwh <= 0) return 0
  const capital =
    input.rateBase.depreciationPerYear +
    input.rateBase.replacementCost *
      REGULATION.averageNetBookShare.value *
      REGULATION.allowedReturnOnCapital.value
  const operating = recoverableCosts(input.ledger) - input.ledger.heatRevenue
  return Math.max(0, operating + capital) / input.energySoldMwh
}

/**
 * Move the tariff towards what the service costs, part of the way.
 *
 * The floor still applies, and still means what it always did: a regulated tariff is sticky
 * downwards, so a mild year does not wipe out the ability to recover a hard one.
 */
export function reviewTariff(current: number, requirement: number, floor: number): number {
  return Math.max(floor, current + (requirement - current) * REGULATION.reviewSpeed.value)
}
