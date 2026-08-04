/**
 * Elections.
 *
 * The design constraint is stated in `content/policies.ts` and is worth repeating here, because
 * this file is where it would be easiest to break: **no regime wins for being right.** A regime
 * wins when the thing it is good at is the thing currently going wrong, and everything that can
 * go wrong is something the player did.
 *
 * So the model is two vectors and a dot product. Salience says what the public is angry about,
 * measured from the year that actually happened: what electricity cost, whether the lights
 * stayed on, what was emitted, how much of the fuel had to be imported. Appeal says how much
 * each regime gains from each of those. Multiply, add the incumbency effect, and the largest
 * number forms a government.
 *
 * That structure makes a thumb on the scale hard to hide. There is no term for "this technology
 * is popular", no bonus for the regime the author agrees with, and no random party that turns up
 * to punish a player who was doing well. A player who keeps prices low, the lights on and
 * emissions falling is re-electing a stable government by doing so — which is both the reward
 * and, since governments change anyway, not a permanent one.
 */

import { POLICY_REGIMES, type PolicyRegimeDef } from '@content/policies'
import type { RandomStream } from '../core/rng'

/** What the electorate is currently angry about. Each entry runs 0 (fine) to 1 (a scandal). */
export interface Salience {
  affordability: number
  reliability: number
  emissions: number
  security: number
}

export interface ElectionInputs {
  /** Demand-weighted average price over the term, EUR/MWh. */
  averagePricePerMwh: number
  /** Share of demand not served, including heat. */
  unservedShare: number
  /** Tonnes of CO2 per MWh sold. */
  carbonIntensity: number
  /** Share of generation from fuel the country has to import, weighted by how exposed it is. */
  importExposure: number
  /** How the public rates the utility, 0..1. Moves the incumbent's standing, not any policy. */
  publicOpinion: number
}

/**
 * Turn a year of outcomes into political salience.
 *
 * The thresholds are where a real number becomes an issue people vote on, and they are blunt on
 * purpose: this decides which way an election leans, not how much power a station makes, and
 * precision here would be false precision.
 */
export function salienceFrom(inputs: ElectionInputs): Salience {
  const clamp = (x: number): number => Math.max(0, Math.min(1, x))
  return {
    // Around 40 EUR/MWh nobody complains; by 160 it is the only subject.
    affordability: clamp((inputs.averagePricePerMwh - 40) / 120),
    // Half a percent of demand unserved is a national story.
    reliability: clamp(inputs.unservedShare / 0.005),
    // 0.8 t/MWh is a coal-dominated system; near zero is a decarbonised one.
    emissions: clamp(inputs.carbonIntensity / 0.8),
    security: clamp(inputs.importExposure / 0.6),
  }
}

/** How much the incumbent's own record shifts its score, either way. */
const INCUMBENCY_WEIGHT = 0.5
/** Scale of the unmodelled — scandals, personalities, the rest of politics. */
const POLITICAL_NOISE = 0.35

export interface ElectionResult {
  winnerId: string
  /** Every runner's share of the vote, summing to 1. Drives the polling display. */
  shares: Record<string, number>
}

/**
 * Score each regime, and form a government.
 *
 * The noise term is not decoration. Energy policy is one issue among many, and a model in which
 * the electricity system alone decides every election would be both wrong and, for the player,
 * a strategy: keep four numbers in the right places and never face a change of government again.
 * It is drawn from a seeded stream like everything else, so a replay is still identical.
 */
export function runElection(
  salience: Salience,
  incumbentId: string,
  inputs: ElectionInputs,
  year: number,
  stream: RandomStream,
  tick: number,
): ElectionResult {
  const runners = POLICY_REGIMES.filter((r) => year >= r.fromYear)
  const scores = new Map<string, number>()

  runners.forEach((regime, index) => {
    let score = appealScore(regime, salience)
    if (regime.id === incumbentId) {
      // A government is judged on its record: praised when the utility is well regarded,
      // thrown out when it is not. Note that this reads public opinion, which itself follows
      // reliability and emissions — never the technologies that produced them.
      score += (inputs.publicOpinion - 0.5) * 2 * INCUMBENCY_WEIGHT
    }
    score += (stream.float(tick, index + 1) - 0.5) * 2 * POLITICAL_NOISE
    scores.set(regime.id, score)
  })

  // Softmax for the vote shares, so the display shows a contest rather than a verdict.
  let total = 0
  const exponentiated = new Map<string, number>()
  for (const [id, score] of scores) {
    const e = Math.exp(score * 2)
    exponentiated.set(id, e)
    total += e
  }

  const shares: Record<string, number> = {}
  let winnerId = incumbentId
  let best = -Infinity
  for (const [id, e] of exponentiated) {
    shares[id] = e / total
    const score = scores.get(id)!
    if (score > best) {
      best = score
      winnerId = id
    }
  }

  return { winnerId, shares }
}

/** The dot product at the heart of the model. */
export function appealScore(regime: PolicyRegimeDef, salience: Salience): number {
  return (
    salience.affordability * regime.appeal.affordability +
    salience.reliability * regime.appeal.reliability +
    salience.emissions * regime.appeal.emissions +
    salience.security * regime.appeal.security
  )
}
