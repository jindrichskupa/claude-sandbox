/**
 * District heating and cogeneration.
 *
 * The tests that matter here are the ones about the *coupling*. A heat network on its own is
 * an easy problem; what makes cogeneration worth simulating is that the two commodities
 * constrain each other, and that is where a plausible-looking implementation can be quietly
 * wrong. So the checks below concentrate on the joins: that a backpressure unit really does
 * take the electrical dispatch's choice away, that the fuel accounting agrees with the prices
 * the merit order used, and that heat cannot appear from nowhere.
 */

import { describe, expect, it } from 'vitest'
import { HEAT_PIPE_TYPES } from '@content/heatPipeTypes'
import { PLANT_TYPES, type PlantTypeId } from '@content/plantTypes'
import { FUELS } from '@content/fuels'
import { buildWorld } from '@sim/scenario/build'
import { FIRST_REGION } from '@content/scenarios/firstRegion'
import { LifecyclePhase, isHeatDispatchable, type CityAsset, type PlantAsset } from '@sim/assets/types'
import { Network, PLAYER, type GridEdge } from '@sim/grid/network'
import { computeIslands } from '@sim/grid/islands'
import { ModifierRegistry } from '@sim/params/ModifierRegistry'
import { Params } from '@sim/params/Params'
import { Param } from '@sim/params/types'
import { availableRange } from '@sim/dispatch/dispatch'
import { dispatchHeat, heatCeilingMw, heatMarginalCostPerMwh, settleHeatStore } from '@sim/heat/heat'
import { thermalInputMwh, emptyLedger, chargeGeneration } from '@sim/economy/economy'
import { TICKS_PER_YEAR } from '@sim/core/time'

// --- A minimal hand-built heat system -------------------------------------

function plant(id: string, nodeId: string, typeId: PlantTypeId): PlantAsset {
  return {
    id,
    ownerId: PLAYER,
    typeId,
    nodeId,
    phase: LifecyclePhase.Operating,
    phaseEndsTick: Number.MAX_SAFE_INTEGER,
    commissionedTick: 0,
    designLifeYears: PLANT_TYPES[typeId].designLifeYears.value,
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

function city(id: string, nodeId: string, heatMw: number): CityAsset {
  return {
    id,
    nodeId,
    name: id,
    population: 100,
  startingPopulation: 100,
  rooftopSolarMw: 0,
    baseDemandMw: 0,
    baseHeatDemandMwth: heatMw,
    satisfaction: 1,
    unservedTicksRecent: 0,
  }
}

function pipe(id: string, from: string, to: string, dn: 200 | 400 | 700, lengthKm: number): GridEdge {
  return {
    id,
    commodity: 'heat',
    ownerId: PLAYER,
    from,
    to,
    kv: 0,
    dn,
    lengthKm,
    circuits: 1,
    energised: true,
    builtTick: 0,
    conditionPct: 1,
  }
}

/** A plant site and a town, joined by one main. */
function fixture(sources: Array<{ id: string; typeId: PlantTypeId }>, heatDemandMw: number, lengthKm = 10) {
  const network = new Network()
  network.addNode({ id: 'site', kind: 'plant', ownerId: PLAYER, x: 0, y: 0 })
  network.addNode({ id: 'town', kind: 'city', ownerId: PLAYER, x: 1, y: 0 })
  network.addEdge(pipe('main', 'site', 'town', 700, lengthKm))

  const plants = sources.map((s) => plant(s.id, 'site', s.typeId))
  const cities = [city('town', 'town', heatDemandMw)]

  const registry = new ModifierRegistry()
  const params = new Params(registry, (targetId, param) => {
    const p = plants.find((x) => x.id === targetId)
    if (p) {
      const type = PLANT_TYPES[p.typeId]
      switch (param) {
        case Param.CapacityMw:
          return type.capacityMw.value
        case Param.Efficiency:
          return type.efficiency.value
        case Param.Availability:
          return 1
        case Param.VarOpexPerMwh:
          return type.varOpexPerMwh.value
        case Param.FuelPricePerMwhThermal:
          return FUELS[type.fuel].pricePerMwhThermal.value
        case Param.RampRatePerHour:
          return type.rampRatePerHour.value
        default:
          return undefined
      }
    }
    if (targetId === 'town' && param === Param.HeatDemandMw) return heatDemandMw
    return undefined
  })

  return {
    network,
    plants,
    cities,
    params,
    islands: computeIslands(network, 'heat'),
    solve: (electricityPricePerMwh = 60) =>
      dispatchHeat({
        network,
        islands: computeIslands(network, 'heat'),
        plants,
        cities,
        params,
        carbonPrice: 0,
        electricityPricePerMwh,
      }),
  }
}

describe('heat networks', () => {
  it('loses the same heat whether the main is busy or idle', () => {
    // The defining difference from an electric line, and the reason heat plants must stand
    // next to the towns they serve.
    const busy = fixture([{ id: 'chp', typeId: 'gas_chp' }], 120)
    const quiet = fixture([{ id: 'chp', typeId: 'gas_chp' }], 10)

    const perKm = HEAT_PIPE_TYPES[700].standingLossMwPerKm.value
    expect(busy.solve().totalHeatLossMw).toBeCloseTo(perKm * 10, 6)
    expect(quiet.solve().totalHeatLossMw).toBeCloseTo(perKm * 10, 6)
  })

  it('cannot push more heat down a main than it will carry', () => {
    const small = fixture([{ id: 'chp', typeId: 'gas_chp' }], 120)
    // Swap the trunk main for the smallest distribution pipe: 40 MW where 120 is wanted.
    small.network.removeEdge('main')
    small.network.addEdge(pipe('main', 'site', 'town', 200, 10))

    const result = small.solve()
    expect(result.totalUnservedHeatMw).toBeGreaterThan(70)
    expect(Math.abs(result.pipeFlowMw.get('main') ?? 0)).toBeLessThanOrEqual(
      HEAT_PIPE_TYPES[200].capacityMwth.value + 1e-6,
    )
  })

  it('never counts a town with no pipe to it as unserved: it heats itself', () => {
    const f = fixture([{ id: 'chp', typeId: 'gas_chp' }], 100)
    f.network.removeEdge('main')
    const result = f.solve()
    expect(result.totalUnservedHeatMw).toBe(0)
    expect(result.totalHeatDemandMw).toBe(0)
  })

  it('serves heat from cogeneration before lighting a boiler', () => {
    const f = fixture(
      [
        { id: 'chp', typeId: 'gas_chp' },
        { id: 'boiler', typeId: 'heat_boiler' },
      ],
      // More than the cogeneration unit alone can carry, so the merit order has to reach past
      // it. With demand below its rating the boiler would simply stay off and prove nothing.
      200,
    )
    const result = f.solve()
    // The extraction unit's heat costs a fraction of the boiler's, so it runs flat out and the
    // boiler picks up only what is left over — including the main's standing loss.
    expect(result.heatMw.get('chp')).toBeCloseTo(PLANT_TYPES.gas_chp.chp!.heatCapacityMwth.value, 3)
    expect(result.heatMw.get('boiler')!).toBeGreaterThan(0)
    expect(result.totalUnservedHeatMw).toBe(0)
  })
})

describe('the electricity–heat coupling', () => {
  it('takes the dispatch\'s choice away from a backpressure unit', () => {
    const f = fixture([{ id: 'chp', typeId: 'coal_chp' }], 150)
    const result = f.solve()
    const commitment = result.commitments.get('chp')!
    expect(commitment.mode).toBe('backpressure')

    const cm = PLANT_TYPES.coal_chp.chp!.powerPerHeat.value
    expect(commitment.forcedOutputMw).toBeCloseTo(commitment.heatMw * cm, 6)

    // And the electrical dispatch has nothing left to decide: floor and ceiling coincide.
    const range = availableRange(f.plants[0]!, f.params, commitment)
    expect(range.floor).toBeCloseTo(range.ceiling, 9)
    expect(range.floor).toBeCloseTo(commitment.forcedOutputMw!, 6)
  })

  it('costs an extraction unit electrical capacity, but not its freedom', () => {
    const f = fixture([{ id: 'chp', typeId: 'gas_chp' }], 100)
    const result = f.solve()
    const commitment = result.commitments.get('chp')!
    expect(commitment.mode).toBe('extraction')
    expect(commitment.forcedOutputMw).toBeNull()

    const cv = PLANT_TYPES.gas_chp.chp!.powerLossPerHeat.value
    expect(commitment.capacityDerateMw).toBeCloseTo(commitment.heatMw * cv, 6)

    // Start the unit already at full load. Otherwise the ramp rate sets the ceiling in both
    // cases and the derating this test is about would be invisible.
    f.plants[0]!.outputMw = PLANT_TYPES.gas_chp.capacityMw.value
    const withHeat = availableRange(f.plants[0]!, f.params, commitment)
    const withoutHeat = availableRange(f.plants[0]!, f.params)
    expect(withHeat.ceiling).toBeLessThan(withoutHeat.ceiling)
    expect(withoutHeat.ceiling - withHeat.ceiling).toBeCloseTo(commitment.capacityDerateMw, 6)
    // Still free to choose anything up to that ceiling.
    expect(withHeat.floor).toBeLessThan(withHeat.ceiling)
  })

  it('never lets a unit promise more heat than its machine could support', () => {
    // A backpressure set making Q must also place cm·Q of electricity. Its heat is therefore
    // capped by its own generator, not only by the heat rating on the datasheet.
    const f = fixture([{ id: 'chp', typeId: 'coal_chp' }], 1000)
    const ceiling = heatCeilingMw(f.plants[0]!, f.params)
    const spec = PLANT_TYPES.coal_chp.chp!
    const electricalMax = PLANT_TYPES.coal_chp.capacityMw.value
    expect(ceiling).toBeLessThanOrEqual(spec.heatCapacityMwth.value + 1e-9)
    expect(ceiling * spec.powerPerHeat.value).toBeLessThanOrEqual(electricalMax + 1e-6)
  })
})

describe('cogeneration accounting', () => {
  /**
   * The consistency check that matters most.
   *
   * A plant's heat is priced one way in the merit order and its fuel is billed another way in
   * the ledger. If those two disagree, the simulation will happily run a plant that loses money
   * on every megawatt-hour and report a profit, or the reverse — and nothing else in the test
   * suite would notice. So: take a real hour of operation, add one megawatt-hour of heat, and
   * check that the extra fuel actually billed matches the marginal cost that was quoted.
   */
  const marginalFuelCostOfOneMoreMwhOfHeat = (
    p: PlantAsset,
    params: Params,
    electricMwh: number,
    heatMwh: number,
  ): number => {
    const fuel = FUELS[PLANT_TYPES[p.typeId].fuel]
    const before = thermalInputMwh(p, electricMwh, heatMwh, params)
    const after = thermalInputMwh(p, electricMwh, heatMwh + 1, params)
    return (after - before) * fuel.pricePerMwhThermal.value
  }

  it('bills a boiler exactly what its heat was quoted at', () => {
    const f = fixture([{ id: 'boiler', typeId: 'heat_boiler' }], 50)
    const p = f.plants[0]!
    const quoted = heatMarginalCostPerMwh(p, f.params, 0, 60)
    const billed = marginalFuelCostOfOneMoreMwhOfHeat(p, f.params, 0, 40)
    const varOpex = f.params.get(p.id, Param.VarOpexPerMwh)
    expect(billed + varOpex).toBeCloseTo(quoted, 6)
  })

  it('bills a backpressure unit for the electricity that comes with the heat', () => {
    const f = fixture([{ id: 'chp', typeId: 'coal_chp' }], 150)
    const p = f.plants[0]!
    const spec = PLANT_TYPES.coal_chp.chp!
    const price = 70
    const quoted = heatMarginalCostPerMwh(p, f.params, 0, price)

    // One more MWh of heat drags cm MWh of electricity along with it, by definition.
    const heat = 100
    const electric = heat * spec.powerPerHeat.value
    const before = thermalInputMwh(p, electric, heat, f.params)
    const after = thermalInputMwh(p, electric + spec.powerPerHeat.value, heat + 1, f.params)
    const extraFuel = (after - before) * FUELS.coal.pricePerMwhThermal.value
    const varOpex = f.params.get(p.id, Param.VarOpexPerMwh)
    const extraRevenue = spec.powerPerHeat.value * price

    expect(extraFuel + varOpex - extraRevenue).toBeCloseTo(quoted, 6)
  })

  it('prices extraction heat as the electricity it displaces, and bills the same', () => {
    const f = fixture([{ id: 'chp', typeId: 'gas_chp' }], 100)
    const p = f.plants[0]!
    const spec = PLANT_TYPES.gas_chp.chp!

    // Bleeding steam does not change the fuel input; it moves output from the turbine to the
    // town. Holding the equivalent electrical output constant must hold the fuel constant too.
    const a = thermalInputMwh(p, 200, 0, f.params)
    const b = thermalInputMwh(p, 200 - 50 * spec.powerLossPerHeat.value, 50, f.params)
    expect(b).toBeCloseTo(a, 6)

    const quoted = heatMarginalCostPerMwh(p, f.params, 0, 90)
    expect(quoted).toBeCloseTo(spec.powerLossPerHeat.value * 90 + PLANT_TYPES.gas_chp.varOpexPerMwh.value, 6)
  })

  it('charges a cogeneration unit once for both commodities', () => {
    const f = fixture([{ id: 'chp', typeId: 'coal_chp' }], 150)
    const p = f.plants[0]!
    const both = emptyLedger()
    chargeGeneration(both, p, 45, f.params, 0, 100)
    const electricOnly = emptyLedger()
    chargeGeneration(electricOnly, p, 45, f.params, 0, 0)
    // The heat is not free: it is most of what the fuel is buying.
    expect(both.fuelCost).toBeGreaterThan(electricOnly.fuelCost * 2)
    expect(both.co2Tonnes).toBeGreaterThan(electricOnly.co2Tonnes)
  })
})

describe('the heat accumulator', () => {
  it('is a tank, not a source: it can only give back what was put in', () => {
    const store = plant('tank', 'site', 'heat_accumulator')
    const capacity = PLANT_TYPES.heat_accumulator.heatOnly!.storageMwhth!.value
    store.heatStoredMwhth = capacity / 2

    const before = store.heatStoredMwhth
    settleHeatStore(store, 60)
    expect(store.heatStoredMwhth).toBeLessThan(before - 60)

    store.heatStoredMwhth = 0
    settleHeatStore(store, 40)
    expect(store.heatStoredMwhth).toBe(0)
  })

  it('credits only the heat actually delivered into it', () => {
    // The same failure that got past the tests for the electrical battery the first time
    // round: crediting a *planned* charge that the solver then curtailed creates energy.
    const store = plant('tank', 'site', 'heat_accumulator')
    settleHeatStore(store, 0)
    expect(store.heatStoredMwhth).toBe(0)
  })

  it('cools down whether or not anybody uses it', () => {
    const store = plant('tank', 'site', 'heat_accumulator')
    store.heatStoredMwhth = 1000
    for (let i = 0; i < 24; i++) settleHeatStore(store, 0)
    expect(store.heatStoredMwhth).toBeLessThan(1000)
    expect(store.heatStoredMwhth).toBeGreaterThan(900)
  })
})

describe('the opening scenario', () => {
  it('inherits a heat system that works, with a real weakness rather than an impossible one', () => {
    const world = buildWorld(FIRST_REGION)
    let coldHours = 0
    let heatDemand = 0
    let heatUnserved = 0
    const N = TICKS_PER_YEAR
    for (let i = 0; i < N; i++) {
      world.step()
      const h = world.lastHeat!
      heatDemand += h.totalHeatDemandMw
      heatUnserved += h.totalUnservedHeatMw
      if (h.totalUnservedHeatMw > 0.01) coldHours++
    }
    // A starting position that cannot keep the towns warm would be broken rather than hard.
    // A starting position that never falters would have nothing to teach. Both bounds matter.
    expect(coldHours).toBeLessThan(N * 0.005)
    expect(heatUnserved / heatDemand).toBeLessThan(0.005)
    expect(world.finances.bankrupt).toBe(false)
  })

  it('runs the inherited backpressure unit because the town is cold, not because the market asked', () => {
    const world = buildWorld(FIRST_REGION)
    const ironworks = world.plants.find((p) => p.id === 'p_ironworks')!
    expect(PLANT_TYPES[ironworks.typeId].chp?.mode).toBe('backpressure')

    let winterOutput = 0
    let winterN = 0
    let summerOutput = 0
    let summerN = 0
    for (let i = 0; i < TICKS_PER_YEAR; i++) {
      const snap = world.step()
      if (snap.date.month === 0) {
        winterOutput += ironworks.outputMw
        winterN++
      } else if (snap.date.month === 6) {
        summerOutput += ironworks.outputMw
        summerN++
      }
    }
    // Its electrical output follows the outdoor temperature, which is not something any
    // ordinary generator does. That is the whole point of putting it on the map.
    expect(winterOutput / winterN).toBeGreaterThan((summerOutput / summerN) * 2)
  })

  it('keeps every heat plant near the town it heats', () => {
    const world = buildWorld(FIRST_REGION)
    for (const p of world.plants) {
      if (!isHeatDispatchable(p)) continue
      const node = world.network.requireNode(p.nodeId)
      const nearest = Math.min(
        ...world.cities.map((c) => {
          const cn = world.network.requireNode(c.nodeId)
          return Math.hypot(cn.x - node.x, cn.y - node.y)
        }),
      )
      expect(nearest, p.id).toBeLessThanOrEqual(3)
    }
  })
})
