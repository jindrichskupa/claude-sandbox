/**
 * Playing the scenario, rather than assembling its ending by hand.
 *
 * ## What this found, and what it does not yet assert
 *
 * The honest result of writing this is: **a reasonably competent scripted player loses.** It
 * holds a reserve margin over peak demand, retires plant at end of life *and* when it is
 * persistently loss-making, and builds the cheapest firm capacity it can site — and it goes
 * bankrupt around 2010, having failed to keep the lights on along the way.
 *
 * That is a real finding and it is why this file exists. But it is emphatically *not* proof that
 * the scenario is unwinnable, and this test does not claim so, because the player is still naive
 * in four ways that all point the same direction: it never builds heat plant, so the heat
 * objective fails by construction; it never takes a support contract into account when choosing;
 * it never refurbishes, though that is far cheaper than building new; and it has no view on debt
 * beyond whether a project is affordable this month.
 *
 * So this asserts what it can defend — that the scenario is *playable*, that the harness's
 * decisions actually reach the simulation, and that nothing breaks over a long run of building
 * and retiring — and it prints the diagnosis. Asserting `won` here would be asserting something
 * false; asserting `lost` would freeze a balance problem into a passing test.
 *
 * The next step is not to tune numbers until this passes. That would be fitting the game to a
 * crude bot. It is per-asset accounting, so that "which of these plants is losing the money?"
 * has an answer — at the moment the run shows cash falling and nothing about where it went.
 */

import { describe, expect, it } from 'vitest'
import { buildWorld } from '@sim/scenario/build'
import { FIRST_REGION } from '@content/scenarios/firstRegion'
import { playScenario } from './autoPlayer'

describe('the opening scenario, played', () => {
  it('is playable for thirty years, and reports how far a simple strategy gets', () => {
    const world = buildWorld(FIRST_REGION)
    const trace: string[] = []
    const result = playScenario(world, { onYear: (line) => trace.push(line) })

    for (const line of trace) console.log(line)
    console.log('outcome:', result.outcome, 'in', result.year)
    console.log('built:', result.built)
    console.log('retired:', result.retired)
    console.log('unserved', (result.unservedShare * 100).toFixed(3) + '%')
    console.log('objectives:', result.objectives)

    // Neither building nor retiring is asserted, and that is itself the finding. With a reserve
    // margin held over the inherited fleet, this player has ample capacity all the way through —
    // 2530 MW firm against a 1549 MW peak — so it never needs to build and never dares to close
    // anything. And it still loses, with 2.6% of demand unserved.
    //
    // That conclusion was drawn once and was wrong, and the correction is worth keeping. It
    // compared *nameplate* firm capacity against peak demand and concluded the corridor must be
    // what binds. Measuring instead what was actually available in each failing hour —
    // `scripts/paceProbe.ts` — splits the shortfall 96.8% "not enough plant" against 3.2%
    // "behind a constraint". The corridor is real and it is not what fails first; what fails
    // first is a fleet whose availability has decayed and, since the wear-out model, whose units
    // start failing beyond repair. A harness that only asks "have I got enough megawatts on the
    // nameplate?" answers yes every year and watches the lights go out anyway — which is still
    // the finding, for a different reason than the one first written here.
    //
    // What is asserted is only that when it does choose, it chooses on cost rather than on a
    // technology named here.
    //
    // Checked against the *number* rather than the unit it is printed in. The first version
    // matched the string "/MWh", which meant it was really asserting a log format: when the
    // harness stopped ranking on cost per megawatt-hour and started ranking on cost per firm
    // kilowatt-year — the same claim, correctly measured — this test failed while nothing it
    // describes had changed.
    for (const line of result.built) {
      expect(line).toMatch(/ at -?\d+\//)
    }

    // A long run of building, retiring and dispatching without the model falling over: the
    // solver never gives up, the clock always advances, and the run ends in a decided state.
    expect(['won', 'lost']).toContain(result.outcome)
    expect(result.year).toBeGreaterThan(FIRST_REGION.startYear)
    expect(world.lastDispatch?.aborted).toBeFalsy()
  }, 900_000)

  it('carries a competent player past the first five years at least', () => {
    // A floor on the balance, set well below where it currently sits so it is a regression guard
    // rather than a restatement of today's number. A scenario that bankrupted a competent player
    // almost immediately would be broken beyond argument; one that carries them into the 2000s is
    // merely hard, and *how* hard is the open question this file cannot yet answer.
    const world = buildWorld(FIRST_REGION)
    const result = playScenario(world, { untilYear: 2001 })
    console.log('by 2001:', {
      outcome: result.outcome,
      bankrupt: world.finances.bankrupt,
      cash: Math.round(result.cash / 1e6) + 'm',
      unserved: (result.unservedShare * 100).toFixed(3) + '%',
      objectives: result.objectives.filter((o) => o.status === 'failed'),
    })
    expect(world.finances.bankrupt).toBe(false)
  }, 900_000)
})
