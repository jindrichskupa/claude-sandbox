/**
 * Storage.
 *
 * The first test here is the important one. Before this milestone a battery placed in a
 * scenario would have dispatched as an infinite generator at €1.50/MWh — perpetual, free,
 * never depleting — because the solver never looked at its state of charge. That is the kind
 * of bug that looks entirely plausible on screen, so it gets an explicit test.
 */

import { describe, expect, it } from 'vitest'
import { Network, PLAYER, type GridEdge, type GridNode } from '@sim/grid/network'
import { computeIslands } from '@sim/grid/islands'
import { dispatch } from '@sim/dispatch/dispatch'
import { ModifierRegistry } from '@sim/params/ModifierRegistry'
import { Params } from '@sim/params/Params'
import { Param } from '@sim/params/types'
import { LifecyclePhase, type CityAsset, type PlantAsset } from '@sim/assets/types'
import { PLANT_TYPES, type PlantTypeId } from '@content/plantTypes'
import { LINE_TYPES } from '@content/lineTypes'
import {
  energyCapacityMwh,
  isStorage,
  onewayEfficiency,
  planStorage,
  settleStorage,
} from '@sim/dispatch/storage'

function node(id: string, kind: GridNode['kind'], x = 0, y = 0): GridNode {
  return { id, kind, ownerId: PLAYER, x, y }
}

function edge(id: string, from: string, to: string): GridEdge {
  return {
    id,
    commodity: 'electric',
    ownerId: PLAYER,
    from,
    to,
    kv: 400,
    lengthKm: 2,
    circuits: 1,
    energised: true,
    builtTick: 0,
  }
}

function plant(id: string, nodeId: string, typeId: PlantTypeId, storageMwh = 0): PlantAsset {
  return {
    id,
    ownerId: PLAYER,
    typeId,
    nodeId,
    phase: LifecyclePhase.Operating,
    phaseEndsTick: Number.MAX_SAFE_INTEGER,
    commissionedTick: 0,
    conditionPct: 1,
    cumulativeRunHours: 0,
    cumulativeStarts: 0,
    outputMw: 0,
    storageMwh,
    online: true,
    capexPaid: 0,
  }
}

function city(id: string, nodeId: string, demandMw: number): CityAsset {
  return {
    id,
    nodeId,
    name: id,
    population: 100,
    baseDemandMw: demandMw,
    baseHeatDemandMwth: 0,
    satisfaction: 1,
    unservedTicksRecent: 0,
  }
}

function makeParams(plants: PlantAsset[], cities: CityAsset[], network: Network): Params {
  const byId = new Map(plants.map((p) => [p.id, p]))
  const cityById = new Map(cities.map((c) => [c.id, c]))
  return new Params(new ModifierRegistry(), (targetId, param) => {
    const p = byId.get(targetId)
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
        case Param.RampRatePerHour:
          return 1
        case Param.FuelPricePerMwhThermal:
          return type.fuel === 'none' ? 0 : 30
        default:
          return undefined
      }
    }
    const c = cityById.get(targetId)
    if (c && param === Param.DemandMw) return c.baseDemandMw
    const e = network.getEdge(targetId)
    if (e && param === Param.LineCapacityMw && e.kv !== 0) {
      return LINE_TYPES[e.kv].capacityMw.value * e.circuits
    }
    return undefined
  })
}

/** A battery next to a city, with a generator that may or may not be present. */
function scene(storedMwh: number, withGenerator: boolean) {
  const n = new Network()
  n.addNode(node('site', 'plant'))
  n.addNode(node('town', 'city', 1, 0))
  n.addEdge(edge('l1', 'site', 'town'))

  const plants = [plant('bat', 'site', 'battery', storedMwh)]
  if (withGenerator) plants.push(plant('gen', 'site', 'ccgt'))
  const cities = [city('c1', 'town', 40)]
  const params = makeParams(plants, cities, n)
  params.setTick(1)
  return { network: n, plants, cities, params }
}

function run(s: ReturnType<typeof scene>, priceHistory: number[], recentShortage = false) {
  const plans = planStorage({
    plants: s.plants,
    params: s.params,
    priceHistory,
    recentShortage,
  })
  const result = dispatch({
    network: s.network,
    islands: computeIslands(s.network, 'electric'),
    plants: s.plants,
    cities: s.cities,
    params: s.params,
    carbonPrice: 0,
    storagePlans: plans,
  })
  return { plans, result }
}

/** A price series with a clear cheap/expensive spread, ending on a high price. */
const EXPENSIVE_NOW = [10, 10, 12, 15, 20, 40, 80, 120]
/** The same spread, ending on a low price. */
const CHEAP_NOW = [120, 80, 40, 20, 15, 12, 10, 10]

describe('storage is not a free energy source', () => {
  it('produces nothing when it is empty, however expensive power is', () => {
    const s = scene(0, false)
    const { result } = run(s, EXPENSIVE_NOW)
    expect(result.generationMw.get('bat') ?? 0).toBeCloseTo(0, 6)
    // With nothing else on the system, the city simply goes unserved.
    expect(result.totalUnservedMw).toBeGreaterThan(39)
  })

  it('cannot discharge more energy than it holds', () => {
    // 10 MWh stored in a 50 MW battery: it can only deliver for part of the hour.
    const s = scene(10, false)
    const { result } = run(s, EXPENSIVE_NOW)
    const delivered = result.generationMw.get('bat') ?? 0
    const eta = onewayEfficiency(s.plants[0]!)
    expect(delivered).toBeLessThanOrEqual(10 * eta + 1e-6)
    expect(delivered).toBeGreaterThan(0)
  })

  it('loses energy on the round trip', () => {
    const battery = plant('bat', 'site', 'battery', 0)
    const capacity = energyCapacityMwh(battery)
    const eta = onewayEfficiency(battery)

    // Charge 40 MWh in...
    settleStorage(battery, { plantId: 'bat', mode: 'charging', chargeMw: 40, dischargeCeilingMw: 0, offerPricePerMwh: 0 }, 0)
    const stored = battery.storageMwh
    expect(stored).toBeLessThan(40)
    expect(stored).toBeCloseTo(40 * eta, 6)
    expect(stored).toBeLessThanOrEqual(capacity)

    // ...and take it back out. What comes out is less than what went in.
    const out = stored * eta
    settleStorage(battery, { plantId: 'bat', mode: 'discharging', chargeMw: 0, dischargeCeilingMw: out, offerPricePerMwh: 0 }, out)
    expect(out).toBeLessThan(40)
    expect(out / 40).toBeCloseTo(PLANT_TYPES.battery.storage!.roundTripEfficiency.value, 3)
    expect(battery.storageMwh).toBeCloseTo(0, 6)
  })
})

describe('storage policy', () => {
  it('charges when power is cheap and there is room', () => {
    const s = scene(0, true)
    const { plans } = run(s, CHEAP_NOW)
    expect(plans.get('bat')!.mode).toBe('charging')
  })

  it('discharges when power is expensive and it has something to sell', () => {
    const s = scene(60, true)
    const { plans } = run(s, EXPENSIVE_NOW)
    expect(plans.get('bat')!.mode).toBe('discharging')
  })

  it('refuses to charge during a shortage', () => {
    // Cheap prices would normally mean charge, but the lights just went out somewhere.
    const s = scene(0, true)
    const { plans } = run(s, CHEAP_NOW, true)
    expect(plans.get('bat')!.mode).not.toBe('charging')
  })

  it('does not bother when the spread is too small to cover the round trip', () => {
    const s = scene(60, true)
    const flat = [50, 50, 51, 50, 49, 50, 50, 50]
    const { plans } = run(s, flat)
    expect(plans.get('bat')!.mode).toBe('idle')
  })

  it('gives up a planned charge rather than letting a city go dark', () => {
    // Battery wants to charge, but the only generator cannot cover both it and the city.
    const n = new Network()
    n.addNode(node('site', 'plant'))
    n.addNode(node('town', 'city', 1, 0))
    n.addEdge(edge('l1', 'site', 'town'))

    const small = plant('gen', 'site', 'ocgt')
    const battery = plant('bat', 'site', 'battery', 0)
    const plants = [small, battery]
    // OCGT is 150 MW; demand plus a full 50 MW charge would be 190 MW.
    const cities = [city('c1', 'town', 140)]
    const params = makeParams(plants, cities, n)
    params.setTick(1)

    const plans = planStorage({ plants, params, priceHistory: CHEAP_NOW, recentShortage: false })
    expect(plans.get('bat')!.mode).toBe('charging')

    const result = dispatch({
      network: n,
      islands: computeIslands(n, 'electric'),
      plants,
      cities,
      params,
      carbonPrice: 0,
      storagePlans: plans,
    })

    // The city is served in full; the battery takes only what was left over.
    expect(result.totalUnservedMw).toBeCloseTo(0, 3)
    expect(result.totalStorageChargeMw).toBeLessThan(plans.get('bat')!.chargeMw)
  })
})

describe('storage bookkeeping', () => {
  it('reports charging as consumption, not as generation', () => {
    const s = scene(0, true)
    const { result } = run(s, CHEAP_NOW)
    const batteryMw = result.generationMw.get('bat') ?? 0
    expect(batteryMw).toBeLessThan(0)
    expect(result.totalStorageChargeMw).toBeCloseTo(-batteryMw, 6)
  })

  it('conserves power with storage in the mix', () => {
    for (const history of [CHEAP_NOW, EXPENSIVE_NOW]) {
      const s = scene(60, true)
      const { result } = run(s, history)
      let served = 0
      for (const c of s.cities) served += result.servedMw.get(c.id) ?? 0
      // Generation covers demand, losses, and whatever storage took for itself.
      expect(result.totalGenerationMw).toBeCloseTo(
        served + result.totalLossMw + result.totalStorageChargeMw,
        3,
      )
    }
  })

  it('identifies storage types and only those', () => {
    expect(isStorage(plant('a', 'site', 'battery'))).toBe(true)
    expect(isStorage(plant('b', 'site', 'pumped'))).toBe(true)
    expect(isStorage(plant('c', 'site', 'ccgt'))).toBe(false)
    expect(isStorage(plant('d', 'site', 'hydro'))).toBe(false)
  })
})
