/**
 * The modifier pipeline.
 *
 * The stacking rule is the part most likely to be got wrong quietly, so it is tested
 * directly: additive within a layer, multiplicative across layers.
 */

import { describe, expect, it } from 'vitest'
import { ModifierRegistry, frac } from '@sim/params/ModifierRegistry'
import { Params } from '@sim/params/Params'
import { Layer, Op, Param } from '@sim/params/types'

function setup(base: number, param: Param = Param.Availability) {
  const registry = new ModifierRegistry()
  const params = new Params(registry, (_id, p) => (p === param ? base : undefined))
  params.setTick(1)
  return { registry, params }
}

describe('modifier stacking', () => {
  it('returns the base value when nothing applies', () => {
    const { params } = setup(0.8)
    expect(params.get('x', Param.Availability)).toBeCloseTo(0.8, 9)
  })

  it('adds fractions within a layer rather than multiplying them', () => {
    const { registry, params } = setup(1)
    registry.setSource('age', [
      { targetId: 'x', mod: frac(Layer.Age, Param.Availability, -0.1, 'age', 'age', 'r1') },
      { targetId: 'x', mod: frac(Layer.Age, Param.Availability, -0.1, 'age', 'age', 'r2') },
    ])
    // Two 10% penalties in the same layer are a 20% penalty, not 19%.
    expect(params.get('x', Param.Availability)).toBeCloseTo(0.8, 9)
  })

  it('multiplies across layers', () => {
    const { registry, params } = setup(1)
    registry.setSource('age', [
      { targetId: 'x', mod: frac(Layer.Age, Param.Availability, -0.5, 'age', 'age', 'r1') },
    ])
    registry.setSource('weather', [
      { targetId: 'x', mod: frac(Layer.Weather, Param.Availability, -0.5, 'weather', 'weather', 'r2') },
    ])
    // 0.5 of what age left, which was 0.5 of the base.
    expect(params.get('x', Param.Availability)).toBeCloseTo(0.25, 9)
  })

  it('applies layers in the declared order regardless of registration order', () => {
    const build = (registerWeatherFirst: boolean) => {
      const { registry, params } = setup(100, Param.DemandMw)
      const weather = {
        targetId: 'x',
        mod: {
          layer: Layer.Weather,
          param: Param.DemandMw,
          op: Op.AddAbs,
          value: 10,
          sourceKind: 'weather' as const,
          sourceId: 'w',
          reasonKey: 'w',
        },
      }
      const policy = {
        targetId: 'x',
        mod: frac(Layer.Policy, Param.DemandMw, 0.5, 'policy', 'p', 'p'),
      }
      if (registerWeatherFirst) {
        registry.setSource('w', [weather])
        registry.setSource('p', [policy])
      } else {
        registry.setSource('p', [policy])
        registry.setSource('w', [weather])
      }
      return params.get('x', Param.DemandMw)
    }
    // Weather runs before policy, so it is (100 + 10) * 1.5 either way.
    expect(build(true)).toBeCloseTo(165, 9)
    expect(build(false)).toBeCloseTo(165, 9)
  })

  it('clamps to the parameter bounds', () => {
    const { registry, params } = setup(1)
    registry.setSource('event', [
      { targetId: 'x', mod: frac(Layer.Event, Param.Availability, -3, 'event', 'e', 'r') },
    ])
    expect(params.get('x', Param.Availability)).toBe(0)
  })

  it('drops modifiers once they expire', () => {
    const { registry, params } = setup(1)
    registry.setSource('event', [
      {
        targetId: 'x',
        mod: { ...frac(Layer.Event, Param.Availability, -0.5, 'event', 'e', 'r'), expiresTick: 10 },
      },
    ])
    expect(params.get('x', Param.Availability)).toBeCloseTo(0.5, 9)

    params.setTick(11)
    registry.pruneExpired(11)
    expect(params.get('x', Param.Availability)).toBeCloseTo(1, 9)
  })
})

describe('explain', () => {
  it('produces a chain whose final value matches get()', () => {
    const { registry, params } = setup(1)
    registry.setSource('age', [
      { targetId: 'x', mod: frac(Layer.Age, Param.Availability, -0.2, 'age', 'age', 'reason.wearAvailability') },
    ])
    registry.setSource('weather', [
      { targetId: 'x', mod: frac(Layer.Weather, Param.Availability, -0.1, 'weather', 'weather', 'reason.hotAir') },
    ])

    const e = params.explain('x', Param.Availability)
    expect(e.baseValue).toBeCloseTo(1, 9)
    expect(e.steps).toHaveLength(2)
    expect(e.finalValue).toBeCloseTo(params.get('x', Param.Availability), 9)
    // The chain must be readable in order, ending at the effective value.
    expect(e.steps[e.steps.length - 1]!.runningValue).toBeCloseTo(e.finalValue, 9)
  })

  it('carries a reason key for every step so nothing is unexplained', () => {
    const { registry, params } = setup(1)
    registry.setSource('weather', [
      { targetId: 'x', mod: frac(Layer.Weather, Param.Availability, -0.1, 'weather', 'weather', 'reason.hotAir') },
    ])
    for (const step of params.explain('x', Param.Availability).steps) {
      expect(step.reasonKey.length).toBeGreaterThan(0)
    }
  })
})
