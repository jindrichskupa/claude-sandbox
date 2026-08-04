/**
 * Politics: the regime table, elections, contracts, taxes and fuel geopolitics.
 *
 * The neutrality tests here are the most important in the suite, because this is the milestone
 * where a thumb on the scale would be easiest to apply and hardest to see. They work the same way
 * `neutrality.test.ts` does for technologies: rather than trusting the table's description of
 * itself, they compute what its levers actually do and check the result for balance.
 *
 * Two of the tests below are regressions for bugs that measurement caught and inspection did not.
 * Both are noted where they appear.
 */

import { describe, expect, it } from 'vitest'
import {
  ELECTION_TERM_YEARS,
  fuelVolatility,
  POLICY_REGIMES,
  REGIMES_BY_ID,
  stanceToward,
} from '@content/policies'
import { FUELS } from '@content/fuels'
import { PLANT_TYPES, PLANT_TYPE_IDS, type PlantTypeId } from '@content/plantTypes'
import { RandomSource } from '@sim/core/rng'
import { TICKS_PER_YEAR } from '@sim/core/time'
import { buildWorld } from '@sim/scenario/build'
import { FIRST_REGION } from '@content/scenarios/firstRegion'
import { Param } from '@sim/params/types'
import { runElection, salienceFrom, appealScore, type Salience } from '@sim/policy/elections'
import {
  confidenceAfterBreach,
  contractedPriceFor,
  isContractActive,
  offerContract,
  revokeAll,
} from '@sim/policy/contracts'
import { initialFuelIndices, stepFuelPrices } from '@sim/policy/regime'
import {
  chargeCorporateTax,
  chargeWindfallLevy,
  effectiveInterestRate,
  emptyLedger,
} from '@sim/economy/economy'
import { beginPlantConstruction } from '@sim/build/commands'

/** Emissions per MWh of electricity, which is what a carbon price actually bites on. */
function co2PerMwh(typeId: PlantTypeId): number {
  const type = PLANT_TYPES[typeId]
  return FUELS[type.fuel].co2PerMwhThermal.value / Math.max(0.01, type.efficiency.value)
}

// ---------------------------------------------------------------------------
// The regime table
// ---------------------------------------------------------------------------

describe('the policy table', () => {
  it('gives every technology a friend and an enemy', () => {
    // The neutrality claim, made mechanical. A technology no government ever favours is one the
    // player should never build; a technology none ever disfavours is a free win. Both are
    // content bugs rather than balance choices.
    const noFriend: string[] = []
    const noEnemy: string[] = []
    for (const typeId of PLANT_TYPE_IDS) {
      const stances = POLICY_REGIMES.map((r) => stanceToward(r, typeId, co2PerMwh(typeId)))
      const best = Math.max(...stances)
      const worst = Math.min(...stances)
      if (best <= 0) noFriend.push(typeId)
      if (worst >= 0) noEnemy.push(typeId)
    }
    expect(noFriend).toEqual([])
    expect(noEnemy).toEqual([])
  })

  it('offers both sides a comparable best case', () => {
    // The measure is each technology's *best* stance across the table — how good politics can
    // ever get for it — rather than the sum over regimes. Summing rewards a technology merely
    // for having more governments that like it a little, which is a different and much less
    // interesting property than whether a favourable government exists at all.
    const clean = PLANT_TYPE_IDS.filter((id) => co2PerMwh(id) < 0.05)
    const emitting = PLANT_TYPE_IDS.filter((id) => co2PerMwh(id) >= 0.05)
    const bestFor = (id: PlantTypeId): number =>
      Math.max(...POLICY_REGIMES.map((r) => stanceToward(r, id, co2PerMwh(id))))

    const bestClean = Math.max(...clean.map(bestFor))
    const bestEmitting = Math.max(...emitting.map(bestFor))
    const ratio = bestClean / Math.max(1e-9, bestEmitting)
    expect(ratio, `clean ${bestClean.toFixed(0)} vs emitting ${bestEmitting.toFixed(0)}`).toBeGreaterThan(0.5)
    expect(ratio, `clean ${bestClean.toFixed(0)} vs emitting ${bestEmitting.toFixed(0)}`).toBeLessThan(2)
  })

  it('has governments that keep their word and governments that do not', () => {
    const honour = POLICY_REGIMES.filter((r) => r.levers.honoursContracts)
    const repudiate = POLICY_REGIMES.filter((r) => !r.levers.honoursContracts)
    expect(honour.length).toBeGreaterThan(0)
    // The interesting half. Without it, support policy would be a one-way ratchet and the
    // financial risk that makes it worth modelling would disappear.
    expect(repudiate.length).toBeGreaterThan(0)
  })

  it('lets every regime win under some outcome the player could produce', () => {
    // Dead content is a real failure: a regime that can never form a government is a table entry
    // pretending to be a possibility. Each is tested against the salience it is built for.
    const unelectable: string[] = []
    for (const regime of POLICY_REGIMES) {
      const salience: Salience = {
        affordability: regime.appeal.affordability > 0 ? 1 : 0,
        reliability: regime.appeal.reliability > 0 ? 1 : 0,
        emissions: regime.appeal.emissions > 0 ? 1 : 0,
        security: regime.appeal.security > 0 ? 1 : 0,
      }
      const best = POLICY_REGIMES.reduce((a, b) =>
        appealScore(a, salience) >= appealScore(b, salience) ? a : b,
      )
      // It need not be the single best on its own favourite axes, but it must at least be
      // competitive — within reach of the winner once incumbency and noise are in play.
      const gap = appealScore(best, salience) - appealScore(regime, salience)
      if (gap > 0.6) unelectable.push(`${regime.id} (behind by ${gap.toFixed(2)})`)
    }
    expect(unelectable).toEqual([])
  })

  it('states a source for every number it uses', () => {
    for (const regime of POLICY_REGIMES) {
      const levers = regime.levers
      for (const field of [
        levers.carbonPricePerTonne,
        levers.corporateTaxRate,
        levers.permittingSpeed,
        levers.supportTermYears,
        levers.tariffFactor,
      ]) {
        expect(field.source, regime.id).toBeTruthy()
        expect(field.sourceYear, regime.id).toBeGreaterThan(1990)
      }
      for (const [typeId, offer] of Object.entries(levers.supportOffers)) {
        expect(offer?.source, `${regime.id}/${typeId}`).toBeTruthy()
      }
    }
  })
})

// ---------------------------------------------------------------------------
// Elections
// ---------------------------------------------------------------------------

describe('elections', () => {
  const baseInputs = {
    averagePricePerMwh: 60,
    unservedShare: 0,
    carbonIntensity: 0.1,
    importExposure: 0.1,
    publicOpinion: 0.5,
  }

  it('reads anger off outcomes rather than off technologies', () => {
    const calm = salienceFrom(baseInputs)
    expect(calm.affordability).toBeLessThan(0.3)
    expect(calm.reliability).toBe(0)

    const crisis = salienceFrom({
      ...baseInputs,
      averagePricePerMwh: 200,
      unservedShare: 0.01,
      carbonIntensity: 0.9,
    })
    expect(crisis.affordability).toBe(1)
    expect(crisis.reliability).toBe(1)
    expect(crisis.emissions).toBe(1)
  })

  it('turns a dirty system green and a dark one toward firm capacity', () => {
    // Both of these are the player's doing, and the model must respond to the difference.
    const stream = new RandomSource(7).streamFor('election')

    let greenWins = 0
    let firmWins = 0
    for (let seed = 0; seed < 60; seed++) {
      const dirty = runElection(
        salienceFrom({ ...baseInputs, carbonIntensity: 0.9 }),
        'market_liberal',
        baseInputs,
        2010,
        stream,
        seed,
      )
      if (dirty.winnerId === 'renewables_push' || dirty.winnerId === 'clean_firm') greenWins++

      const dark = runElection(
        salienceFrom({ ...baseInputs, unservedShare: 0.02, importExposure: 0.7 }),
        'market_liberal',
        baseInputs,
        2010,
        stream,
        seed + 5000,
      )
      if (dark.winnerId === 'energy_security' || dark.winnerId === 'clean_firm') firmWins++
    }
    expect(greenWins).toBeGreaterThan(30)
    expect(firmWins).toBeGreaterThan(30)
  })

  it('rewards an incumbent the public thinks well of', () => {
    const stream = new RandomSource(11).streamFor('election')
    const salience = salienceFrom(baseInputs)
    let liked = 0
    let disliked = 0
    for (let seed = 0; seed < 80; seed++) {
      if (runElection(salience, 'market_liberal', { ...baseInputs, publicOpinion: 0.95 }, 2010, stream, seed).winnerId === 'market_liberal') liked++
      if (runElection(salience, 'market_liberal', { ...baseInputs, publicOpinion: 0.05 }, 2010, stream, seed).winnerId === 'market_liberal') disliked++
    }
    expect(liked).toBeGreaterThan(disliked)
  })

  it('does not offer a position before it exists', () => {
    const stream = new RandomSource(3).streamFor('election')
    for (let seed = 0; seed < 40; seed++) {
      const result = runElection(salienceFrom(baseInputs), 'market_liberal', baseInputs, 1992, stream, seed)
      const winner = REGIMES_BY_ID.get(result.winnerId)!
      expect(winner.fromYear).toBeLessThanOrEqual(1992)
    }
  })
})

// ---------------------------------------------------------------------------
// Contracts
// ---------------------------------------------------------------------------

describe('support contracts', () => {
  it('pays only between commissioning and expiry', () => {
    const contract = offerContract('renewables_push', 'p1', 'wind', 100, 1000, 1)!
    expect(contract).not.toBeNull()

    // Promised, but the plant is still being built.
    expect(isContractActive(contract, 500)).toBe(false)
    expect(contractedPriceFor([contract], 'p1', 500)).toBe(0)

    expect(isContractActive(contract, 1200)).toBe(true)
    expect(contractedPriceFor([contract], 'p1', 1200)).toBeGreaterThan(0)

    expect(isContractActive(contract, contract.expiresTick + 1)).toBe(false)
  })

  it('offers nothing for a technology the government does not support', () => {
    expect(offerContract('renewables_push', 'p1', 'lignite', 0, 100, 1)).toBeNull()
    expect(offerContract('market_liberal', 'p1', 'wind', 0, 100, 1)).toBeNull()
    // And the security government supports the opposite list, which is the point of the table.
    expect(offerContract('energy_security', 'p1', 'lignite', 0, 100, 1)).not.toBeNull()
  })

  it('stops paying the moment a government tears it up', () => {
    const contract = offerContract('renewables_push', 'p1', 'wind', 0, 0, 1)!
    expect(contractedPriceFor([contract], 'p1', 1000)).toBeGreaterThan(0)
    revokeAll([contract], 1000)
    expect(contract.revokedTick).toBe(1000)
    expect(contractedPriceFor([contract], 'p1', 1001)).toBe(0)
  })

  it('makes tearing one up cost the country its borrowing rate', () => {
    const intact = effectiveInterestRate(1)
    const damaged = effectiveInterestRate(confidenceAfterBreach(1, 500e6, 600e6))
    expect(damaged).toBeGreaterThan(intact)
    // And a bigger repudiation costs more than a token one.
    const small = confidenceAfterBreach(1, 10e6, 600e6)
    const large = confidenceAfterBreach(1, 900e6, 600e6)
    expect(large).toBeLessThan(small)
  })

  it('grants a contract when construction starts, not when the plant arrives', () => {
    // The gap between the two is one construction time and possibly one election, and it is the
    // whole risk profile of building anything in this industry.
    const world = buildWorld(FIRST_REGION)
    world.state.policyRegimeId = 'clean_firm'
    for (let i = 0; i < 24; i++) world.step()

    const before = world.state.contracts.length
    // Find somewhere the cogeneration unit is actually allowed to stand, rather than guessing a
    // tile: the siting rules keep it within reach of a town and off other stations, and a test
    // that hard-codes a spot is really testing the map generator.
    let built: ReturnType<typeof beginPlantConstruction> | null = null
    for (let y = 0; y < world.scenario.mapHeight && !built?.ok; y++) {
      for (let x = 0; x < world.scenario.mapWidth && !built?.ok; x++) {
        const attempt = beginPlantConstruction(world, 'gas_chp', x, y)
        if (attempt.ok) built = attempt
      }
    }
    expect(built?.ok, 'no legal site for a cogeneration unit anywhere on the map').toBe(true)
    expect(world.state.contracts.length).toBeGreaterThan(before)

    const contract = world.state.contracts[world.state.contracts.length - 1]!
    expect(contract.grantedTick).toBeLessThan(contract.startsTick)
    expect(isContractActive(contract, world.tick)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Taxes and fuel
// ---------------------------------------------------------------------------

describe('taxes', () => {
  it('taxes profit and not losses', () => {
    const profitable = emptyLedger()
    chargeCorporateTax(profitable, 100e6, 0.19)
    expect(profitable.tax).toBeCloseTo(19e6, 3)

    const lossmaking = emptyLedger()
    chargeCorporateTax(lossmaking, -100e6, 0.19)
    expect(lossmaking.tax).toBe(0)
  })

  it('levies a windfall only on revenue above the threshold', () => {
    const calm = emptyLedger()
    chargeWindfallLevy(calm, 1000, 120, 180, 0.9)
    expect(calm.windfallLevy).toBe(0)

    const crisis = emptyLedger()
    chargeWindfallLevy(crisis, 1000, 280, 180, 0.9)
    expect(crisis.windfallLevy).toBeCloseTo(100 * 1000 * 0.9, 3)
  })
})

describe('fuel geopolitics', () => {
  it('moves an imported fuel far more than a domestic one', () => {
    // The whole reason the index is per fuel. A single global scalar would say a political
    // shock moves mine-mouth lignite and pipeline gas alike, which is the opposite of the truth.
    const indices = initialFuelIndices()
    const stream = new RandomSource(31).streamFor('fuel')
    let gasSwing = 0
    let ligniteSwing = 0
    for (let month = 0; month < 400; month++) {
      stepFuelPrices(indices, 'market_liberal', stream, month * 730)
      gasSwing += Math.abs((indices.gas ?? 1) - 1)
      ligniteSwing += Math.abs((indices.lignite ?? 1) - 1)
    }
    expect(gasSwing).toBeGreaterThan(ligniteSwing * 2)
  })

  it('lets a government that diversifies supply damp the swings', () => {
    expect(fuelVolatility(0.8, 0.6)).toBeCloseTo(0.32, 6)
    expect(fuelVolatility(0.8, 0)).toBeCloseTo(0.8, 6)

    const open = initialFuelIndices()
    const diversified = initialFuelIndices()
    const stream = new RandomSource(77).streamFor('fuel')
    let openSwing = 0
    let diversifiedSwing = 0
    for (let month = 0; month < 300; month++) {
      const tick = month * 730
      stepFuelPrices(open, 'market_liberal', stream, tick)
      stepFuelPrices(diversified, 'energy_security', stream, tick)
      openSwing += Math.abs((open.gas ?? 1) - 1)
      diversifiedSwing += Math.abs((diversified.gas ?? 1) - 1)
    }
    expect(diversifiedSwing).toBeLessThan(openSwing)
  })

  it('never lets a price run away over a long game', () => {
    // Mean reversion rather than a random walk. A walk would drift to absurdity over forty
    // years and make every long-run decision meaningless.
    const indices = initialFuelIndices()
    const stream = new RandomSource(5).streamFor('fuel')
    for (let month = 0; month < 40 * 12; month++) {
      stepFuelPrices(indices, 'market_liberal', stream, month * 730)
      for (const value of Object.values(indices)) {
        expect(value).toBeGreaterThan(0.3)
        expect(value).toBeLessThan(4.1)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// The whole thing running
// ---------------------------------------------------------------------------

describe('politics in a real scenario', () => {
  it('does not let the carbon price compound with itself', () => {
    // Regression. `baseValue` read the *current* carbon price from world state, the policy layer
    // added its delta, and the result was written back to that state — so next month the delta
    // was added again. Twenty years of that reached €11,000 a tonne. Every individual step looked
    // right, which is exactly how a feedback loop hides.
    // Three years is plenty: the loop compounded *monthly*, so thirty-six doublings would be
    // unmissable. Running twelve years to prove it would be twelve years of arithmetic to
    // learn nothing the third year had not already said.
    const world = buildWorld(FIRST_REGION)
    for (let i = 0; i < TICKS_PER_YEAR * 3; i++) world.step()
    const carbon = world.params.getOr('world', Param.CarbonPricePerTonne, 0)
    const highest = Math.max(...POLICY_REGIMES.map((r) => r.levers.carbonPricePerTonne.value))
    expect(carbon).toBeLessThanOrEqual(highest + 1e-6)
  })

  it('lets the regulated tariff pass a carbon price through to the customer', () => {
    // The other regression, and the more important one. Without a tariff that is reset against
    // the market, a carbon price is a pure cost to the utility with no pass-through — which is
    // not a hard policy environment but a broken market, and would make every decarbonisation
    // regime lethal regardless of what the player did.
    const world = buildWorld(FIRST_REGION)
    const startingTariff = world.state.regulatedTariffPerMwh
    world.state.policyRegimeId = 'renewables_push'
    for (let i = 0; i < TICKS_PER_YEAR * 4; i++) world.step()

    expect(world.state.carbonPricePerTonne).toBeGreaterThan(50)
    expect(world.state.regulatedTariffPerMwh).toBeGreaterThan(startingTariff)
    expect(world.finances.bankrupt).toBe(false)
  })

  it('holds elections, changes government, and does not bankrupt an idle player doing so', () => {
    // Three assertions off one run rather than three runs. Each of them needs a decade or so of
    // simulated time and they need the same decade, so running it three times would cost three
    // times as much to learn the same thing.
    const world = buildWorld(FIRST_REGION)
    const elections: number[] = []
    const governments = new Set<string>([world.state.policyRegimeId])
    const YEARS = 12
    for (let i = 0; i < TICKS_PER_YEAR * YEARS; i++) {
      world.step()
      if (world.lastElection) {
        elections.push(world.lastElection.year)
        governments.add(world.lastElection.toId)
        world.lastElection = null
      }
    }
    const expected = Math.floor(YEARS / ELECTION_TERM_YEARS.value)
    expect(elections.length).toBeGreaterThanOrEqual(expected - 1)
    // A country with one permanent government would make the whole milestone decorative.
    expect(governments.size).toBeGreaterThan(1)
    // Not a claim that idling is a good strategy — a claim that the political system alone does
    // not kill a player who does nothing, which is the same line the event system draws.
    expect(world.finances.bankrupt).toBe(false)
  })
})
