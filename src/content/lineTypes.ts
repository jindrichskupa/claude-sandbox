/**
 * Transmission voltage levels.
 *
 * The loss model is the textbook one. For a three-phase line carrying P at voltage U with
 * total resistance R:
 *
 *     P_loss = R · P² / U²        (with P in MW, U in kV, R in ohms)
 *
 * Two consequences drive the whole voltage decision, and both are real: losses grow with the
 * *square* of the power carried, and they fall with the *square* of the voltage. Doubling the
 * voltage cuts losses fourfold. That is why long-distance transmission is worth its much
 * higher capital cost, and why running a heavily loaded 110 kV line across the map is a
 * mistake the player should be allowed to make once.
 */

import { sourced, type Sourced } from './schema'

export type VoltageLevel = 110 | 220 | 400

export interface LineTypeDef {
  kv: VoltageLevel
  nameKey: string
  /** Thermal rating per circuit. */
  capacityMw: Sourced<number>
  /** Series resistance per kilometre. */
  resistanceOhmPerKm: Sourced<number>
  capexPerKm: Sourced<number>
  fixedOpexPerKmYear: Sourced<number>
  /** Cost of the substation at each end. */
  substationCapex: Sourced<number>
  /**
   * How long a switching station takes to build, on its own.
   *
   * Not per kilometre, unlike the line: a substation is a compound with switchgear in it and its
   * duration is set by procurement and commissioning rather than by distance. Rises sharply with
   * voltage for the same reason the capital cost does — a 400 kV bay is a very large machine.
   */
  substationBuildMonths: Sourced<number>
  buildTimeMonthsPer100Km: Sourced<number>
  designLifeYears: Sourced<number>
  /** Base probability per year that a given kilometre suffers a fault. */
  faultRatePerKmYear: Sourced<number>
}

const Y = 2022

export const LINE_TYPES: Record<VoltageLevel, LineTypeDef> = {
  110: {
    kv: 110,
    nameKey: 'line.110',
    capacityMw: sourced(150, 'MW', 'engineering-standard', Y, 'Single circuit, typical conductor'),
    resistanceOhmPerKm: sourced(0.12, 'ohm/km', 'engineering-standard', Y),
    capexPerKm: sourced(350_000, 'EUR', 'entsoe-factsheet', Y, 'Overhead line, flat terrain'),
    fixedOpexPerKmYear: sourced(4_000, 'EUR', 'entsoe-factsheet', Y),
    substationCapex: sourced(4_000_000, 'EUR', 'entsoe-factsheet', Y),
    substationBuildMonths: sourced(12, 'months', 'entsoe-factsheet', Y),
    buildTimeMonthsPer100Km: sourced(18, 'months', 'entsoe-factsheet', Y),
    designLifeYears: sourced(50, 'years', 'engineering-standard', Y),
    faultRatePerKmYear: sourced(0.004, 'fraction', 'entsoe-factsheet', Y),
  },
  220: {
    kv: 220,
    nameKey: 'line.220',
    capacityMw: sourced(500, 'MW', 'engineering-standard', Y),
    resistanceOhmPerKm: sourced(0.06, 'ohm/km', 'engineering-standard', Y),
    capexPerKm: sourced(550_000, 'EUR', 'entsoe-factsheet', Y),
    fixedOpexPerKmYear: sourced(6_000, 'EUR', 'entsoe-factsheet', Y),
    substationCapex: sourced(9_000_000, 'EUR', 'entsoe-factsheet', Y),
    substationBuildMonths: sourced(18, 'months', 'entsoe-factsheet', Y),
    buildTimeMonthsPer100Km: sourced(24, 'months', 'entsoe-factsheet', Y),
    designLifeYears: sourced(50, 'years', 'engineering-standard', Y),
    faultRatePerKmYear: sourced(0.003, 'fraction', 'entsoe-factsheet', Y),
  },
  400: {
    kv: 400,
    nameKey: 'line.400',
    capacityMw: sourced(1400, 'MW', 'engineering-standard', Y, 'Backbone circuit'),
    resistanceOhmPerKm: sourced(0.03, 'ohm/km', 'engineering-standard', Y),
    capexPerKm: sourced(950_000, 'EUR', 'entsoe-factsheet', Y),
    fixedOpexPerKmYear: sourced(9_000, 'EUR', 'entsoe-factsheet', Y),
    substationCapex: sourced(20_000_000, 'EUR', 'entsoe-factsheet', Y),
    substationBuildMonths: sourced(30, 'months', 'entsoe-factsheet', Y, 'Consents and switchgear lead times, not concrete'),
    buildTimeMonthsPer100Km: sourced(36, 'months', 'entsoe-factsheet', Y, 'Permitting dominates, not construction'),
    designLifeYears: sourced(50, 'years', 'engineering-standard', Y),
    faultRatePerKmYear: sourced(0.002, 'fraction', 'entsoe-factsheet', Y),
  },
}

export const VOLTAGE_LEVELS: VoltageLevel[] = [110, 220, 400]

/**
 * Loss on a line, in MW. Quadratic in the transported power, which is what makes an
 * overloaded corridor expensive rather than merely full.
 */
export function lineLossMw(powerMw: number, resistanceOhmPerKm: number, lengthKm: number, kv: number): number {
  const r = resistanceOhmPerKm * lengthKm
  return (r * powerMw * powerMw) / (kv * kv)
}
