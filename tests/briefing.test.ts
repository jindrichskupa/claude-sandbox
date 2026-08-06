/**
 * The opening brief, and the line that says what is about to go wrong.
 *
 * The property worth guarding is not what the brief *says* — that is measured from the world and
 * changes with the content, which is the point of it. It is that the brief is measured at all:
 * every line has to be a fact about this run, so a balance change cannot leave the game telling a
 * new player something that stopped being true a year ago.
 *
 * And the concern has to be quiet when there is nothing wrong. An interface that always has a
 * warning on it has no warnings at all, and a "needs attention" line that is permanently lit is
 * worse than none, because it trains the player to stop reading exactly the thing that will one
 * day matter.
 */

import { describe, expect, it } from 'vitest'
import { buildWorld } from '@sim/scenario/build'
import { FIRST_REGION } from '@content/scenarios/firstRegion'
import { TICKS_PER_YEAR } from '@sim/core/time'
import { LifecyclePhase } from '@sim/assets/types'
import { availableFirmMw, nextConcern, openingBrief } from '@sim/scenario/briefing'
import en from '@i18n/en.json'

describe('the opening brief', () => {
  it('describes this run rather than quoting prose about it', () => {
    const world = buildWorld(FIRST_REGION)
    world.step()
    const lines = openingBrief(world)

    expect(lines.length).toBeGreaterThanOrEqual(4)
    for (const line of lines) {
      // Every line is a real translation key with every placeholder filled. A brief that renders
      // "{firm} MW" at a new player is worse than no brief.
      const template = (en as Record<string, string>)[line.key]
      expect(template, line.key).toBeTruthy()
      for (const match of template!.matchAll(/\{(\w+)\}/g)) {
        expect(Object.keys(line.params), `${line.key} needs ${match[1]}`).toContain(match[1])
      }
    }

    // The two numbers a player most needs, and they have to be the *measured* ones: firm capacity
    // as the dispatch will see it, against demand this run actually has.
    const fleet = lines.find((l) => l.key === 'brief.fleet')!
    expect(Number(fleet.params.firm)).toBeCloseTo(Math.round(availableFirmMw(world)), 0)
    expect(Number(fleet.params.demand)).toBeGreaterThan(0)

    // And the scenario's own deadline, not a number written into the brief.
    const deadline = lines.find((l) => l.key === 'brief.deadline')!
    expect(deadline.params.year).toBe(FIRST_REGION.endYear)
  })

  it('names the station the scenario is actually about', () => {
    // Old Harbour opens 41 years into a 45-year life, and retiring it is the one decision the
    // whole starting position is built around. If the brief does not mention it, the brief is
    // describing some other scenario.
    const world = buildWorld(FIRST_REGION)
    world.step()
    const ageing = openingBrief(world).find((l) => l.key === 'brief.ageing' || l.key === 'brief.overdue')
    expect(ageing).toBeTruthy()
    expect(String(ageing!.params.plant)).toContain('Old Harbour')
  })
})

describe('what needs attention', () => {
  it('opens by naming the one thing this scenario is about', () => {
    // Written expecting silence on the first screen, and the run said otherwise — correctly.
    // Old Harbour opens four years from the end of a forty-five-year life with nothing being
    // built, and a replacement takes forty-eight months. That is not noise on the first screen;
    // it is the scenario, and a new player being told it in one sentence is the whole of what
    // the first ten minutes were missing.
    const world = buildWorld(FIRST_REGION)
    for (let i = 0; i < 24; i++) world.step()

    const concern = nextConcern(world)
    expect(concern).toBeTruthy()
    expect(['concern.endOfLife', 'concern.pastLife']).toContain(concern!.key)
    expect(String(concern!.params.plant)).toContain('Old Harbour')
    // Pointable, so the interface can take the player to it rather than describing where to look.
    expect(concern!.subjectKind).toBe('plant')
    expect(world.getPlant(concern!.subjectId!)).toBeTruthy()
  })

  it('goes quiet once the player has answered it', () => {
    // The concern is "nothing is being done about this", not "this plant is old" — and when the
    // answer is under way it says nothing at all rather than moving on to nag about something
    // else. An interface that always has a warning on it has no warnings: a line that is
    // permanently lit trains the player to stop reading the one that will matter in year twelve.
    const world = buildWorld(FIRST_REGION)
    for (let i = 0; i < 24; i++) world.step()
    expect(nextConcern(world)?.key).toMatch(/concern\.(endOfLife|pastLife)/)

    const replacement = world.plants[0]!
    const was = replacement.phase
    replacement.phase = LifecyclePhase.Building
    expect(nextConcern(world)).toBeNull()
    replacement.phase = was
  })

  it('raises a fleet that will not cover the peak, once one has been seen', () => {
    // The second concern in the order, and the one a nameplate-counting planner never notices.
    const world = buildWorld(FIRST_REGION)
    for (let i = 0; i < TICKS_PER_YEAR; i++) world.step()

    // Mothball most of the fleet, and start something so the end-of-life concern stands aside.
    world.plants[0]!.phase = LifecyclePhase.Building
    for (const plant of world.plants.slice(1)) {
      if (plant.phase === LifecyclePhase.Operating) plant.phase = LifecyclePhase.Mothballed
    }
    expect(availableFirmMw(world)).toBe(0)
    expect(nextConcern(world)?.key).toBe('concern.thinMargin')
  }, 300_000)
})
