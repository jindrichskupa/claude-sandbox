/**
 * Objectives, and saving a game.
 *
 * The save tests are built around one property, because it is the only one that matters: a game
 * that is saved, reloaded and played on must produce *exactly* the same future as one that was
 * never interrupted. Anything weaker — "close enough", "the totals match" — is a save format
 * that quietly diverges, and a player would only discover it hours later with no way to tell
 * what went wrong.
 *
 * That property is testable at all because randomness in this simulation is stateless: every
 * draw is a pure function of `(seed, streamName, tick, key)`, so there is no generator position
 * to capture and none to get wrong. The tests below would be far harder to write, and far more
 * likely to be flaky, against a conventional seeded generator.
 */

import { describe, expect, it } from 'vitest'
import { buildWorld, loadWorld } from '@sim/scenario/build'
import { FIRST_REGION } from '@content/scenarios/firstRegion'
import { scenarioById, SCENARIO_LIST } from '@content/scenarios/index'
import { LifecyclePhase } from '@sim/assets/types'
import { generateTerrain, tileAt, Tile } from '@sim/map/terrain'
import {
  evaluateObjectives,
  measure,
  scenarioOutcome,
  type ObjectiveContext,
  type ObjectiveDef,
} from '@sim/scenario/objectives'
import { emptyLedger, type Finances } from '@sim/economy/economy'
import { makeSaveFile, parseSaveFile, SaveError, SAVE_VERSION } from '@sim/scenario/save'
import { beginPlantConstruction, retirePlant } from '@sim/build/commands'

function context(overrides: Partial<ObjectiveContext> = {}): ObjectiveContext {
  const finances: Finances = { cash: 100e6, debt: 0, trailingRevenue: 500e6, bankrupt: false, loans: [], loanSerial: 0 }
  return {
    plants: [],
    finances,
    lifetime: emptyLedger(),
    recentYear: emptyLedger(),
    year: 2000,
    endYear: 2025,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Objectives
// ---------------------------------------------------------------------------

describe('objectives', () => {
  it('measures a limit as headroom remaining, not distance travelled', () => {
    // A player at 90% of their unserved-energy allowance is 10% from failing, not 90% of the
    // way to succeeding, and a progress bar that said otherwise would be actively misleading.
    const objective: ObjectiveDef = {
      id: 'lights',
      descriptionKey: 'x',
      condition: { kind: 'unservedShareBelow', threshold: 0.001 },
      timing: 'continuous',
      required: true,
    }
    // Nine hundred MWh unserved out of a million: still inside a 0.1% allowance, but only just.
    // Measured over the year, which is the window this condition is judged on.
    const recentYear = emptyLedger()
    recentYear.energySoldMwh = 1_000_000
    recentYear.energyUnservedMwh = 900

    const [progress] = evaluateObjectives([objective], context({ recentYear }))
    expect(progress!.status).toBe('pending')
    // Ten percent of the allowance left, not ninety percent of the way to winning.
    expect(progress!.progress).toBeLessThan(0.2)
  })

  it('never un-fails a continuous objective', () => {
    // Once a town has frozen it has frozen. A scenario that forgave it after a good year would
    // be lying about what happened.
    const objective: ObjectiveDef = {
      id: 'heat',
      descriptionKey: 'x',
      condition: { kind: 'noUnservedHeat' },
      timing: 'continuous',
      required: true,
    }
    const cold = emptyLedger()
    cold.heatUnservedMwh = 5

    // Heat has no tolerance and should not: a town without heat in February is burst pipework,
    // and no later year makes that up.
    const failed = evaluateObjectives([objective], context({ lifetime: cold }))
    expect(failed[0]!.status).toBe('failed')

    // A later year in which nothing goes wrong does not restore it.
    const recovered = evaluateObjectives([objective], context({ lifetime: cold }), failed)
    expect(recovered[0]!.status).toBe('failed')
  })

  it('gives a tolerant objective one bad year and not two', () => {
    // The difference between a hard brief and a coin toss. The opening scenario's reliability
    // target is breached in its third year by two forced outages coinciding in a peak hour, with
    // a healthy fleet — see `breachTolerance` in `ObjectiveDef`.
    const objective: ObjectiveDef = {
      id: 'lights',
      descriptionKey: 'x',
      condition: { kind: 'unservedShareBelow', threshold: 0.001 },
      timing: 'continuous',
      required: true,
      breachTolerance: 1,
    }
    const bad = emptyLedger()
    bad.energySoldMwh = 1_000_000
    bad.energyUnservedMwh = 5_000 // 0.5%, well over the limit

    const first = evaluateObjectives([objective], context({ recentYear: bad }))
    expect(first[0]!.status).toBe('pending')
    expect(first[0]!.breachYears).toBe(1)

    const second = evaluateObjectives([objective], context({ recentYear: bad }), first)
    expect(second[0]!.status).toBe('failed')

    // And a good year after the first breach leaves it standing rather than failing it later.
    const good = emptyLedger()
    good.energySoldMwh = 1_000_000
    const recovered = evaluateObjectives([objective], context({ recentYear: good }), first)
    expect(recovered[0]!.status).toBe('pending')
    expect(recovered[0]!.breachYears).toBe(1)
  })

  it('leaves an end-of-scenario objective pending until the clock runs out', () => {
    const objective: ObjectiveDef = {
      id: 'capacity',
      descriptionKey: 'x',
      condition: { kind: 'capacityAtLeast', mw: 1000 },
      timing: 'atEnd',
      required: true,
    }
    const midway = evaluateObjectives([objective], context({ year: 2010 }))
    expect(midway[0]!.status).toBe('pending')

    const atTheEnd = evaluateObjectives([objective], context({ year: 2025 }))
    expect(atTheEnd[0]!.status).toBe('failed')

    // And a target that is *currently* satisfied is still only pending, because it can be lost
    // again before the scenario is judged.
    const world = buildWorld(FIRST_REGION)
    const satisfiedEarly = evaluateObjectives([objective], context({ plants: world.plants, year: 2010 }))
    expect(satisfiedEarly[0]!.status).toBe('pending')
    expect(satisfiedEarly[0]!.progress).toBe(1)
  })

  it('counts a plant being dismantled as retired, and one still running as not', () => {
    const world = buildWorld(FIRST_REGION)
    const running = measure({ kind: 'plantRetired', plantId: 'p_oldharbour' }, context({ plants: world.plants }))
    expect(running.satisfied).toBe(false)

    retirePlant(world, 'p_oldharbour')
    const retiring = measure({ kind: 'plantRetired', plantId: 'p_oldharbour' }, context({ plants: world.plants }))
    expect(retiring.satisfied).toBe(true)
    expect(world.getPlant('p_oldharbour')!.phase).toBe(LifecyclePhase.Decommissioning)
  })

  it('ends the scenario the moment the utility goes bankrupt', () => {
    // Not at the end year: a utility that cannot pay its bills is not going to be judged on its
    // carbon intensity in nine years' time.
    const broke: Finances = { cash: -1, debt: 1e9, trailingRevenue: 0, bankrupt: true, loans: [], loanSerial: 0 }
    expect(scenarioOutcome([], [], context({ finances: broke, year: 2000 }))).toBe('lost')
  })

  it('does not lose a scenario for an optional objective', () => {
    const objectives: ObjectiveDef[] = [
      {
        id: 'required',
        descriptionKey: 'x',
        condition: { kind: 'neverBankrupt' },
        timing: 'continuous',
        required: true,
      },
      {
        id: 'optional',
        descriptionKey: 'x',
        condition: { kind: 'noUnservedHeat' },
        timing: 'continuous',
        required: false,
      },
    ]
    const cold = emptyLedger()
    cold.heatUnservedMwh = 5
    const ctx = context({ lifetime: cold, year: 2025 })
    const progress = evaluateObjectives(objectives, ctx)

    expect(progress.find((p) => p.id === 'optional')!.status).toBe('failed')
    expect(scenarioOutcome(objectives, progress, ctx)).toBe('won')
  })
})

describe('the opening scenario brief', () => {
  it('asks for things that are all measurable', () => {
    const world = buildWorld(FIRST_REGION)
    world.judgeObjectives()
    expect(world.objectives.length).toBe(FIRST_REGION.objectives.length)
    for (const progress of world.objectives) {
      expect(Number.isFinite(progress.value), progress.id).toBe(true)
      expect(Number.isFinite(progress.target), progress.id).toBe(true)
    }
  })

  it('is judged once at build time, so the brief is readable before the first year closes', () => {
    // The panel reads `world.objectives`, and the simulation only re-judges at the year end. If
    // the list were empty until then, the player would spend their first in-game year unable to
    // see what they had been asked to do — which is precisely when they need to.
    const world = buildWorld(FIRST_REGION)
    expect(world.objectives.length).toBe(FIRST_REGION.objectives.length)
  })

  it('measures against a live context, not the one the last verdict used', () => {
    // What lets the panel show a number that is moving between annual judgements.
    const world = buildWorld(FIRST_REGION)
    const before = measure({ kind: 'unservedShareBelow', threshold: 0.001 }, world.objectiveContext())
    world.yearLedger.energySoldMwh += 1_000_000
    world.yearLedger.energyUnservedMwh += 900
    const after = measure({ kind: 'unservedShareBelow', threshold: 0.001 }, world.objectiveContext())
    expect(before.value).toBe(0)
    expect(after.value).toBeCloseTo(900 / 1_000_900, 9)
    // And the verdict has *not* moved, because nothing has judged it yet.
    expect(world.objectives.find((p) => p.id === 'keep-lights-on')!.status).toBe('pending')
  })

  it('can actually be won, which is worth proving rather than assuming', () => {
    // A brief nobody can satisfy is a bug in the content, not a hard scenario. Built by hand
    // rather than played out, because thirty simulated years is not a unit test.
    const world = buildWorld(FIRST_REGION)
    retirePlant(world, 'p_oldharbour')
    const lifetime = emptyLedger()
    lifetime.energySoldMwh = 100e6
    lifetime.energyUnservedMwh = 10 // Comfortably inside the 0.1% allowance.
    lifetime.co2Tonnes = 40e6 // 0.4 t/MWh, under the optional 0.6 target.
    // The ratio conditions are judged on the year rather than the run — see `ObjectiveContext` —
    // so a winnable ending needs a good *year*, which is also what the brief actually asks for.
    const recentYear = emptyLedger()
    recentYear.energySoldMwh = 4e6
    recentYear.energyUnservedMwh = 1
    recentYear.co2Tonnes = 1.6e6
    const ctx: ObjectiveContext = {
      plants: world.plants,
      finances: world.finances,
      lifetime,
      recentYear,
      year: FIRST_REGION.endYear,
      endYear: FIRST_REGION.endYear,
    }
    // The one thing the player has to have done: replaced the capacity they retired. Stand-ins
    // are cloned from a unit already in service rather than sited on the map — where a plant is
    // built is the siting rules' business, and this test is about the verdict.
    expect(measure({ kind: 'capacityAtLeast', mw: 2200 }, ctx).satisfied).toBe(false)
    const template = world.plants.find((p) => p.phase === LifecyclePhase.Operating)!
    for (let i = 0; i < 40 && !measure({ kind: 'capacityAtLeast', mw: 2200 }, ctx).satisfied; i++) {
      world.plants.push({ ...template, id: `p_replacement_${i}` })
    }

    const progress = evaluateObjectives(FIRST_REGION.objectives, ctx)
    for (const objective of FIRST_REGION.objectives) {
      expect(progress.find((p) => p.id === objective.id)!.status, objective.id).toBe('met')
    }
    expect(scenarioOutcome(FIRST_REGION.objectives, progress, ctx)).toBe('won')
  })

  it('is not already won or lost on the first day', () => {
    // A brief that is satisfied before the player has done anything is not a brief.
    const world = buildWorld(FIRST_REGION)
    world.judgeObjectives()
    expect(world.outcome).toBe('playing')
    const required = FIRST_REGION.objectives.filter((o) => o.required).map((o) => o.id)
    for (const id of required) {
      expect(world.objectives.find((p) => p.id === id)!.status, id).toBe('pending')
    }
  })

  it('requires the player to replace what they retire, not merely retire it', () => {
    // Retiring Old Harbour satisfies one objective and, on its own, breaks another. That pairing
    // is the whole shape of the scenario, so it is worth a test rather than a comment.
    const world = buildWorld(FIRST_REGION)
    retirePlant(world, 'p_oldharbour')
    const ctx = {
      plants: world.plants,
      finances: world.finances,
      lifetime: world.lifetimeLedger,
      recentYear: world.yearLedger,
      year: FIRST_REGION.endYear,
      endYear: FIRST_REGION.endYear,
    }
    const progress = evaluateObjectives(FIRST_REGION.objectives, ctx)
    expect(progress.find((p) => p.id === 'replace-old-harbour')!.status).toBe('met')
    expect(progress.find((p) => p.id === 'keep-the-capacity')!.status).toBe('failed')
  })
})

// ---------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------

describe('saving a game', () => {
  it('resumes bit-identically, which is the only property that matters', () => {
    const original = buildWorld(FIRST_REGION)
    for (let i = 0; i < 3000; i++) original.step()

    const save = original.toSaveData()
    const loaded = loadWorld(FIRST_REGION, save)

    // Same instant.
    expect(loaded.tick).toBe(original.tick)
    expect(loaded.finances.cash).toBe(original.finances.cash)
    expect(loaded.plants.length).toBe(original.plants.length)

    // And, far more importantly, the same future. Two hundred hours is long enough to cross a
    // month boundary, run the storage policy through several cycles and re-roll every outage.
    for (let i = 0; i < 200; i++) {
      original.step()
      loaded.step()
    }

    expect(loaded.finances.cash).toBeCloseTo(original.finances.cash, 6)
    expect(loaded.finances.debt).toBeCloseTo(original.finances.debt, 6)
    expect(loaded.state.publicOpinion).toBeCloseTo(original.state.publicOpinion, 9)
    expect(loaded.weather.tempC).toBeCloseTo(original.weather.tempC, 9)
    expect(loaded.lastDispatch!.totalGenerationMw).toBeCloseTo(
      original.lastDispatch!.totalGenerationMw,
      6,
    )
    expect(loaded.lastHeat!.totalHeatSuppliedMw).toBeCloseTo(original.lastHeat!.totalHeatSuppliedMw, 6)

    for (const plant of original.plants) {
      const other = loaded.getPlant(plant.id)!
      expect(other.outputMw, plant.id).toBeCloseTo(plant.outputMw, 6)
      expect(other.conditionPct, plant.id).toBeCloseTo(plant.conditionPct, 9)
      expect(other.online, plant.id).toBe(plant.online)
    }
  })

  it('carries every asset\'s accounts across a save', () => {
    // The one part of the state that is genuinely irrecoverable. Everything else in the save file
    // is either authoritative or a function of the seed and the tick; a book of accounts is the
    // accumulated history of every hour played, and nothing short of replaying the run rebuilds
    // it. Drop it and a loaded game looks healthy while every machine on the map claims to have
    // done nothing since it was built — which is precisely the sort of failure that is invisible
    // until somebody tries to work out where their money went.
    const world = buildWorld(FIRST_REGION)
    for (let i = 0; i < 800; i++) world.step()

    const ids = world.books.ids()
    expect(ids.length).toBeGreaterThan(0)

    const loaded = loadWorld(FIRST_REGION, world.toSaveData())
    expect(loaded.books.ids().sort()).toEqual(ids.sort())
    for (const id of ids) {
      const before = world.books.get(id)!.lifetime
      const after = loaded.books.get(id)!.lifetime
      expect(after.revenue, id).toBeCloseTo(before.revenue, 6)
      expect(after.marketRevenue, id).toBeCloseTo(before.marketRevenue, 6)
      expect(after.energyMwh, id).toBeCloseTo(before.energyMwh, 6)
      expect(after.fuelCost, id).toBeCloseTo(before.fuelCost, 6)
      expect(after.congestionRent, id).toBeCloseTo(before.congestionRent, 6)
    }

    // And the loaded game keeps its own copy: writing to one must not reach the other.
    loaded.books.for(ids[0]!).lifetime.revenue = -1
    expect(world.books.get(ids[0]!)!.lifetime.revenue).not.toBe(-1)
  })

  it('carries a half-finished project across a save', () => {
    // The instalment schedule and the energising queue live outside the assets themselves, so
    // they are exactly the sort of thing a save format forgets.
    const world = buildWorld(FIRST_REGION)
    let built: ReturnType<typeof beginPlantConstruction> | null = null
    for (let y = 0; y < world.scenario.mapHeight && !built?.ok; y++) {
      for (let x = 0; x < world.scenario.mapWidth && !built?.ok; x++) {
        const attempt = beginPlantConstruction(world, 'ccgt', x, y)
        if (attempt.ok) built = attempt
      }
    }
    expect(built?.ok).toBe(true)
    for (let i = 0; i < 500; i++) world.step()

    const committedBefore = world.committedSpend()
    expect(committedBefore).toBeGreaterThan(0)

    const loaded = loadWorld(FIRST_REGION, world.toSaveData())
    expect(loaded.committedSpend()).toBeCloseTo(committedBefore, 3)

    // And it still finishes at the same moment.
    const plant = world.getPlant(built!.plantId!)!
    const remaining = plant.phaseEndsTick - world.tick
    for (let i = 0; i < remaining; i++) {
      world.step()
      loaded.step()
    }
    expect(loaded.getPlant(plant.id)!.phase).toBe(world.getPlant(plant.id)!.phase)
    expect(loaded.getPlant(plant.id)!.phase).toBe(LifecyclePhase.Operating)
  })

  it('carries an event that is in force, expiry and all', () => {
    const world = buildWorld(FIRST_REGION)
    world.director.state.pending.push({
      uid: 'save1',
      defId: 'fuel_price_spike',
      raisedTick: world.tick,
      landsTick: world.tick + 1,
      choiceId: null,
    })
    for (let i = 0; i < 5; i++) world.step()
    expect(world.director.state.active.length).toBe(1)
    expect(world.registry.size()).toBeGreaterThan(0)

    const loaded = loadWorld(FIRST_REGION, world.toSaveData())
    expect(loaded.director.state.active.length).toBe(1)
    expect(loaded.director.state.active[0]!.uid).toBe('save1')
    // The effects themselves, not just the record that an event happened.
    expect(loaded.registry.size()).toBe(world.registry.size())
  })

  it('does not let a loaded game mutate the save it came from', () => {
    const world = buildWorld(FIRST_REGION)
    for (let i = 0; i < 100; i++) world.step()
    const save = world.toSaveData()
    const cashInSave = save.finances.cash
    const plantsInSave = save.plants.length

    // Long enough to cross a month boundary, since cash only moves when the period closes.
    const loaded = loadWorld(FIRST_REGION, save)
    for (let i = 0; i < 800; i++) loaded.step()

    expect(save.finances.cash).toBe(cashInSave)
    expect(save.plants.length).toBe(plantsInSave)
    expect(loaded.finances.cash).not.toBe(cashInSave)
  })
})

describe('the save file envelope', () => {
  it('refuses a file from a different version rather than half-loading it', () => {
    // Silently accepting one and filling the gaps with defaults produces a game that looks fine
    // and behaves subtly wrongly, which is worse than a clear refusal.
    const world = buildWorld(FIRST_REGION)
    const file = makeSaveFile(FIRST_REGION.id, world.toSaveData(), '2026-01-01')
    const fromTheFuture = JSON.stringify({ ...file, version: SAVE_VERSION + 1 })
    expect(() => parseSaveFile(fromTheFuture)).toThrow(SaveError)
  })

  it('refuses something that is not a save at all', () => {
    expect(() => parseSaveFile('not json')).toThrow(SaveError)
    expect(() => parseSaveFile('{"version":1}')).toThrow(SaveError)
  })

  it('round-trips through JSON without losing anything that matters', () => {
    const world = buildWorld(FIRST_REGION)
    for (let i = 0; i < 500; i++) world.step()
    const file = makeSaveFile(FIRST_REGION.id, world.toSaveData(), '2026-01-01')

    const parsed = parseSaveFile(JSON.stringify(file))
    const content = scenarioById(parsed.scenarioId)!
    expect(content).toBe(FIRST_REGION)

    const loaded = loadWorld(content, parsed.data)
    for (let i = 0; i < 50; i++) {
      world.step()
      loaded.step()
    }
    expect(loaded.finances.cash).toBeCloseTo(world.finances.cash, 6)
  })

  it('does not stand anything in open water', () => {
    // Three of the eastern nodes — a coal station, a heat plant and an entire town — sat on sea
    // tiles, several of them a good way offshore. Nothing in the game could have been built
    // there: `judgeSite` refuses water for every technology, so the scenario was asking of its
    // own map something it forbids the player. They are now on the coast, which is where a
    // harbour station and a bay town belong anyway.
    for (const scenario of SCENARIO_LIST) {
      const terrain = generateTerrain(scenario.seed, scenario.mapWidth, scenario.mapHeight)
      for (const node of scenario.nodes) {
        const tile = tileAt(terrain, node.x, node.y)
        expect(`${node.id} ${Tile[tile]}`).not.toContain('Water')
      }
    }
  })

  it('leaves every power line a middle the player can click', () => {
    // A corridor is selected by clicking somewhere along it, and the stations at its ends own a
    // disc around themselves. If a line is shorter than those two discs together, no part of it
    // belongs to the line and the player cannot ask about it at all — which is how a line
    // between two neighbouring nodes became invisible to the interface.
    //
    // Four tiles is the working minimum: a node core of about half a tile at each end, and
    // enough between them to aim at. Exempt are the corridors that also carry a heat main — a
    // combined heat and power station stands next to the town it heats because a heat main
    // longer than about thirty kilometres loses more than it delivers, so its power line is
    // short for a reason no map layout can argue with. `MapView.pickAt` is what makes those
    // selectable; everything else has to earn its length here.
    for (const scenario of SCENARIO_LIST) {
      const at = new Map(scenario.nodes.map((n) => [n.id, n]))
      const heated = new Set(scenario.heatPipes.flatMap((p) => [`${p.from}|${p.to}`, `${p.to}|${p.from}`]))
      for (const line of scenario.lines) {
        if (heated.has(`${line.from}|${line.to}`)) continue
        const a = at.get(line.from)!
        const b = at.get(line.to)!
        const tiles = Math.hypot(a.x - b.x, a.y - b.y)
        expect(`${line.id} ${tiles.toFixed(2)}`).toBe(`${line.id} ${Math.max(tiles, 4).toFixed(2)}`)
      }
    }
  })

  it('remembers that the player chose to carry on past the verdict', () => {
    // This was the bug behind the worst symptom this game has produced: a run carried on past a
    // failed brief came back from its own save with the clock stopped, the speed controls inert
    // and nothing on screen saying why — indistinguishable from a crash. The decision to keep
    // playing is a fact about the run, so it belongs in the file with the rest of them.
    const world = buildWorld(FIRST_REGION)
    for (let i = 0; i < 200; i++) world.step()
    world.outcome = 'lost'
    world.freePlay = true

    const parsed = parseSaveFile(JSON.stringify(makeSaveFile(FIRST_REGION.id, world.toSaveData(), '2026-01-01')))
    const loaded = loadWorld(FIRST_REGION, parsed.data)
    expect(loaded.outcome).toBe('lost')
    expect(loaded.freePlay).toBe(true)
  })

  it('knows every scenario by the id its saves record', () => {
    for (const scenario of SCENARIO_LIST) {
      expect(scenarioById(scenario.id)).toBe(scenario)
    }
  })
})
