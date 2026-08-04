/**
 * The government of the day, expressed as modifiers.
 *
 * Everything a regime does reaches the simulation through the same parameter pipeline that
 * weather, ageing and events use, tagged with the regime as its source. That is not tidiness for
 * its own sake: it means a player who wonders why their gas station suddenly costs 40% more to
 * run can open the inspector and read `Policy: Renewables push · carbon price €85/t` in the
 * chain, rather than discovering that the game has a hidden opinion.
 *
 * The one thing that does *not* come through here is a support contract, because a contract is
 * not a property of the government — it is a promise made to one machine, which outlives the
 * government that made it. See `contracts.ts`.
 */

import { FUELS, type FuelId } from '@content/fuels'
import { fuelVolatility, REGIMES_BY_ID, type PolicyRegimeDef } from '@content/policies'
import { ALL_TARGETS } from '../params/ModifierRegistry'
import { Layer, Op, Param, type Modifier } from '../params/types'
import type { RandomStream } from '../core/rng'

export const POLICY_SOURCE = 'policy'

export interface PolicyEntry {
  targetId: string
  mod: Modifier
}

function policyMod(
  regime: PolicyRegimeDef,
  param: Param,
  op: Op,
  value: number,
  reasonKey: string,
  reasonParams?: Record<string, string | number>,
): Modifier {
  const mod: Modifier = {
    layer: Layer.Policy,
    param,
    op,
    value,
    sourceKind: 'policy',
    sourceId: `policy:${regime.id}`,
    reasonKey,
  }
  if (reasonParams) mod.reasonParams = reasonParams
  return mod
}

/**
 * Everything the current government changes, as one batch.
 *
 * Recomputed monthly rather than hourly, which is what `Tier.Monthly` on `Layer.Policy` already
 * assumes: governments do not change their minds between two o'clock and three.
 */
export function policyModifiers(regimeId: string, scenarioCarbonPrice: number): PolicyEntry[] {
  const regime = REGIMES_BY_ID.get(regimeId)
  if (!regime) return []
  const levers = regime.levers
  const out: PolicyEntry[] = []

  // Carbon price is an absolute offset from whatever the scenario started with, so the chain
  // reads as "base 0, policy +85" rather than as a number that appeared from nowhere.
  const carbonDelta = levers.carbonPricePerTonne.value - scenarioCarbonPrice
  if (Math.abs(carbonDelta) > 1e-9) {
    out.push({
      targetId: 'world',
      mod: policyMod(regime, Param.CarbonPricePerTonne, Op.AddAbs, carbonDelta, 'reason.carbonPrice', {
        price: Math.round(levers.carbonPricePerTonne.value),
      }),
    })
  }

  if (Math.abs(levers.tariffFactor.value - 1) > 1e-9) {
    out.push({
      targetId: 'world',
      mod: policyMod(regime, Param.TariffPerMwh, Op.MulFactor, levers.tariffFactor.value, 'reason.priceCap'),
    })
  }

  // Permitting reaches every project, including ones the player has not conceived of yet, which
  // is exactly what the global target exists for.
  if (Math.abs(levers.permittingSpeed.value - 1) > 1e-9) {
    out.push({
      targetId: ALL_TARGETS,
      mod: policyMod(regime, Param.BuildTimeMonths, Op.MulFactor, levers.permittingSpeed.value, 'reason.permitting'),
    })
  }

  out.push({
    targetId: 'world',
    mod: policyMod(regime, Param.CorporateTaxRate, Op.AddAbs, levers.corporateTaxRate.value, 'reason.corporateTax', {
      rate: Math.round(levers.corporateTaxRate.value * 100),
    }),
  })

  if (levers.capacityPaymentPerKwYear.value > 0) {
    out.push({
      targetId: 'world',
      mod: policyMod(
        regime,
        Param.CapacityPaymentPerKwYear,
        Op.AddAbs,
        levers.capacityPaymentPerKwYear.value,
        'reason.capacityMarket',
      ),
    })
  }

  return out
}

/**
 * Move each fuel's price index one month.
 *
 * A single global fuel index — which is what this game had until now — says that a political
 * shock moves lignite and imported gas by the same amount. That is not a simplification, it is
 * the opposite of the truth, and it removes the main reason to care what you burn. Each fuel
 * therefore has its own index, mean-reverting toward 1 with a volatility taken from its
 * `supplyRisk` and damped by whatever the government has done to diversify supply.
 *
 * Mean reversion rather than a random walk, because fuel prices do come back: a walk would drift
 * to absurdity over a forty-year game and make every long-run decision meaningless.
 */
export function stepFuelPrices(
  indices: Record<string, number>,
  regimeId: string,
  stream: RandomStream,
  tick: number,
): void {
  const regime = REGIMES_BY_ID.get(regimeId)
  const diversification = regime?.levers.fuelDiversification.value ?? 0

  let key = 0
  for (const fuelId of Object.keys(FUELS) as FuelId[]) {
    const fuel = FUELS[fuelId]
    key++
    if (fuel.pricePerMwhThermal.value <= 0) continue

    const volatility = fuelVolatility(fuel.supplyRisk.value, diversification)
    const current = indices[fuelId] ?? 1
    // Pull a third of the way back to normal each month, then shock it.
    const reverted = current + (1 - current) * 0.08
    const shock = stream.normal(tick, key) * volatility * 0.09
    indices[fuelId] = Math.max(0.35, Math.min(4, reverted + shock))
  }
}

/** A fresh set of indices, all at their reference price. */
export function initialFuelIndices(): Record<string, number> {
  const out: Record<string, number> = {}
  for (const fuelId of Object.keys(FUELS)) out[fuelId] = 1
  return out
}

/**
 * How exposed this hour's generation is to fuel the country has to import.
 *
 * Feeds the security axis at elections, and it is measured from what actually ran rather than
 * from what is installed — a mothballed gas fleet is not an import dependency.
 */
export function importExposure(generationByFuel: Map<FuelId, number>): number {
  let total = 0
  let exposed = 0
  for (const [fuelId, mwh] of generationByFuel) {
    if (mwh <= 0) continue
    total += mwh
    exposed += mwh * FUELS[fuelId].supplyRisk.value
  }
  return total > 0 ? exposed / total : 0
}
