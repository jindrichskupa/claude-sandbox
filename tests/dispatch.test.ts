/**
 * Dispatch correctness.
 *
 * These are the tests that matter most: if the flow solver is wrong, every number the
 * player ever sees is wrong, and it will look plausible while being wrong.
 */

import { describe, expect, it } from 'vitest'
import { Network, PLAYER, type GridEdge, type GridNode } from '@sim/grid/network'
import { computeIslands } from '@sim/grid/islands'
import { dispatch } from '@sim/dispatch/dispatch'
import { ModifierRegistry } from '@sim/params/ModifierRegistry'
import { Params } from '@sim/params/Params'
import { Param } from '@sim/params/types'
import { LifecyclePhase, type CityAsset, type PlantAsset } from '@sim/assets/types'
import { PLANT_TYPES } from '@content/plantTypes'
import { LINE_TYPES } from '@content/lineTypes'
import type { PlantTypeId } from '@content/plantTypes'

function node(id: string, kind: GridNode['kind'], x = 0, y = 0): GridNode {
  return { id, kind, ownerId: PLAYER, x, y }
}

function edge(id: string, from: string, to: string, kv: 110 | 220 | 400, lengthKm: number, circuits = 1): GridEdge {
  return { id, commodity: 'electric', ownerId: PLAYER, from, to, kv, lengthKm, circuits, energised: true, builtTick: 0 }
}

function plant(id: string, nodeId: string, typeId: PlantTypeId): PlantAsset {
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

/** A params instance backed directly by content, with no modifiers. */
function makeParams(
  plants: PlantAsset[],
  cities: CityAsset[],
  network: Network,
  subsidies?: Map<string, number>,
): Params {
  const registry = new ModifierRegistry()
  const byId = new Map(plants.map((p) => [p.id, p]))
  const cityById = new Map(cities.map((c) => [c.id, c]))
  return new Params(registry, (targetId, param) => {
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
        case Param.FeedInTariffPerMwh:
          return subsidies?.get(targetId) ?? 0
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

function run(network: Network, plants: PlantAsset[], cities: CityAsset[], subsidies?: Map<string, number>) {
  const params = makeParams(plants, cities, network, subsidies)
  params.setTick(1)
  return dispatch({
    network,
    islands: computeIslands(network, 'electric'),
    plants,
    cities,
    params,
    carbonPrice: 0,
  })
}

describe('dispatch', () => {
  it('serves demand from a directly connected plant', () => {
    const n = new Network()
    n.addNode(node('gen', 'plant'))
    n.addNode(node('town', 'city'))
    n.addEdge(edge('l1', 'gen', 'town', 220, 10))

    const plants = [plant('p1', 'gen', 'ccgt')]
    const cities = [city('c1', 'town', 200)]
    const r = run(n, plants, cities)

    expect(r.totalUnservedMw).toBeCloseTo(0, 6)
    expect(r.generationMw.get('p1')!).toBeGreaterThan(199)
    expect(r.servedMw.get('c1')!).toBeCloseTo(200, 3)
  })

  it('conserves power: generation equals demand plus losses', () => {
    const n = new Network()
    n.addNode(node('gen', 'plant'))
    n.addNode(node('town', 'city'))
    n.addEdge(edge('l1', 'gen', 'town', 220, 120))

    const plants = [plant('p1', 'gen', 'ccgt')]
    const cities = [city('c1', 'town', 300)]
    const r = run(n, plants, cities)

    const generated = r.generationMw.get('p1')!
    const served = r.servedMw.get('c1')!
    // The solver charges losses to the endpoints, so generation must cover demand plus them.
    expect(generated).toBeGreaterThan(served)
    expect(generated - served).toBeCloseTo(r.totalLossMw, 1)
  })

  it('dispatches in merit order: the cheaper unit runs first', () => {
    const n = new Network()
    n.addNode(node('gen', 'plant'))
    n.addNode(node('town', 'city'))
    n.addEdge(edge('l1', 'gen', 'town', 400, 5))

    // Same fuel price for both, so efficiency alone decides. CCGT at 58% beats OCGT at 38%.
    const plants = [plant('cheap', 'gen', 'ccgt'), plant('dear', 'gen', 'ocgt')]
    const cities = [city('c1', 'town', 300)]
    const r = run(n, plants, cities)

    expect(r.generationMw.get('cheap')!).toBeGreaterThan(290)
    expect(r.generationMw.get('dear')!).toBeLessThan(15)
  })

  it('respects line capacity and falls back to the expensive local unit', () => {
    // 450 MW of cheap gas behind a 150 MW line, plus an expensive peaker next to the load.
    const n = new Network()
    n.addNode(node('far', 'plant'))
    n.addNode(node('town', 'city'))
    n.addNode(node('near', 'plant'))
    n.addEdge(edge('thin', 'far', 'town', 110, 50))
    n.addEdge(edge('short', 'near', 'town', 400, 2))

    const plants = [plant('cheap_far', 'far', 'ccgt'), plant('dear_near', 'near', 'ocgt')]
    const cities = [city('c1', 'town', 260)]
    const r = run(n, plants, cities)

    const overThin = Math.abs(r.lineFlowMw.get('thin')!)
    expect(overThin).toBeLessThanOrEqual(LINE_TYPES[110].capacityMw.value + 1e-6)
    // The rest has to come from the expensive unit, because the wire will not carry it.
    expect(r.generationMw.get('dear_near')!).toBeGreaterThan(100)
    expect(r.totalUnservedMw).toBeCloseTo(0, 3)
  })

  it('reports unserved demand when an island has no generation', () => {
    const n = new Network()
    n.addNode(node('gen', 'plant'))
    n.addNode(node('town', 'city'))
    n.addNode(node('island', 'city', 30, 30))
    n.addEdge(edge('l1', 'gen', 'town', 220, 10))

    const plants = [plant('p1', 'gen', 'ccgt')]
    const cities = [city('c1', 'town', 100), city('c2', 'island', 50)]
    const r = run(n, plants, cities)

    expect(r.unservedMw.get('c1')!).toBeCloseTo(0, 3)
    expect(r.unservedMw.get('c2')!).toBeCloseTo(50, 3)
  })

  it('prices congestion: the constrained side is dearer than the cheap side', () => {
    const n = new Network()
    n.addNode(node('far', 'plant'))
    n.addNode(node('town', 'city'))
    n.addNode(node('near', 'plant'))
    n.addEdge(edge('thin', 'far', 'town', 110, 50))
    n.addEdge(edge('short', 'near', 'town', 400, 2))

    const plants = [plant('cheap_far', 'far', 'ccgt'), plant('dear_near', 'near', 'ocgt')]
    const cities = [city('c1', 'town', 260)]
    const r = run(n, plants, cities)

    const priceFar = r.nodalPrice.get('far')!
    const priceTown = r.nodalPrice.get('town')!
    // With the corridor full, one more MW at the load must come from the expensive unit.
    expect(priceTown).toBeGreaterThan(priceFar + 5)
  })

  it('loses more over a long line than a short one', () => {
    const build = (lengthKm: number) => {
      const n = new Network()
      n.addNode(node('gen', 'plant'))
      n.addNode(node('town', 'city'))
      n.addEdge(edge('l1', 'gen', 'town', 220, lengthKm))
      return run(n, [plant('p1', 'gen', 'ccgt')], [city('c1', 'town', 300)])
    }
    expect(build(200).totalLossMw).toBeGreaterThan(build(20).totalLossMw * 5)
  })

  it('loses less at higher voltage over the same distance', () => {
    const build = (kv: 110 | 220 | 400) => {
      const n = new Network()
      n.addNode(node('gen', 'plant'))
      n.addNode(node('town', 'city'))
      n.addEdge(edge('l1', 'gen', 'town', kv, 100))
      return run(n, [plant('p1', 'gen', 'ccgt')], [city('c1', 'town', 140)])
    }
    expect(build(400).totalLossMw).toBeLessThan(build(110).totalLossMw)
  })
})

describe('negative prices', () => {
  /**
   * A generator on a guaranteed tariff is paid whether or not the market wants its output,
   * so being curtailed costs it the tariff. It will therefore bid below zero to stay on, and
   * when there is more such generation than demand it sets a negative clearing price. This is
   * routine in real markets with subsidised renewables, and the flow solver has to cope with
   * it despite shortest-path costing requiring non-negative arcs.
   */
  it('clears below zero when subsidised generation exceeds demand', () => {
    const n = new Network()
    n.addNode(node('farm', 'plant'))
    n.addNode(node('town', 'city', 1, 0))
    n.addEdge(edge('l1', 'farm', 'town', 400, 2))

    // 450 MW of gas, guaranteed 80/MWh, against 100 MW of demand.
    const plants = [plant('subsidised', 'farm', 'ccgt')]
    const cities = [city('c1', 'town', 100)]
    const subsidies = new Map([['subsidised', 80]])

    const r = run(n, plants, cities, subsidies)
    expect(r.totalUnservedMw).toBeCloseTo(0, 3)
    expect(r.nodalPrice.get('town')!).toBeLessThan(0)
  })

  it('still dispatches correctly when bids are negative', () => {
    const n = new Network()
    n.addNode(node('farm', 'plant'))
    n.addNode(node('gas', 'plant', 0, 1))
    n.addNode(node('town', 'city', 1, 0))
    n.addEdge(edge('l1', 'farm', 'town', 400, 2))
    n.addEdge(edge('l2', 'gas', 'town', 400, 2))

    // The subsidised unit should run first even though its unsubsidised cost is identical.
    const plants = [plant('subsidised', 'farm', 'ccgt'), plant('plain', 'gas', 'ccgt')]
    const cities = [city('c1', 'town', 300)]
    const r = run(n, plants, cities, new Map([['subsidised', 80]]))

    expect(r.generationMw.get('subsidised')!).toBeGreaterThan(290)
    expect(r.generationMw.get('plain')!).toBeLessThan(15)
    expect(r.totalUnservedMw).toBeCloseTo(0, 3)
  })

  it('keeps prices positive when nothing is subsidised', () => {
    const n = new Network()
    n.addNode(node('gen', 'plant'))
    n.addNode(node('town', 'city', 1, 0))
    n.addEdge(edge('l1', 'gen', 'town', 400, 2))
    const r = run(n, [plant('p1', 'gen', 'ccgt')], [city('c1', 'town', 200)])
    expect(r.nodalPrice.get('town')!).toBeGreaterThan(0)
  })
})
