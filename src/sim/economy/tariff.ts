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
 * recovered over its design life, plus a return on what is left of it. That is the *modern
 * equivalent asset* basis real regulators use for exactly this reason.
 *
 * ## The correction, and the twenty-seven billion euros that found it
 *
 * "What is left of it" used to be a constant: half the replacement cost of everything owned,
 * regardless of age, on the steady-state argument that a fleet renewed evenly sits at about half
 * its replacement value. The argument is fine and the approximation was not, because none of these
 * scenarios is a fleet renewed evenly — they are brownfield starts whose whole subject is a fleet
 * that was built at once and comes due at once.
 *
 * What it did, measured on Czechia 2015: the utility opens with €950m of cash against €2.6bn of
 * debt and reaches €30.8bn of cash against none by 2037, and all five archetypes end debt-free
 * with between ten and thirty billion. Profit was depreciation plus the allowed return,
 * guaranteed, every year — and both halves were being paid on machines that were fully written
 * off. A lignite unit from 1961 was earning a return on half of what a new one would cost, and
 * collecting a fresh depreciation allowance on it, sixty years after it was paid for.
 *
 * Now both are measured per asset from how much of its life is left. A written-off station earns
 * nothing and depreciates nothing; a new one earns on all of it; an overhauled one goes back onto
 * the books, because an overhaul is genuinely new capital. The effect on the game is the point: a
 * player who lets the fleet age is no longer funded as though they had replaced it.
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
import { lifeFraction } from '../assets/aging'
import { TICKS_PER_YEAR } from '../core/time'
import { nodeInService, type GridEdge, type GridNode } from '../grid/network'
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
  /**
   * The part of that which has not yet been depreciated away, EUR.
   *
   * This is the number the allowed return is paid on, and it is measured asset by asset from how
   * much of each one's life is left. A fleet the player has run into the ground is worth little;
   * one they have just rebuilt is worth nearly all of it. See the note at the top of this file for
   * what it replaced and why.
   */
  capitalEmployed: number
  /** Straight-line recovery of that cost over the assets' design lives, EUR per year. */
  depreciationPerYear: number
}

/**
 * Value the fleet and the network at what it would cost to build them now, and work out how much
 * of that value is left.
 *
 * Plant under construction is excluded: it is not yet serving anybody, and a regulator does not
 * put work in progress into the rate base until it does. That matters for the game as well as for
 * the accounting — it means a player cannot raise the tariff by starting projects.
 *
 * **Every asset is depreciated by its own age**, and that is the whole of the difference from what
 * this used to do. Replacement cost is still the valuation basis, because the scenarios inherit
 * assets with no purchase price and pretending otherwise would be worse; what has changed is that
 * the undepreciated share is measured per machine instead of assumed to be half the fleet. An
 * asset past its life contributes nothing to the capital employed and generates no further
 * depreciation allowance, because there is nothing left of it to recover.
 *
 * A refurbishment shows up here on its own, with no special case: it extends the design life, so
 * the same age is a smaller fraction of it, so the machine goes back into the rate base. Which is
 * correct — an overhaul is new capital, and it is the one thing that puts a written-off station
 * back on the books.
 */
export function rateBase(
  plants: PlantAsset[],
  edges: GridEdge[],
  capexPerKw: (plant: PlantAsset) => number,
  nodes: GridNode[] = [],
  tick = 0,
): RateBase {
  let replacementCost = 0
  let capitalEmployed = 0
  let depreciationPerYear = 0

  /** Book one asset in: what it would cost new, how long it lasts, how much of that it has used. */
  const book = (cost: number, life: number, used: number): void => {
    const years = Math.max(5, life)
    const remaining = Math.max(0, Math.min(1, 1 - used))
    replacementCost += cost
    capitalEmployed += cost * remaining
    // No allowance on an asset already recovered. Straight-line means the recovery stops when the
    // book value reaches zero, and paying it for ever was how a fully written-off lignite fleet
    // went on earning its owner a return every year for a quarter of a century.
    if (remaining > 0) depreciationPerYear += cost / years
  }

  for (const plant of plants) {
    if (plant.phase !== LifecyclePhase.Operating && plant.phase !== LifecyclePhase.Mothballed) continue
    const type = PLANT_TYPES[plant.typeId]
    // `lifeFraction` and not raw age: it is the same measure the ageing, the failure odds and the
    // retirement decision all use, so a machine cannot be worn out for one of them and new for
    // another. It also carries the refurbishment extension and, for a battery, cycling.
    book(capexPerKw(plant) * 1000 * type.capacityMw.value, plant.designLifeYears, lifeFraction(plant, tick))
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
    book(cost, life, (tick - edge.builtTick) / TICKS_PER_YEAR / Math.max(5, life))
  }

  // The switching stations, on the same basis as everything else. Left out until they became
  // assets in their own right, which was defensible while a station was a free dot on the map and
  // is not now: a compound the player pays for and then maintains for forty years is exactly the
  // kind of capital a regulated business is entitled to recover. A station still being dug is out,
  // like a plant under construction and for the same reason.
  for (const node of nodes) {
    if (node.kind !== 'substation' || !node.kvLevels?.length) continue
    if (!nodeInService(node, tick)) continue
    for (const kv of node.kvLevels) {
      const line = LINE_TYPES[kv]
      const life = line.designLifeYears.value
      // A station the scenario handed over has no in-service date, so it is treated as new. That is
      // the generous reading and it is deliberate: the alternative is guessing an age the content
      // never stated, and the compounds are a small part of the base beside the fleet.
      book(line.substationCapex.value, life, (tick - (node.inServiceTick ?? 0)) / TICKS_PER_YEAR / Math.max(5, life))
    }
  }

  return { replacementCost, capitalEmployed, depreciationPerYear }
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
    input.rateBase.capitalEmployed * REGULATION.allowedReturnOnCapital.value
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
