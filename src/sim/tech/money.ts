/**
 * The economy-wide money constants, carried to the year the game is actually in.
 *
 * These are the prices that never became `Param`s, because nothing external moves them: the
 * value of lost load, the regulatory penalties, the tariff floor, and two numbers that exist
 * only to order the dispatch solver's arcs. They are read straight out of `ECONOMICS`, and until
 * this milestone that was fine because nothing else moved either.
 *
 * It is emphatically not fine now, and the reason is worth stating because it is the sort of
 * thing that produces a subtly broken game rather than an obviously broken one. Once fuel,
 * opex and capital costs are quoted in the game's own year, a value of lost load frozen at its
 * 2022 figure means unserved energy is punitively expensive in 1995 and cheap by 2040 — so the
 * player's incentive to keep the lights on would drift across the scenario for no reason anyone
 * could see. Worse, the solver's ordering constants would eventually be *overtaken* by real
 * generator costs, and a battery would start declining to charge before a city was shed.
 *
 * The whole set therefore moves together, which is the only arrangement under which their
 * relative sizes — and every ordering that depends on those — stay put.
 */

import { ECONOMICS } from '@content/economics'
import { inflationFactor } from './costs'

/** Every economy-wide price, in the money of a given year. */
export interface Prices {
  valueOfLostLoadPerMwh: number
  valueOfLostHeatPerMwh: number
  forgoneChargePricePerMwh: number
  wheelingTieBreakPerMwh: number
  unservedPenaltyPerMwh: number
  unservedHeatPenaltyPerMwh: number
  tariffFloorPerMwh: number
}

/** A figure in the money of `year`, carried from the year its own source quoted it in. */
export function nominal(s: { value: number; sourceYear: number }, year: number): number {
  return s.value * inflationFactor(s.sourceYear, year)
}

/**
 * The prices as of a given year.
 *
 * Cheap enough to call per tick, but called once a tick and cached by the world anyway, because
 * seven exponentiations an hour for thirty simulated years is seven exponentiations too many for
 * something that changes annually.
 */
export function pricesFor(year: number): Prices {
  return {
    valueOfLostLoadPerMwh: nominal(ECONOMICS.valueOfLostLoadPerMwh, year),
    valueOfLostHeatPerMwh: nominal(ECONOMICS.valueOfLostHeatPerMwh, year),
    forgoneChargePricePerMwh: nominal(ECONOMICS.forgoneChargePricePerMwh, year),
    wheelingTieBreakPerMwh: nominal(ECONOMICS.wheelingTieBreakPerMwh, year),
    unservedPenaltyPerMwh: nominal(ECONOMICS.unservedPenaltyPerMwh, year),
    unservedHeatPenaltyPerMwh: nominal(ECONOMICS.unservedHeatPenaltyPerMwh, year),
    tariffFloorPerMwh: nominal(ECONOMICS.tariffFloorPerMwh, year),
  }
}

/**
 * The content's own figures, untouched.
 *
 * The default for callers that have no year — chiefly unit tests of the solver, which care about
 * the ordering these constants impose and not at all about what decade it is.
 */
export const BASE_PRICES: Prices = {
  valueOfLostLoadPerMwh: ECONOMICS.valueOfLostLoadPerMwh.value,
  valueOfLostHeatPerMwh: ECONOMICS.valueOfLostHeatPerMwh.value,
  forgoneChargePricePerMwh: ECONOMICS.forgoneChargePricePerMwh.value,
  wheelingTieBreakPerMwh: ECONOMICS.wheelingTieBreakPerMwh.value,
  unservedPenaltyPerMwh: ECONOMICS.unservedPenaltyPerMwh.value,
  unservedHeatPenaltyPerMwh: ECONOMICS.unservedHeatPenaltyPerMwh.value,
  tariffFloorPerMwh: ECONOMICS.tariffFloorPerMwh.value,
}
