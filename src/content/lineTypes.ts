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
  /**
   * How long the line lasts before it is a renewal project rather than a maintenance one.
   *
   * Longer than any power station, and that is the point of transmission: towers and foundations
   * outlive several generations of the plant they connect. What actually wears out is the
   * conductor, the insulators and the fittings — which is why refurbishment here is re-conductoring
   * rather than rebuilding, and why it costs a fraction of a new line.
   */
  designLifeYears: Sourced<number>
  /**
   * Faults per hundred kilometres per year, for a line in good condition.
   *
   * Lightning, wind, trees, ice, and the occasional excavator. Higher voltages fault *less* per
   * kilometre despite being more exposed: they are built to a higher standard, have better
   * clearances and better lightning protection, and the difference is large enough to be a real
   * argument for building at 220 rather than stringing more 110.
   */
  faultsPer100KmYear: Sourced<number>
  /** Hours to find and repair a typical fault, once it has happened. */
  repairHours: Sourced<number>
  /** Re-conductoring cost, as a fraction of building the line new. */
  refurbishCostFraction: Sourced<number>
  /** Cost of the substation at each end. */
  substationCapex: Sourced<number>
  /**
   * What a station of this voltage costs to own, per year, whatever flows through it.
   *
   * Switchgear maintenance, protection testing, the site, and the transformer's no-load losses —
   * which are real energy, burned continuously for as long as the station is energised, and are
   * why an unused substation is not a free option to hold.
   */
  substationFixedOpexPerYear: Sourced<number>
  /**
   * How long a switching station takes to build, on its own.
   *
   * Not per kilometre, unlike the line: a substation is a compound with switchgear in it and its
   * duration is set by procurement and commissioning rather than by distance. Rises sharply with
   * voltage for the same reason the capital cost does — a 400 kV bay is a very large machine.
   */
  substationBuildMonths: Sourced<number>
  /**
   * How many line bays a station of this voltage is built with, per voltage level on the site.
   *
   * A bay is the countable thing in a switchyard: one circuit, its breaker, its disconnectors, its
   * protection, its slice of land along the bus. A compound is laid out for a number of them and
   * running out of bays is the ordinary reason a real station cannot take another line. Counting
   * bays rather than megawatts also means a double-circuit line costs two, which is what it does.
   *
   * Per voltage level, because a transformer station is two switchyards sharing a fence: the
   * scenario's northern station has a 220 kV yard facing the centre and a 110 kV yard facing
   * Northgate and the Gorge, and neither one's bays are available to the other. Adding a level to
   * a station therefore buys real room — and costs its own fixed opex, which is charged the
   * same way.
   *
   * Falls with voltage because a 400 kV bay is enormous, and that is the trade the price ladder is
   * meant to express: fewer, far larger connections. Before this, `kv` on a station was charged
   * for at three prices and then never consulted again.
   *
   * Deliberately a limit on what may be *connected* rather than on what may flow. A throughput
   * limit would be the more faithful model, and it would mean splitting every node into two
   * halves inside the min-cost flow so a capacity arc could sit between them — which changes the
   * solver, the nodal prices that come out of it as dual variables, and every arc endpoint in
   * `dispatch.ts`. That is its own piece of work. This one is a real engineering constraint, it
   * is checkable at the moment the player asks for the connection, and it can tell them why.
   */
  substationBays: Sourced<number>
  buildTimeMonthsPer100Km: Sourced<number>
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
    designLifeYears: sourced(55, 'years', 'entsoe-factsheet', Y, 'Towers outlive conductors; this is the conductor'),
    faultsPer100KmYear: sourced(3.5, 'count', 'entsoe-factsheet', Y, 'Distribution-grade construction, more exposed to trees'),
    repairHours: sourced(14, 'hours', 'entsoe-factsheet', Y),
    refurbishCostFraction: sourced(0.35, 'fraction', 'entsoe-factsheet', Y, 'Re-conductoring on standing towers'),
    substationCapex: sourced(4_000_000, 'EUR', 'entsoe-factsheet', Y),
    substationBays: sourced(10, 'count', 'engineering-standard', Y, 'Feeder bays on a distribution-level busbar'),
    substationFixedOpexPerYear: sourced(120_000, 'EUR', 'entsoe-factsheet', Y),
    substationBuildMonths: sourced(12, 'months', 'entsoe-factsheet', Y),
    buildTimeMonthsPer100Km: sourced(18, 'months', 'entsoe-factsheet', Y),
    faultRatePerKmYear: sourced(0.004, 'fraction', 'entsoe-factsheet', Y),
  },
  220: {
    kv: 220,
    nameKey: 'line.220',
    capacityMw: sourced(500, 'MW', 'engineering-standard', Y),
    resistanceOhmPerKm: sourced(0.06, 'ohm/km', 'engineering-standard', Y),
    capexPerKm: sourced(550_000, 'EUR', 'entsoe-factsheet', Y),
    fixedOpexPerKmYear: sourced(6_000, 'EUR', 'entsoe-factsheet', Y),
    designLifeYears: sourced(60, 'years', 'entsoe-factsheet', Y),
    faultsPer100KmYear: sourced(2.2, 'count', 'entsoe-factsheet', Y),
    repairHours: sourced(18, 'hours', 'entsoe-factsheet', Y),
    refurbishCostFraction: sourced(0.32, 'fraction', 'entsoe-factsheet', Y),
    substationCapex: sourced(9_000_000, 'EUR', 'entsoe-factsheet', Y),
    substationBays: sourced(8, 'count', 'engineering-standard', Y, 'Line bays on a 220 kV double busbar'),
    substationFixedOpexPerYear: sourced(260_000, 'EUR', 'entsoe-factsheet', Y),
    substationBuildMonths: sourced(18, 'months', 'entsoe-factsheet', Y),
    buildTimeMonthsPer100Km: sourced(24, 'months', 'entsoe-factsheet', Y),
    faultRatePerKmYear: sourced(0.003, 'fraction', 'entsoe-factsheet', Y),
  },
  400: {
    kv: 400,
    nameKey: 'line.400',
    capacityMw: sourced(1400, 'MW', 'engineering-standard', Y, 'Backbone circuit'),
    resistanceOhmPerKm: sourced(0.03, 'ohm/km', 'engineering-standard', Y),
    capexPerKm: sourced(950_000, 'EUR', 'entsoe-factsheet', Y),
    fixedOpexPerKmYear: sourced(9_000, 'EUR', 'entsoe-factsheet', Y),
    designLifeYears: sourced(65, 'years', 'entsoe-factsheet', Y),
    faultsPer100KmYear: sourced(1.4, 'count', 'entsoe-factsheet', Y, 'Built to a higher standard and better protected'),
    repairHours: sourced(26, 'hours', 'entsoe-factsheet', Y, 'Bigger machines, worse access, longer outages'),
    refurbishCostFraction: sourced(0.30, 'fraction', 'entsoe-factsheet', Y),
    substationCapex: sourced(20_000_000, 'EUR', 'entsoe-factsheet', Y),
    substationBays: sourced(6, 'count', 'engineering-standard', Y, 'A 400 kV bay is very large; fewer fit a compound'),
    substationFixedOpexPerYear: sourced(600_000, 'EUR', 'entsoe-factsheet', Y),
    substationBuildMonths: sourced(30, 'months', 'entsoe-factsheet', Y, 'Consents and switchgear lead times, not concrete'),
    buildTimeMonthsPer100Km: sourced(36, 'months', 'entsoe-factsheet', Y, 'Permitting dominates, not construction'),
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
