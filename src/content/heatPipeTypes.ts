/**
 * District heating pipes.
 *
 * The loss model is deliberately a different shape from the electrical one, because the
 * physics is different and the difference is the whole reason heat behaves as a separate
 * commodity in this game.
 *
 * An electric line loses power in proportion to the *square of what it carries*: an idle line
 * loses nothing, a saturated one loses a great deal. A buried heat main loses heat through its
 * insulation to the ground around it, at a rate that depends on the temperature difference and
 * the length of pipe — and barely at all on how much water is flowing. So:
 *
 *     Q_loss = standingLossMwPerKm · length          (heat: constant per kilometre)
 *     P_loss = R · P² / U²                            (electricity: quadratic in flow)
 *
 * The consequence is the one every district heating engineer knows. A long pipe to a small
 * load is hopeless no matter how lightly it is used, because the loss is there whether anyone
 * draws heat or not — which is why heat networks are compact and dense, and why a heat plant
 * must stand near the town it serves while a power station can stand two hundred kilometres
 * away. Add capital costs several times those of an overhead line and the practical reach of
 * a heat main is on the order of tens of kilometres, not hundreds.
 */

import { sourced, type Sourced } from './schema'

/** Nominal bore in millimetres, used as the size label throughout. */
export type PipeSize = 200 | 400 | 700

export interface HeatPipeTypeDef {
  dn: PipeSize
  nameKey: string
  /** Heat the pipe can carry at design flow and design temperature difference. */
  capacityMwth: Sourced<number>
  /**
   * Heat lost to the ground per kilometre of route, both flow and return pipe together.
   * Independent of the load, which is exactly the point.
   */
  standingLossMwPerKm: Sourced<number>
  /**
   * Electricity consumed pumping, as a fraction of the heat delivered. Small, but it is why
   * a heat network is never quite free to run.
   */
  pumpingPowerFraction: Sourced<number>
  capexPerKm: Sourced<number>
  fixedOpexPerKmYear: Sourced<number>
  buildTimeMonthsPer10Km: Sourced<number>
  designLifeYears: Sourced<number>
}

const Y = 2021

export const HEAT_PIPE_TYPES: Record<PipeSize, HeatPipeTypeDef> = {
  200: {
    dn: 200,
    nameKey: 'pipe.dn200',
    capacityMwth: sourced(40, 'MW', 'euro-chp-practice', Y, 'Distribution main into a district'),
    standingLossMwPerKm: sourced(0.09, 'MW', 'euro-chp-practice', Y, 'Pre-insulated pair, flow and return'),
    pumpingPowerFraction: sourced(0.01, 'fraction', 'euro-chp-practice', Y),
    capexPerKm: sourced(700_000, 'EUR', 'euro-chp-practice', Y, 'Buried in a street; trenching dominates'),
    fixedOpexPerKmYear: sourced(9_000, 'EUR', 'euro-chp-practice', Y),
    buildTimeMonthsPer10Km: sourced(9, 'months', 'euro-chp-practice', Y),
    designLifeYears: sourced(40, 'years', 'engineering-standard', Y),
  },
  400: {
    dn: 400,
    nameKey: 'pipe.dn400',
    capacityMwth: sourced(160, 'MW', 'euro-chp-practice', Y, 'Transmission main between district and plant'),
    standingLossMwPerKm: sourced(0.14, 'MW', 'euro-chp-practice', Y),
    pumpingPowerFraction: sourced(0.009, 'fraction', 'euro-chp-practice', Y),
    capexPerKm: sourced(1_200_000, 'EUR', 'euro-chp-practice', Y),
    fixedOpexPerKmYear: sourced(14_000, 'EUR', 'euro-chp-practice', Y),
    buildTimeMonthsPer10Km: sourced(12, 'months', 'euro-chp-practice', Y),
    designLifeYears: sourced(40, 'years', 'engineering-standard', Y),
  },
  700: {
    dn: 700,
    nameKey: 'pipe.dn700',
    capacityMwth: sourced(500, 'MW', 'euro-chp-practice', Y, 'Trunk main from a large plant to a city'),
    standingLossMwPerKm: sourced(0.22, 'MW', 'euro-chp-practice', Y),
    pumpingPowerFraction: sourced(0.008, 'fraction', 'euro-chp-practice', Y),
    capexPerKm: sourced(2_100_000, 'EUR', 'euro-chp-practice', Y),
    fixedOpexPerKmYear: sourced(22_000, 'EUR', 'euro-chp-practice', Y),
    buildTimeMonthsPer10Km: sourced(16, 'months', 'euro-chp-practice', Y),
    designLifeYears: sourced(40, 'years', 'engineering-standard', Y),
  },
}

export const PIPE_SIZES: PipeSize[] = [200, 400, 700]

/** Heat lost along a pipe, in MW. Constant in the load — see the note at the top. */
export function pipeStandingLossMw(standingLossMwPerKm: number, lengthKm: number): number {
  return standingLossMwPerKm * lengthKm
}

/** Whether a numeric bore is one of the sizes this game builds. */
export function isPipeSize(dn: number): dn is PipeSize {
  return dn === 200 || dn === 400 || dn === 700
}
