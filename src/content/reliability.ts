/**
 * How machines fail, and how that changes as they get old.
 *
 * ## Why this file exists
 *
 * Measured over thirty passive years of the opening scenario, the inherited fleet never died.
 * Eight units in 1995, eight units in 2026. They sailed past their design lives, condition
 * decayed, availability slipped and unserved energy drifted from nothing to about 0.6% a year —
 * and nothing ever forced a decision. A scenario in which no crisis arrives on its own has no
 * turning point, and a fleet that cannot die makes the whole replace-or-refurbish half of the
 * game optional.
 *
 * The fix is not a rule that closes plants at a fixed age. That would be arbitrary, and it would
 * be wrong: units run decades past their nameplate design life all over the world, and the reason
 * they eventually stop is economic and probabilistic rather than legislative.
 *
 * ## The bathtub curve
 *
 * Reliability engineering has had the right shape for this since the 1950s. The hazard rate of a
 * machine over its life is a bathtub: high while the commissioning faults are shaken out, flat
 * and low through the useful life, then **rising steeply as wear-out mechanisms accumulate** —
 * creep in high-temperature steel, thermal fatigue in headers, embrittlement, insulation
 * breakdown. Design life is roughly where the flat part ends. Past it the hazard does not step
 * up; it climbs, and it keeps climbing.
 *
 * So the outage rate here is the type's own figure multiplied by a wear factor that is one
 * through the useful life and rises as a power of how far past it the machine is. Nothing is
 * forbidden, everything gets worse, and the player decides when it stopped being worth it. Which
 * is the actual decision a fleet owner makes.
 *
 * ## Terminal failure
 *
 * The other half, and the one that creates the crisis. Most outages are repairable. A few are
 * not: a cracked turbine casing, a failed generator stator, a boiler drum past economic repair.
 * The unit is not out for six weeks, it is finished — and the owner discovers that a replacement
 * takes six years to build.
 *
 * That is rare in a healthy fleet and much less rare in a worn one, which is exactly why it makes
 * a good game mechanic: it is a consequence of neglect rather than a random punishment, it is
 * visible in advance through the same numbers that drive the ordinary outage rate, and it is
 * insurable and preventable by refurbishment — both of which the game already has.
 */

import { sourced, type Sourced } from './schema'

export interface ReliabilityDef {
  /**
   * How sharply the failure rate climbs past design life.
   *
   * The wear factor is `(1 + overrun)^exponent`, where overrun is how far past the design life
   * the machine is as a fraction of it. At 3, a unit 50% past its life fails about three times as
   * often as a new one and one at twice its life about eight times — which is the right order for
   * the wear-out region of a bathtub curve and is why very old plant spends so much of the year
   * out of service.
   */
  wearOutExponent: Sourced<number>
  /**
   * Chance that a forced outage turns out to be terminal, at exactly the design life.
   *
   * Small: most failures at the end of the useful life are still repairable.
   */
  terminalShareAtDesignLife: Sourced<number>
  /**
   * The same at twice the design life.
   *
   * Interpolated between the two, and clamped. The gap between them is what makes running a
   * machine into the ground a gamble with rising stakes rather than a free option.
   */
  terminalShareAtDoubleLife: Sourced<number>
  /**
   * Below this fraction of design life, a failure is never terminal.
   *
   * A new machine breaking permanently would be a manufacturing scandal, not a game mechanic,
   * and putting one in the model would make every early build feel arbitrary.
   */
  terminalFromLifeFraction: Sourced<number>
}

export const RELIABILITY: ReliabilityDef = {
  wearOutExponent: sourced(
    3,
    'count',
    'engineering-standard',
    2023,
    'Wear-out region of a bathtub hazard curve; Weibull shape parameters for thermal plant are typically 2 to 4',
  ),
  terminalShareAtDesignLife: sourced(
    0.02,
    'fraction',
    'engineering-standard',
    2023,
    'Share of forced outages that are beyond economic repair at the end of the design life',
  ),
  terminalShareAtDoubleLife: sourced(
    0.18,
    'fraction',
    'engineering-standard',
    2023,
    'The same for a machine run to twice its design life',
  ),
  terminalFromLifeFraction: sourced(
    0.9,
    'fraction',
    'game-design',
    2024,
    'Nothing fails beyond repair before it is nearly worn out',
  ),
}
