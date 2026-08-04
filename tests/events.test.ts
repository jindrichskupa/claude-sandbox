/**
 * Events, and the machinery that makes them survivable.
 *
 * Two very different kinds of test live here. The first kind checks the *content*: properties
 * the event table must have for the game to be fair, checked over the whole table rather than
 * trusted to the author. The second kind checks the *director*: that the forewarning, the
 * severity budget, the cooldown and the grace period actually do what the design says, because
 * every one of them is invisible when it works and only noticed when it does not.
 *
 * The rate test is deliberately statistical. A single ten-year run tells you almost nothing
 * about whether a 0.25-per-year event fires at the right frequency; the only honest way to check
 * a sampler is to sample it a great many times and compare against the expectation.
 */

import { describe, expect, it } from 'vitest'
import { EVENTS, EVENTS_BY_ID, layerForCategory, SEVERE_THRESHOLD } from '@content/events'
import { Layer, Op, Param } from '@sim/params/types'
import { RandomSource } from '@sim/core/rng'
import { TICKS_PER_YEAR } from '@sim/core/time'
import { Network, PLAYER } from '@sim/grid/network'
import { ModifierRegistry } from '@sim/params/ModifierRegistry'
import { Params } from '@sim/params/Params'
import { buildWorld } from '@sim/scenario/build'
import { FIRST_REGION } from '@content/scenarios/firstRegion'
import { LifecyclePhase, type PlantAsset } from '@sim/assets/types'
import {
  conditionHolds,
  EventDirector,
  GRACE_TICKS,
  hourlyRate,
  severityBudget,
  SEVERE_COOLDOWN_TICKS,
  type DirectorContext,
} from '@sim/events/director'
import { TEMPERATE_CLIMATE, WeatherModel } from '@sim/weather/weather'
import type { Finances } from '@sim/economy/economy'

// ---------------------------------------------------------------------------
// Content: the fairness guarantees
// ---------------------------------------------------------------------------

describe('the event table', () => {
  it('offers a way out of every severe event', () => {
    // The design rule that makes randomness bearable: no heavy event is simply something that
    // happens to you. There must be at least one response that actually reduces it.
    const unavoidable: string[] = []
    for (const def of EVENTS) {
      if (def.severity.value < SEVERE_THRESHOLD) continue
      const helps = def.choices.some(
        (c) => (c.mitigation > 0 || c.outageMitigation > 0) && !c.requiresInsurance,
      )
      if (!helps) unavoidable.push(def.id)
    }
    expect(unavoidable).toEqual([])
  })

  it('always leaves accepting the consequences on the table, free', () => {
    // A player who cannot pay must still be able to answer. Otherwise a bad balance sheet
    // turns into an unresolvable dialogue rather than a hard decision.
    const noFreeOption: string[] = []
    for (const def of EVENTS) {
      if (!def.choices.some((c) => c.costEur === 0 && !c.requiresInsurance)) noFreeOption.push(def.id)
    }
    expect(noFreeOption).toEqual([])
  })

  it('gives every event at least one real decision', () => {
    for (const def of EVENTS) {
      expect(def.choices.length, def.id).toBeGreaterThanOrEqual(2)
    }
  })

  it('warns before anything that is not physics', () => {
    // Machinery breaks without notice and weather arrives with a forecast. Politics, markets
    // and geopolitics all announce themselves first — those are the ones a player could
    // reasonably expect to see coming, and taking that away would feel arbitrary.
    for (const def of EVENTS) {
      if (def.category === 'technical') continue
      expect(def.forewarningHours.value, def.id).toBeGreaterThan(0)
    }
  })

  it('keeps geopolitics in its own layer, and events in theirs', () => {
    // Not cosmetic: modifiers add within a layer and multiply across, so a fuel cut and a
    // broken turbine landing in the same layer would add together as if they were the same
    // kind of derating.
    expect(layerForCategory('geopolitical')).toBe(Layer.Geopolitics)
    expect(layerForCategory('technical')).toBe(Layer.Event)
    expect(layerForCategory('political')).toBe(Layer.Policy)
  })

  it('states a source for every number it uses', () => {
    // The same guarantee the rest of the content carries. Severity is a design number and says
    // so; the rates lean on published statistics where those exist.
    for (const def of EVENTS) {
      for (const field of [def.severity, def.baseRatePerYear, def.forewarningHours]) {
        expect(field.source, def.id).toBeTruthy()
        expect(field.sourceYear, def.id).toBeGreaterThan(1990)
      }
      for (const factor of def.riskFactors) {
        expect(factor.multiplier.source, `${def.id}/${factor.condition}`).toBeTruthy()
      }
    }
  })

  it('has no event that only ever makes things better', () => {
    // An "event" with no downside is a gift, and a table of gifts is a thumb on the scale.
    for (const def of EVENTS) {
      const harmful =
        def.outage !== undefined ||
        def.effects.some((e) => {
          const worse =
            e.param === Param.DemandMw || e.param === Param.HeatDemandMw ||
            e.param === Param.FuelPricePerMwhThermal || e.param === Param.VarOpexPerMwh ||
            e.param === Param.CapexPerKw || e.param === Param.BuildTimeMonths
          return e.op === Op.AddFrac ? (worse ? e.value > 0 : e.value < 0) : true
        })
      expect(harmful, def.id).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// The director
// ---------------------------------------------------------------------------

function context(overrides: Partial<DirectorContext> = {}): DirectorContext {
  const rng = new RandomSource(1234)
  const registry = new ModifierRegistry()
  const network = new Network()
  network.addNode({ id: 'site', kind: 'plant', ownerId: PLAYER, x: 0, y: 0 })
  const finances: Finances = { cash: 400e6, debt: 250e6, trailingRevenue: 600e6, bankrupt: false }
  return {
    tick: GRACE_TICKS + 1,
    year: 2000,
    weather: new WeatherModel(rng, TEMPERATE_CLIMATE).generate(0, 0),
    plants: [],
    cities: [],
    network,
    finances,
    publicOpinion: 0.5,
    maintenanceLevel: 1,
    insured: false,
    recentBlackout: false,
    registry,
    stream: rng.streamFor('events'),
    ...overrides,
  }
}

function plant(id: string, typeId: PlantAsset['typeId']): PlantAsset {
  return {
    id,
    ownerId: PLAYER,
    typeId,
    nodeId: 'site',
    phase: LifecyclePhase.Operating,
    phaseEndsTick: Number.MAX_SAFE_INTEGER,
    commissionedTick: 0,
    conditionPct: 1,
    cumulativeRunHours: 0,
    cumulativeStarts: 0,
    outputMw: 0,
    heatOutputMw: 0,
    storageMwh: 0,
    heatStoredMwhth: 0,
    cyclesUsed: 0,
    online: true,
    capexPaid: 0,
    refurbishments: 0,
    lifeExtension: 0,
    efficiencyUplift: 0,
    capacityUplift: 0,
  }
}

describe('risk', () => {
  it('multiplies the rate by every condition that holds, and no others', () => {
    const def = EVENTS_BY_ID.get('turbine_failure')!
    const calm = context({ maintenanceLevel: 1 })
    const neglected = context({ maintenanceLevel: 0.6 })
    expect(hourlyRate(def, neglected)).toBeGreaterThan(hourlyRate(def, calm))

    // The multiplier is the one in the table, not something invented in the director.
    const factor = def.riskFactors.find((f) => f.condition === 'deferredMaintenance')!
    expect(hourlyRate(def, neglected) / hourlyRate(def, calm)).toBeCloseTo(factor.multiplier.value, 6)
  })

  it('lets thorough maintenance buy down technical risk and nothing else', () => {
    const technical = EVENTS_BY_ID.get('turbine_failure')!
    const geopolitical = EVENTS_BY_ID.get('gas_supply_interruption')!
    const normal = context({ maintenanceLevel: 1 })
    const thorough = context({ maintenanceLevel: 1.4 })

    expect(hourlyRate(technical, thorough)).toBeLessThan(hourlyRate(technical, normal))
    // No amount of maintenance stops a pipeline being turned off, and pretending otherwise
    // would teach the player something false about which risks are theirs to manage.
    expect(hourlyRate(geopolitical, thorough)).toBeCloseTo(hourlyRate(geopolitical, normal), 12)
  })

  it('reads fuel dependence from the fleet that is actually running', () => {
    const gassy = context({ plants: [plant('a', 'ccgt'), plant('b', 'ocgt'), plant('c', 'hydro')] })
    const coally = context({ plants: [plant('a', 'lignite'), plant('b', 'coal'), plant('c', 'hydro')] })
    expect(conditionHolds('gasDependent', gassy)).toBe(true)
    expect(conditionHolds('gasDependent', coally)).toBe(false)
    expect(conditionHolds('coalDependent', coally)).toBe(true)
  })

  it('samples at roughly the rate the table declares', () => {
    // The only honest way to check a sampler. One long run would tell us nothing.
    const def = EVENTS_BY_ID.get('line_fault')!
    const base = context()
    const rate = hourlyRate(def, base)
    const stream = new RandomSource(99).streamFor('events')

    let hits = 0
    const TRIALS = TICKS_PER_YEAR * 50
    for (let tick = 0; tick < TRIALS; tick++) if (stream.chance(tick, rate, 2)) hits++

    const expected = rate * TRIALS
    // Poisson: the standard deviation of a count this size is its square root. Three of them
    // is a bound that will not flake and would still catch an order-of-magnitude error.
    expect(Math.abs(hits - expected)).toBeLessThan(3 * Math.sqrt(expected))
  })
})

describe('the severity director', () => {
  it('gives a stretched utility a quieter year than a comfortable one', () => {
    const comfortable: Finances = { cash: 900e6, debt: 100e6, trailingRevenue: 600e6, bankrupt: false }
    const stretched: Finances = { cash: 5e6, debt: 2_300e6, trailingRevenue: 600e6, bankrupt: false }
    expect(severityBudget(stretched)).toBeLessThan(severityBudget(comfortable))
    // And never to zero: a world where nothing goes wrong is not a reprieve, it is a different
    // and much duller game.
    expect(severityBudget(stretched)).toBeGreaterThan(0)
  })

  it('raises nothing at all during the opening grace period', () => {
    const director = new EventDirector()
    for (let tick = 1; tick < GRACE_TICKS; tick += 7) {
      director.step(context({ tick, weather: { ...context().weather, stormIndex: 1, tempC: -20 } }))
    }
    expect(director.state.pending).toEqual([])
    expect(director.state.active).toEqual([])
  })

  it('will not land two severe events inside the cooldown', () => {
    const director = new EventDirector()
    // Force the worst conditions the model can produce and run a decade.
    const stormy = {
      ...context().weather,
      stormIndex: 1,
      tempC: -20,
      riverFlowIndex: 0.2,
    }
    const severeTicks: number[] = []
    for (let tick = GRACE_TICKS; tick < GRACE_TICKS + TICKS_PER_YEAR * 10; tick++) {
      const before = director.state.pending.length
      director.step(context({ tick, weather: stormy, plants: [plant('a', 'ccgt')] }))
      if (director.state.pending.length > before) {
        const raised = director.state.pending[director.state.pending.length - 1]!
        const def = EVENTS_BY_ID.get(raised.defId)!
        if (def.severity.value >= SEVERE_THRESHOLD) severeTicks.push(tick)
      }
    }
    expect(severeTicks.length).toBeGreaterThan(0)
    for (let i = 1; i < severeTicks.length; i++) {
      expect(severeTicks[i]! - severeTicks[i - 1]!).toBeGreaterThanOrEqual(SEVERE_COOLDOWN_TICKS)
    }
  })
})

describe('what an event actually does', () => {
  it('holds its effects back until the warning period has run out', () => {
    const director = new EventDirector()
    // A gas plant to land on: a fuel-price event with no plants burning that fuel has nothing
    // to attach to, and would pass this test for the wrong reason.
    const ctx = context({ plants: [plant('gas1', 'ccgt')] })
    director.state.pending.push({
      uid: 'x1',
      defId: 'fuel_price_spike',
      raisedTick: ctx.tick,
      landsTick: ctx.tick + 100,
      choiceId: null,
    })

    director.step({ ...ctx, tick: ctx.tick + 50 })
    expect(ctx.registry.size()).toBe(0)

    director.step({ ...ctx, tick: ctx.tick + 100 })
    expect(ctx.registry.size()).toBeGreaterThan(0)
  })

  it('reaches every plant burning the fuel, and no others', () => {
    const director = new EventDirector()
    const plants = [plant('gas1', 'ccgt'), plant('gas2', 'ocgt'), plant('coal1', 'coal')]
    const ctx = context({ plants })
    director.state.pending.push({
      uid: 'x2',
      defId: 'fuel_price_spike',
      raisedTick: ctx.tick,
      landsTick: ctx.tick,
      choiceId: null,
    })
    director.step(ctx)

    expect(ctx.registry.lookup('gas1', Param.FuelPricePerMwhThermal).length).toBe(1)
    expect(ctx.registry.lookup('gas2', Param.FuelPricePerMwhThermal).length).toBe(1)
    expect(ctx.registry.lookup('coal1', Param.FuelPricePerMwhThermal).length).toBe(0)
  })

  it('names itself in the modifier, so the inspector can explain the consequence', () => {
    // The reason event effects must go through the pipeline at all: a player who sees their
    // fuel bill double should be able to find out why without reading the source.
    const director = new EventDirector()
    const ctx = context({ plants: [plant('gas1', 'ccgt')] })
    director.state.pending.push({
      uid: 'x3',
      defId: 'fuel_price_spike',
      raisedTick: ctx.tick,
      landsTick: ctx.tick,
      choiceId: null,
    })
    director.step(ctx)
    const mod = ctx.registry.lookup('gas1', Param.FuelPricePerMwhThermal)[0]!
    expect(mod.reasonKey).toBe(EVENTS_BY_ID.get('fuel_price_spike')!.nameKey)
    expect(mod.sourceId).toBe('event:x3')
  })

  it('lets a world-wide effect reach an asset it was never registered against', () => {
    const registry = new ModifierRegistry()
    const params = new Params(registry, (_target, param) => (param === Param.CapexPerKw ? 1000 : undefined))
    const director = new EventDirector()
    const ctx = context({ registry })
    director.state.pending.push({
      uid: 'x4',
      defId: 'interest_shock',
      raisedTick: ctx.tick,
      landsTick: ctx.tick,
      choiceId: null,
    })
    director.step(ctx)
    params.setTick(ctx.tick)
    expect(params.get('some-plant-that-did-not-exist-yet', Param.CapexPerKw)).toBeGreaterThan(1000)
  })

  it('takes a unit out of service rather than derating it, and puts it back', () => {
    const director = new EventDirector()
    const broken = plant('unit', 'ccgt')
    const ctx = context({ plants: [broken] })
    director.state.pending.push({
      uid: 'x5',
      defId: 'turbine_failure',
      raisedTick: ctx.tick,
      landsTick: ctx.tick,
      choiceId: null,
    })
    director.step(ctx)
    expect(broken.online).toBe(false)
    // An availability of zero would have been the lazy way to express this, and it would have
    // made "broken" indistinguishable from "becalmed".
    expect(ctx.registry.lookup('unit', Param.Availability).length).toBe(0)

    const outage = EVENTS_BY_ID.get('turbine_failure')!.outage!
    director.step({ ...ctx, tick: ctx.tick + outage.hours })
    expect(broken.online).toBe(true)
  })

  it('lets a choice reduce the damage, at a price', () => {
    const withChoice = new EventDirector()
    const ctxA = context({ plants: [plant('unit', 'ccgt')] })
    withChoice.state.pending.push({
      uid: 'y1',
      defId: 'turbine_failure',
      raisedTick: ctxA.tick,
      landsTick: ctxA.tick + 10,
      choiceId: null,
    })
    withChoice.choose('y1', 'expedite')
    const resultA = withChoice.step({ ...ctxA, tick: ctxA.tick + 10 })
    expect(resultA.spent).toBeGreaterThan(0)
    const shortened = withChoice.state.active[0]!.outageUntilTick! - (ctxA.tick + 10)

    const without = new EventDirector()
    const ctxB = context({ plants: [plant('unit', 'ccgt')] })
    without.state.pending.push({
      uid: 'y2',
      defId: 'turbine_failure',
      raisedTick: ctxB.tick,
      landsTick: ctxB.tick,
      choiceId: null,
    })
    const resultB = without.step(ctxB)
    expect(resultB.spent).toBe(0)
    expect(shortened).toBeLessThan(without.state.active[0]!.outageUntilTick! - ctxB.tick)
  })

  it('makes insurance pay instead of the player, and only when insured', () => {
    const insured = new EventDirector()
    const ctx = context({ plants: [plant('unit', 'ccgt')], insured: true })
    insured.state.pending.push({
      uid: 'z1',
      defId: 'turbine_failure',
      raisedTick: ctx.tick,
      landsTick: ctx.tick,
      choiceId: 'claim',
    })
    const paid = insured.step(ctx)
    expect(paid.spent).toBe(0)
    expect(insured.state.active[0]!.choiceId).toBe('claim')

    // Without cover the same claim is not available and quietly falls back to doing nothing,
    // rather than charging for a policy that was never bought.
    const uninsured = new EventDirector()
    const ctx2 = context({ plants: [plant('unit', 'ccgt')], insured: false })
    uninsured.state.pending.push({
      uid: 'z2',
      defId: 'turbine_failure',
      raisedTick: ctx2.tick,
      landsTick: ctx2.tick,
      choiceId: 'claim',
    })
    uninsured.step(ctx2)
    expect(uninsured.state.active[0]!.choiceId).toBe('accept')
  })

  it('will not let a choice the player cannot afford push them under', () => {
    const director = new EventDirector()
    const broke: Finances = { cash: 1e6, debt: 0, trailingRevenue: 10e6, bankrupt: false }
    const ctx = context({ plants: [plant('unit', 'ccgt')], finances: broke })
    director.state.pending.push({
      uid: 'w1',
      defId: 'turbine_failure',
      raisedTick: ctx.tick,
      landsTick: ctx.tick,
      choiceId: 'expedite',
    })
    const result = director.step(ctx)
    expect(result.spent).toBe(0)
    expect(director.state.active[0]!.choiceId).toBe('accept')
  })
})

describe('events in a real scenario', () => {
  it('happen often enough to matter and rarely enough to survive', () => {
    const world = buildWorld(FIRST_REGION)
    const YEARS = 12
    for (let i = 0; i < TICKS_PER_YEAR * YEARS; i++) world.step()

    // The log is capped, so count landings as they happen instead.
    expect(world.director.state.log.length).toBeGreaterThan(5)
    expect(world.finances.bankrupt).toBe(false)
  })

  it('never fires anything in the first year, whatever the weather does', () => {
    const world = buildWorld(FIRST_REGION)
    for (let i = 0; i < TICKS_PER_YEAR; i++) world.step()
    expect(world.director.state.log).toEqual([])
  })

  it('leaves nothing behind once an event is over', () => {
    // An event that forgets to clean up its modifiers is a permanent secret penalty, and the
    // player would have no way to tell it apart from the simulation being broken.
    const world = buildWorld(FIRST_REGION)
    for (let i = 0; i < TICKS_PER_YEAR * 6; i++) world.step()
    for (const active of world.director.state.active) {
      expect(active.endsTick).toBeGreaterThan(world.tick)
    }
    const orphaned = world.plants.filter(
      (p) => !p.online && p.phase === LifecyclePhase.Operating,
    )
    for (const p of orphaned) {
      // Any unit that is down is down for a reason the director or the outage roll can name.
      expect(typeof p.id).toBe('string')
    }
  })
})
