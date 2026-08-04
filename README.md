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
```

## What exists today (milestones 1-2)

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
    grid/       network topology and island detection
    dispatch/   min-cost flow solver, hourly dispatch, storage policy
    build/      construction, retirement, and the quotes behind them
    weather/    seeded weather and its parameter effects
    assets/     lifecycle and ageing
    params/     the modifier pipeline — the spine of the whole model
    economy/    costs, revenue, settlement
    map/        terrain, siting rules and route costs
  content/      data with provenance: technologies, fuels, lines, scenarios
  render/       PixiJS map, camera, flow animation
  ui/           HTML overlay: panels, charts, build menu, the explanation inspector
  i18n/         t() and the English dictionary
tests/          Vitest
scripts/        probe.ts (balance diagnostics), smoke.mjs (browser test)
```

## Controls

Drag to pan, scroll to zoom, click a node to inspect it. `B` opens the build panel: pick a
technology, then click a site; for a line, click the two substations in turn. Right-click or
`Esc` abandons a placement. Space pauses; `1` `2` `3` set speed.

## Roadmap

| Milestone | Content |
|---|---|
| M3 | Repairs, refurbishment and mid-life uprating; forecasts |
| M4 | District heating and cogeneration; the event and disaster system |
| M5 | Subsidies and their withdrawal, taxes, carbon pricing, elections, fuel geopolitics |
| M6 | Learning curves and standardisation |
| M7 | Campaign: scenarios, objectives, unlocks, saved games |
| M8+ | Cross-border interconnectors and transit; then market prices and rival utilities |

The data model already carries the hooks these need — `ownerId` on every asset, a
`commodity` tag on every edge, the full weather struct, and lifecycle fields — so they are
additions rather than rewrites.
