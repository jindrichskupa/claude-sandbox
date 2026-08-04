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
```

## Playing it

Pushing to `main` publishes the game to GitHub Pages via `.github/workflows/pages.yml`,
which lints and tests before it deploys. The workflow needs Pages switched on once, under
**Settings → Pages → Source: GitHub Actions**; until that is done the deploy step fails with
a permissions error and nothing else breaks.

`npm run bundle` produces `dist-single/powergrid-tycoon.html`: the whole game — simulation,
renderer and artwork — in a single document of about 0.6 MB that runs from a `file://` URL
with no network at all. All the artwork is generated at runtime, so there is nothing else to
carry. `scripts/smokeSingle.mjs` opens it with every outbound request blocked and fails if
the document tries to fetch anything.

## What exists today (milestones 1-4)

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
   delivers over a year — are measured by running the weather model, not asserted.

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
technology, then click a site; for a line, click the two substations in turn. Right-click or
`Esc` abandons a placement. Space pauses; `1` `2` `3` set speed.

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

## Known gaps

Stated plainly, because they are the difference between what the simulation looks like it
models and what it actually models:

- **Routes cannot be drawn by hand.** The router picks the corridor; the player cannot drag
  one tile by tile the way a Transport Tycoon player lays track.
- **Costs do not move with time.** A technology built in 2020 costs what its source year says
  it cost, so `availableFromYear` prevents the obvious absurdities but a learning curve is
  what would actually make the timeline honest.
- **Solar geometry has no latitude.** Day length, sunrise, sunset, peak elevation and panel
  temperature all vary through the year, but latitude is not a scenario parameter and there
  is no true solar azimuth, panel tilt or tracking.
- **Feed-in tariffs are a flat scenario setting.** The mechanism behind negative prices is
  real, but tariffs do not yet arrive, change, or get withdrawn — that is the policy
  milestone, and the withdrawal is the interesting half.

## Roadmap

| Milestone | Content |
|---|---|
| M5 | District heating and cogeneration; the event and disaster system |
| M6 | Subsidies and their withdrawal, taxes, carbon pricing, elections, fuel geopolitics |
| M7 | Learning curves and standardisation |
| M8 | Campaign: scenarios, objectives, unlocks, saved games; publish to GitHub Pages |
| M9+ | Cross-border interconnectors and transit; then market prices and rival utilities |

The data model already carries the hooks these need — `ownerId` on every asset, a
`commodity` tag on every edge, the full weather struct, and lifecycle fields — so they are
additions rather than rewrites.

**Storage variety** beyond lithium and pumped hydro — flow batteries, compressed air,
hydrogen, thermal — is now mostly a content question, since duration, round-trip efficiency
and cycle life all drive the choice. `StorageSpec` carries all three.
