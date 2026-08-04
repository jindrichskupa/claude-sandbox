# Powergrid Tycoon

A power grid simulation game — SimCity or Transport Tycoon, but for the electricity sector.
You inherit an ageing utility, keep the lights on, and rebuild the system before it falls
over underneath you.

## Running it

```bash
npm install
npm run dev        # development server
npm run build      # production build into dist/
npm test           # unit and scenario tests
npm run smoke      # launch the built game in a browser and screenshot it
npm run bundle     # fold everything into one self-contained HTML file
npm run verify:pages  # serve the build under the Pages sub-path and load it in a browser
```

## Playing it

**https://jindrichskupa.github.io/claude-sandbox/**

Pushing to `master` publishes the game to GitHub Pages via `.github/workflows/pages.yml`,
which lints, tests and builds before it deploys. Two separate questions are answered
separately there: the trigger decides which pushes are worth starting a run for, and a job
condition decides which branch may actually publish. The latter asks the repository for its
default branch rather than naming one, so if the default is ever moved again a leftover
`master` cannot go on quietly publishing a stale site.

One failure mode is worth naming because every other signal misses it: a project Pages site
is served under `/<repo>/`, so a build with absolute asset paths compiles cleanly, deploys
cleanly, reports success, and shows a blank page. `npm run check:pages` runs on every deploy
and fails on any absolute reference; `npm run verify:pages` is the thorough local version,
which serves the build under the real prefix and loads it in a browser.

`npm run bundle` produces `dist-single/powergrid-tycoon.html`: the whole game — simulation,
renderer and artwork — in a single document of about 0.6 MB that runs from a `file://` URL
with no network at all. All the artwork is generated at runtime, so there is nothing else to
carry. `scripts/smokeSingle.mjs` opens it with every outbound request blocked and fails if
the document tries to fetch anything.

## What exists today (milestones 1-8)

- **Prices that move, in opposite directions.** Nothing is frozen at the year its source
  published it any more. Inflation carries every figure from its own `sourceYear` to the game's;
  capital cost splits into equipment, labour and civil works, and those three then diverge —
  equipment learns with cumulative deployment worldwide, labour and land escalate above
  inflation, and each technology's installation learns only as fast as it is genuinely
  repeatable. Progress makes a machine more efficient, longer-lived *and* dearer per kilowatt.
  In the 1995 build menu that comes out as nuclear at ↑7% a decade in real terms and solar at
  ↓51%, with nothing about either technology asserted anywhere. See
  [How prices move with time](#how-prices-move-with-time).
- **The regulator does not pay you for your own scarcity.** The tariff is reset each year
  against what the market cleared at — but only over the hours demand was actually met, and
  weighted by the energy delivered rather than by the hour. Both halves were found by measuring
  rather than by reading: an hour that sheds load clears at the value of lost load, so averaging
  those hours in meant a couple of percent of failures set the price charged in all 8760, and
  the utility grew richer the worse it got. Weighting by the hour then biased the result low,
  because load and price are correlated and a summer night is not equal evidence to a December
  evening. With the scarcity hours put back, a crippled fleet's tariff is 22× a healthy one's and
  twelve years end with €151bn in the bank; with them removed it is 1.4×.
- **You can see what a decision costs before you take it.** Hovering a placement shows the
  price, the length, the lead time and the site quality, or the reason it is refused — because
  choosing a corridor is a comparison, and until those were on screen the most expensive decision
  in the game was taken blind. Lines are selectable in their own right, with length, circuits,
  loading and losses as a share of what is flowing; and a corridor that is short of capacity can
  take a **second circuit** on the towers already standing, at 45% of a new line's conductor cost,
  rather than a parallel line drawn on top of the first.
- **A fast-forward that knows what you are waiting for.** Most hours in a working system are
  uneventful by design, and the interesting parts are months apart — so besides the speed tiers
  there is a control that runs the clock on until the world does something: a station enters
  service, a government falls, an event is forewarned, demand starts going unserved. It stops on
  the *hour* the thing happened rather than overshooting it, and says which thing it was. It works
  by taking a signature of everything a player could care about and stopping when that changes,
  rather than asking every system to announce itself — so a system added later cannot forget to
  join in, because nothing announces itself at all. Measured in a browser: 340–430 hours a second,
  against 100 at 50× and 20 at 10×.
- **A brief you can lose, and a run you can put down.** The scenario states six objectives
  drawn from a closed set of measurable conditions, and the panel shows each one's live reading
  beside its last verdict. The verdict is annual — a continuous objective must not fail on one
  bad hour — but the measurement is current, so the two can disagree, and the moment they do is
  the warning. Objectives judged at the end stay *pending* even when currently satisfied,
  because a capacity target you are about to demolish half of has not been banked. Saving keeps
  what is authoritative and rebuilds what is derived; a reloaded game continues bit-identically,
  which is testable only because every random draw is a pure function of
  `(seed, stream, tick, key)` rather than a generator position that could be one draw out.
- **Politics you provoke rather than receive.** Six governments spanning what governments
  actually do — market liberalisation, a renewables push, clean-and-firm, energy security,
  consumer prices first, fiscal consolidation — each with its own carbon price, support offers,
  taxes, permitting speed and bans. Which one forms a government follows the salience of four
  things the player is responsible for: what electricity cost, whether the lights stayed on,
  what was emitted, and how much of the fuel had to be imported. No regime wins for being right.
- **Support that can be withdrawn.** A feed-in tariff is a promise made to one machine on one
  date for a fixed term, granted at the investment decision and running from the day the plant
  enters service — so a player commits capital under one government and the station arrives
  under another. Three of the six governments do not honour their predecessors' contracts, for
  three entirely recognisable reasons. What they pay for it is the cost of capital: a country
  that has torn up one contract borrows more expensively for everything afterwards.
- **Fuel prices are political, per fuel.** Each fuel has its own index, mean-reverting with a
  volatility taken from its supply risk, so a shock moves imported pipeline gas and mine-mouth
  lignite by very different amounts — and a government that invests in diversification damps it.
- **District heating, and cogeneration that means it.** Heat is a second commodity with its
  own network, solved *before* electricity. Three things make it a different problem rather
  than the same one in different units. A buried main loses heat through its insulation
  whether or not anyone is drawing from it, so the loss is constant per kilometre instead of
  quadratic in flow — which is why a heat plant must stand at the edge of the town it serves
  while a power station can stand anywhere, and why that is now a siting rule with physics
  behind it. Heat cannot be refused: a network that fails in February bursts the pipework
  inside the buildings, so unserved heat is priced far above unserved electricity. And the two
  commodities are locked together at the plant — a backpressure set makes power and heat from
  the same steam in a fixed ratio, so on a cold evening its electrical output is an injection
  the dispatch has no say over.
- **Things go wrong, and you can see them coming.** Failures, storms, droughts, price shocks,
  fuel cuts and blockades, all as data rather than code: an event may issue only a
  time-limited modifier through the parameter pipeline or a declared state transition, which
  is what keeps every consequence explainable back to its cause in the inspector. Five
  mechanisms make the randomness bearable — forewarning for everything that is not physics, an
  annual severity budget scaled to what the utility can absorb, a guaranteed way out of every
  severe event, a grace period and a cooldown, and maintenance and insurance as standing
  decisions that move the odds before anything happens.
- **Pixel art.** Terrain, stations, towns and pylons are drawn programmatically into 16×16
  textures with a fixed palette and one light direction, sampled nearest-neighbour at integer
  scale. Town windows light up at night and go dark in a blackout.
- **Lines follow corridors.** A transmission line is routed across the map by A* weighted by
  what each tile costs to cross, so going round a ridge is a real option; pylons march along
  the route and the placement preview shows the corridor the line would actually take.

- **The map is a constraint.** Each technology is sited by what it physically needs: a
  run-of-river station wants a river, a steam plant wants cooling water within reach, a
  nuclear station wants distance from population, panels want flat ground, turbines want an
  exposed ridge, and a lignite plant is built on top of its own seam. The placement overlay
  shades what is refused and tints what is good, so a merely legal site can be told from a
  worthwhile one before committing.
- **Storage plans forward.** Weather is a pure function of the tick, so the simulation
  forecasts residual load 36 hours out and each store claims exactly as many of the slackest
  and tightest hours as its duration allows. That is what separates a two-hour battery from a
  six-hour pumped station rather than a single "storage" stereotype.
- **Batteries wear out by cycling.** Life is whichever of calendar and cycle count runs out
  first, capacity fades as cycles are spent, and working a store hard for arbitrage revenue
  visibly shortens it.
- **Prices can go below zero.** A generator on a guaranteed tariff forfeits it by being
  curtailed, so it bids negative to stay on — which is why real markets with subsidised
  renewables clear below zero.
- **Plants can be overhauled.** Mid-life refurbishment restores condition, extends life and
  usually leaves the machine better than new, at a fraction of a rebuild and with the unit out
  of service meanwhile. Diminishing returns, and two rebuilds is the limit.

- **You can build.** Place power stations on legal ground, string transmission lines between
  substations, and retire or mothball what you have inherited. Capital is spent across the
  construction period, not in one lump, and a line carries nothing until it is finished.
- **Storage that obeys physics.** Batteries and pumped storage hold a finite amount of
  energy, lose some of it on the round trip, and decide when to fill and empty by looking at
  where the current price sits in its recent range. Charging is curtailed before a city is.
- **Siting matters.** Terrain decides where a station can stand and how much a line costs to
  cross it, and an exposed ridge is a materially better wind site than a sheltered valley.
- **A brownfield start.** The opening scenario begins in 1995 with an inherited fleet
  averaging two thirds of its design life, an existing grid, and existing debt. The cheap
  lignite is in the west, the demand is in the east, and the corridor between them was built
  for a smaller country.
- **Hourly dispatch on a real network.** A minimum-cost flow problem per tick: generators
  priced at their marginal cost, transmission lines with finite capacity, quadratic losses
  that depend on distance and voltage. Nodal prices fall out of the solver's dual variables,
  so congestion makes prices separate on their own.
- **Weather that does more than switch renewables on and off.** Temperature drives a
  U-shaped demand curve, derates water-cooled thermal plant in a heatwave, and cuts
  photovoltaic output as panels heat up. Drought lowers the rivers *and* the cooling water at
  once.
- **Ageing.** Efficiency, availability and maintenance cost all move with condition and age.
- **Explanations.** Every number the player sees can be unfolded into the chain that produced
  it: `Availability 76.6% ← base 91.0% · condition 74% −15.9%`.
- **Technologies arrive when they existed.** The opening scenario begins in 1995, so
  utility-scale photovoltaics and grid batteries are not on the menu yet, and the panel says
  so rather than simply hiding them.

## Design commitments

**No thumb on the scale.** The game must not push the player toward any technology. Three
things enforce that rather than merely promising it:

1. Every number in `src/content/` carries `{ value, unit, source, sourceYear }`, and
   `tests/content.test.ts` fails the build on a bare number.
2. There is no hidden path to change a value. The only way is to register a modifier with
   provenance, and every registered modifier is rendered somewhere in the UI.
3. `tests/neutrality.test.ts` checks that no technology is beaten by another on every
   dimension at once, and that emissions follow purely from fuel and efficiency. Two of its
   axes — whether a thing produces net energy at all, and how much of its rating it actually
   delivers over a year — are measured by running the weather model, not asserted. Heat and
   electricity are compared separately, because a peak boiler and a combined-cycle station are
   not competing for the same job and scoring them together would say only that thermal
   megawatts are cheaper than electrical ones.
4. `tests/events.test.ts` checks the same guarantee for adversity: every severe event has a
   response that actually reduces it, every event leaves accepting the consequences available
   and free, and nothing that is not physics arrives without warning.
5. `tests/policy.test.ts` checks it for politics, which is where a thumb on the scale would be
   easiest to apply and hardest to see. A regime's stance toward a technology is *computed* from
   the levers it pulls rather than declared, so it cannot be mislabelled into looking even-handed;
   every technology must have a government that favours it and one that does not; the best case
   politics can offer clean and emitting plant must be comparable; and every regime must be
   electable under some outcome the player could produce, because a government that can never
   form is a table entry pretending to be a possibility.

Policy bias exists in the game only as a modelled external force the player navigates, never
as a silent simulation bonus.

**The simulation core is headless.** Nothing under `src/sim/` imports PixiJS or touches the
DOM; a lint rule enforces it. The whole model runs and is tested in Node.

**Determinism.** All randomness comes from named streams sampled as a pure function of
`(seed, streamName, tick, key)`. Adding a new event or weather variable later cannot shift
the sequence of anything that already exists.

## Layout

```
src/
  sim/          simulation core — pure TypeScript, no renderer, no DOM
    grid/       network topology, island detection, line routing
    dispatch/   min-cost flow solver, hourly dispatch, forecast, storage policy
    build/      construction, refurbishment, retirement, siting rules
    heat/       district heating, cogeneration coupling, heat accumulators
    policy/     regimes, elections, support contracts, fuel geopolitics
    events/     the event director: risk, forewarning, severity budget, outages
    weather/    seeded weather and its parameter effects
    assets/     lifecycle and ageing
    params/     the modifier pipeline — the spine of the whole model
    economy/    costs, revenue, settlement
    map/        terrain, rivers, wind exposure and route costs
  content/      data with provenance: technologies, fuels, lines, scenarios
  render/       PixiJS map, camera, flow animation, pixel-art tiles and sprites
  ui/           HTML overlay: panels, charts, build menu, the explanation inspector
  i18n/         t() and the English dictionary
tests/          Vitest
scripts/        probe.ts and storageCompare.ts (diagnostics), smoke.mjs (browser test)
```

## Controls

Drag to pan, scroll to zoom, click a node to inspect it. `B` opens the build panel: pick a
technology, then click a site; for a line, click the two substations in turn. `P` opens
politics, `O` the objectives — which is also where Save and Load live, since they belong to the
run rather than to the grid. Right-click or `Esc` abandons a placement. Space pauses; `1` `2`
`3` set speed.

## Measuring this simulation

A note that cost real work to learn, recorded so the next person does not repeat it.

Unserved energy in this scenario is driven by rare coincidences of forced outages, and it is
**wildly noisy**: across seeds its standard deviation is roughly equal to its mean, and two
runs of the identical configuration can differ by an order of magnitude. An earlier version of
this README stated, from a single-run comparison, that a 50 MW battery made unserved energy
worse than having no storage at all. That claim was wrong — the difference it rested on was
far inside the noise. Repeated properly, paired across twelve seeds and five years, the
battery *reduces* unserved energy by about 7% (−1223 ± 560 MWh), and the effect of pumped
storage still cannot be resolved at that sample size.

So: `scripts/storageCompare.ts` runs every arm on the same seeds, reports the paired
difference with its standard error, and labels anything inside two standard errors as noise.
Single-run comparisons of this quantity mean nothing.

## A bug that four milestones of tests could not see

Worth its own section, because the lesson generalises.

Every test in this project drove the game through its API: `beginPlantConstruction`, `retirePlant`,
`hud.buildPanel.setOpen(true)`. All of them passed. Meanwhile most of the interface did not work.

The panels rebuild their contents from scratch on every refresh, which is the right design for a
dashboard whose every number moves — but the refresh runs ten times a second, and a human click
takes eighty to a hundred and fifty milliseconds. A browser fires `click` only when the press and
the release land on the *same* element. So buttons were routinely destroyed and replaced between
the two, and roughly every other press did nothing, at random. That reads as a flaky interface
rather than as a bug with a cause, which is exactly why it survived so long.

Two fixes. Rebuilds are suspended while a pointer is down, which is a complete answer rather than
a mitigation: no rebuild can fall inside a click if none happens while the button is held. And
each panel now compares a short signature of what it would show and returns without touching the
DOM when nothing has changed — which also removed the churn that was burning a core for nothing.
The build panel was running a full site search per technology, twenty technologies, ten times a
second, to redraw text that changes a few times a game year.

The smoke test now uses the mouse: it clicks the Build button, clicks a row, clicks the map to
place a station, and clicks Retire in the inspector, and it fails if any panel rebuilds even once
while the clock is stopped.

## Known gaps

Stated plainly, because they are the difference between what the simulation looks like it
models and what it actually models:

- **Routes cannot be drawn by hand.** The router picks the corridor; the player cannot drag
  one tile by tile the way a Transport Tycoon player lays track.
- **World deployment is a fixed exponential.** Learning is driven by an exogenous path per
  technology — a 1995 total compounding at a published growth rate — so the world's build-out
  is the same in every playthrough and cannot respond to anything. That is deliberate for
  neutrality's sake, since driving learning off the player's own choices would make whatever
  they built first the cheapest thing to keep building. But it does mean a technology's cost
  curve is a fact about the calendar rather than about the world.
- **Solar geometry has no latitude.** Day length, sunrise, sunset, peak elevation and panel
  temperature all vary through the year, but latitude is not a scenario parameter and there
  is no true solar azimuth, panel tilt or tracking.
- **Heat mains cannot be extended or resized once built.** A pipe can be laid between two
  existing nodes and that is all; there is no way to add a second main alongside an existing
  one, and the heat network has no equivalent of the electrical grid's reinforcement decisions.
- **Cogeneration heat is priced against last hour's electricity price.** Using this hour's
  would be circular, and the approximation is good because the price moves slowly — but it
  does mean the heat merit order is always one hour behind a sudden price move.
- **Corporation tax has no loss carry-forward.** A real utility offsets a bad year against a
  good one, so the model overstates the tax burden of a volatile strategy relative to a steady
  one.
- **The regulated tariff is reset against the market once a year.** That is enough for a carbon
  price to be passed through rather than being a pure loss, but a real regulator's review is
  slower, lumpier and negotiated, and a player cannot see the reset coming.
- **Mothballing can beat generating, under a heavy carbon price.** Measured: take the two lignite
  units out of service and after twelve years the utility has €1.2bn against €0 for the one that
  kept them running, having shed 11% of demand along the way. The arithmetic is real — avoiding
  a carbon bill of that size is worth more than the penalty for the shortfall — and it is what a
  carbon price is *for*. It is not exploitable, because cash is not the win condition: 11%
  unserved fails `keep-lights-on` by two orders of magnitude and loses the scenario. But the
  scenario is the only thing stopping it, and a sandbox with no objectives would reward it.
- **The test suite takes about five minutes.** Almost all of it is the multi-year scenario tests
  stepping tens of thousands of hours at roughly 0.8 ms each. The simulation has sixty times the
  headroom it needs at the fastest game speed, so this is a CI cost rather than a gameplay one.
  Warm-starting the loss iteration from the previous hour and loosening its convergence tolerance
  from 0.5% to 2% of the losses — which is far below any observable accuracy — cut the solves per
  tick from about four to under three; the remaining cost is spread across the heat solve, the
  forecast and the parameter chain rather than concentrated anywhere worth attacking.

## Roadmap

| Milestone | Content |
|---|---|
| M9 | More scenarios and unlocks. The objective conditions, the scenario registry and the save envelope are all in place; what is missing is written content |
| M10+ | Cross-border interconnectors and transit; then market prices and rival utilities |

The data model already carries the hooks these need — `ownerId` on every asset, a
`commodity` tag on every edge, the full weather struct, and lifecycle fields — so they are
additions rather than rewrites.

### How prices move with time

Costs are no longer frozen at the year their source published them. Four forces move them, they
pull in opposite directions, and the divergence between them is the whole point — a single
"things get cheaper" dial would have been worse than nothing, because it would teach the player
something false.

1. **Inflation** moves every price nominally and nothing really. Its home was already in the
   content: `Sourced<T>` carries the year each figure refers to, so a 2020 IEA capital cost and a
   2022 EIA one are not the same money, and carrying each from its own `sourceYear` to the game
   year is well defined. That the provenance system turns out to be exactly the machinery an
   inflation model needs is a happy accident of having insisted on provenance from the first
   commit. The game runs in **nominal** money, which makes three real things fall out for free:
   old debt gets cheap, a twenty-year fixed feed-in tariff erodes to nearly nothing, and the
   regulated tariff keeps up only because it is reset against the market each year.

2. **Capital cost is not one thing.** Each technology's capex splits into equipment, labour, and
   civil works and land. Equipment falls with cumulative deployment — the learning curve proper,
   driven by megawatts built rather than years elapsed. Labour and civil works escalate above
   general inflation, and learn back only as fast as the installation is *repeatable*.

3. **Progress makes a machine better and dearer.** More efficient, longer-lived, and more
   expensive per kilowatt for exactly those reasons. Leaving this out produces the fantasy where
   everything improves and nothing costs anything.

4. **Standardisation** cuts cost and build time for repeated builds of the same type. Unlike
   learning it is driven by the player's own fleet, because it is about their crews and their
   supply chain — which is why an *inherited* station teaches them nothing.

The result, in the 1995 build menu, with nothing about any technology asserted anywhere:

| | nuclear | coal | gas | wind | solar | battery |
|---|---|---|---|---|---|---|
| real cost per decade | ↑ 7% | ↑ 6% | ↑ 4% | ↓ 17% | ↓ 51% | ↓ 47% |

Two decisions inside that are worth stating, because both were got wrong first and the errors
were invisible to inspection.

**Every trend is anchored at the figure's own source year.** A trend index only means anything as
a ratio between two years, and the year a figure is already quoted in is its own denominator.
Anchoring everything at 1995 instead quietly asserted that the 2020 figures *were* 1995 costs, so
the scenario opened with three decades of learning already banked.

**What learns is not "equipment", it is whatever is repeatable.** Treating labour and civil works
as a floor that never learns left photovoltaics stuck at 40% of their original cost, when the real
fall is nearer 90% — because installing a solar farm genuinely did become an industrial process,
standard racking and crews who do nothing else. None of that happens to a dam. So the learning
rate on the install share is per technology, and it is the sharpest distinction in the file.

Neither bug showed up in any internal-consistency check: both models were perfectly consistent and
simply wrong. What catches them is a handful of tests that compare the model against **published
reality** — a combined-cycle station at roughly 480 €/kW and 51% efficient in 1995, roughly
1000 €/kW and 59% by 2025; solar near 940 €/kW in 2015. Those are in `tests/costTrends.test.ts`
with deliberately wide bounds, there to catch a model that has come loose from reality rather than
to pin content to a decimal place.

**Storage variety** beyond lithium and pumped hydro — flow batteries, compressed air,
hydrogen, thermal — is now mostly a content question, since duration, round-trip efficiency
and cycle life all drive the choice. `StorageSpec` carries all three.
