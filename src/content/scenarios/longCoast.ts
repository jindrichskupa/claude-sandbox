/**
 * The second scenario: a young system on a growing coast, over sixty years.
 *
 * The opening scenario is about replacement. Everything in it is two thirds through its life,
 * the cheap fuel is behind a corridor that cannot carry it, and the whole run is a fight to get
 * out from under what somebody else built. That is one kind of problem and it is not the only
 * one.
 *
 * This is the other kind. Nothing here is dying: the newest gas set went in four years ago and
 * the oldest thing on the map is a river station that will outlive everyone. The system is small,
 * clean-ish, entirely dependent on gas, and the coast it serves keeps growing. The question is not
 * what to replace — it is what to commit to, for how long, while the carbon price that does not
 * exist yet arrives.
 *
 * ## Why sixty years, and why it is not simply an easier map
 *
 * It was authored against a measurement. `scripts/oneReactorOrTwo.ts` found that a financed
 * reactor makes the opening scenario *worse* — 8.13% of demand unserved against 1.25% for small
 * quick plant — and that the cause is the seventy-seven-month build. Six and a half years
 * producing nothing while an inherited fleet ages out, then twenty-five years of instalments,
 * against a peak the cheap alternatives already cover. That is a fact about the opening scenario
 * rather than about reactors, and it left one technology in the catalogue that no conviction
 * could make sensible anywhere — which is exactly the failure the neutrality test is for.
 *
 * So this one gives a long build somewhere to go: a horizon that outlasts a facility, a fleet
 * that will not collapse while something is being built, and demand that keeps arriving. It does
 * not make a reactor the answer. Gas is cheap here and stays legal for decades, the wind sites on
 * this coast are the best on either map, and the low-carbon objective can be met several ways.
 * What it does is make the long commitment *possible*, so that choosing it is a decision rather
 * than a refusal.
 *
 * ## What is deliberately absent
 *
 * No district heating. The opening scenario has a heat network and it is half of what makes it
 * hard; repeating it here would make this the same scenario with different numbers. A coastal
 * region that never built one is ordinary, and it means the heat objectives simply do not apply.
 */

import { TEMPERATE_CLIMATE } from '../../sim/weather/weather'
import type { ScenarioContent } from './types'

export const LONG_COAST: ScenarioContent = {
  id: 'long-coast',
  nameKey: 'scenario.longCoast.name',
  descriptionKey: 'scenario.longCoast.description',
  startYear: 1990,
  seed: 19900101,
  mapWidth: 44,
  mapHeight: 32,
  kmPerTile: 10,
  // More than the opening scenario starts with, and it has to be: the smallest thing worth
  // committing to here takes six years to build. Not enough to buy one outright — the equity on a
  // reactor is nine hundred million against this — so the decision still has to be financed.
  startingCash: 500_000_000,
  startingDebt: 150_000_000,
  tariffPerMwh: 82,
  heatTariffPerMwh: 45,
  carbonPricePerTonne: 0,
  // 1990: nobody is pricing carbon and nobody is subsidising anything. Every political thing that
  // happens over the next sixty years is provoked by the player's own system.
  initialRegimeId: 'market_liberal',
  climate: TEMPERATE_CLIMATE,

  nodes: [
    // The coast, east of the inner sea. Where most of the people are and where the growth is.
    { id: 'n_fairhaven', kind: 'city', x: 37, y: 11, name: 'Fairhaven' },
    { id: 'n_saltmarket', kind: 'city', x: 35, y: 21, name: 'Saltmarket' },
    // The west, across the water, joined to the rest only through the middle.
    { id: 'n_westport', kind: 'city', x: 6, y: 13, name: 'Westport' },
    // The valley town, on the river that runs down the middle of the map.
    { id: 'n_millrace', kind: 'city', x: 17, y: 15, name: 'Millrace' },

    // Generation. The two gas stations are new, which is the whole point of the starting position.
    { id: 'n_harbourpoint', kind: 'plant', x: 33, y: 8, name: 'Harbour Point' },
    { id: 'n_westgate', kind: 'plant', x: 2, y: 19, name: 'Westgate' },
    { id: 'n_saltflats', kind: 'plant', x: 33, y: 24, name: 'Salt Flats' },
    { id: 'n_millfalls', kind: 'plant', x: 9, y: 8, name: 'Mill Falls' },
    // The one inherited problem, in the north where the coal came ashore.
    { id: 'n_northreach', kind: 'plant', x: 27, y: 6, name: 'Northreach' },

    // Two switching stations, which is what makes this one grid rather than three.
    { id: 'n_midlands', kind: 'substation', x: 22, y: 14, name: 'Midlands' },
    { id: 'n_southcross', kind: 'substation', x: 26, y: 20, name: 'Southcross' },
  ],

  cities: [
    // Roughly a gigawatt between them at the start, and it grows for sixty years. By the 2040s
    // this is a materially larger system than anything the opening scenario ever becomes.
    {
      id: 'c_fairhaven',
      nodeId: 'n_fairhaven',
      name: 'Fairhaven',
      population: 380,
      baseDemandMw: 320,
      baseHeatDemandMwth: 0,
    },
    {
      id: 'c_saltmarket',
      nodeId: 'n_saltmarket',
      name: 'Saltmarket',
      population: 260,
      baseDemandMw: 240,
      baseHeatDemandMwth: 0,
    },
    {
      id: 'c_westport',
      nodeId: 'n_westport',
      name: 'Westport',
      population: 230,
      baseDemandMw: 210,
      baseHeatDemandMwth: 0,
    },
    {
      id: 'c_millrace',
      nodeId: 'n_millrace',
      name: 'Millrace',
      population: 190,
      baseDemandMw: 180,
      baseHeatDemandMwth: 0,
    },
  ],

  // Two and a half gigawatts against a peak of about 1.75, which is a real margin and a thinner
  // one than the opening scenario's. Sized by measurement rather than by eye — see
  // `scripts/sizeScenario.ts`, written after the first attempt at this fleet was set against each
  // town's *base* demand and went bankrupt in its third year with a fifth of the load
  // undelivered. Base demand is the flat part of a curve that peaks at nearly twice it.
  plants: [
    // The modern half, four to eleven years old. No replacement decision is due for two decades,
    // which is what leaves room for a decision about the decades after that.
    { id: 'p_harbourpoint1', nodeId: 'n_harbourpoint', typeId: 'ccgt', name: 'Harbour Point I', ageYears: 4 },
    { id: 'p_harbourpoint2', nodeId: 'n_harbourpoint', typeId: 'ccgt', name: 'Harbour Point II', ageYears: 6 },
    { id: 'p_westgate1', nodeId: 'n_westgate', typeId: 'ccgt', name: 'Westgate I', ageYears: 8 },
    { id: 'p_westgate2', nodeId: 'n_westgate', typeId: 'ccgt', name: 'Westgate II', ageYears: 11 },
    // The peakers, for the evenings the wind drops. Cheap to build, expensive to run, and the
    // reason the system works at all before anything else is added.
    { id: 'p_saltflats1', nodeId: 'n_saltflats', typeId: 'ocgt', name: 'Salt Flats I', ageYears: 6 },
    { id: 'p_saltflats2', nodeId: 'n_saltflats', typeId: 'ocgt', name: 'Salt Flats II', ageYears: 9 },
    // The inherited problem, and the only one. Twenty-four years into a forty-five year life, so
    // it comes due around 2011 — early enough to be a decision the player takes rather than one
    // that takes them, and late enough that it is not the first thing they do.
    { id: 'p_northreach', nodeId: 'n_northreach', typeId: 'coal', name: 'Northreach', ageYears: 24 },
    // The one genuinely old thing, and it does not matter that it is old: a river station is the
    // closest this game has to a permanent asset.
    { id: 'p_millfalls', nodeId: 'n_millfalls', typeId: 'hydro', name: 'Mill Falls', ageYears: 34 },
  ],

  lines: [
    // The eastern coast, where the load is. Doubled from the start because it was built recently
    // and to a modern standard — this scenario's weakness is not its network.
    { ageYears: 4, id: 'l_harbourpoint_fairhaven', from: 'n_harbourpoint', to: 'n_fairhaven', kv: 220, circuits: 2 },
    { ageYears: 24, id: 'l_northreach_midlands', from: 'n_northreach', to: 'n_midlands', kv: 220, circuits: 1 },
    { ageYears: 9, id: 'l_fairhaven_midlands', from: 'n_fairhaven', to: 'n_midlands', kv: 220, circuits: 2 },
    { ageYears: 11, id: 'l_midlands_southcross', from: 'n_midlands', to: 'n_southcross', kv: 220, circuits: 1 },
    { ageYears: 6, id: 'l_southcross_saltmarket', from: 'n_southcross', to: 'n_saltmarket', kv: 220, circuits: 1 },
    { ageYears: 6, id: 'l_saltflats_southcross', from: 'n_saltflats', to: 'n_southcross', kv: 220, circuits: 1 },
    // The middle and the west. The long one across the map is the single circuit that matters,
    // and it is the first thing a player who reads the map will want a second circuit on.
    { ageYears: 12, id: 'l_millrace_midlands', from: 'n_millrace', to: 'n_midlands', kv: 220, circuits: 1 },
    { ageYears: 12, id: 'l_millfalls_westport', from: 'n_millfalls', to: 'n_westport', kv: 110, circuits: 1 },
    { ageYears: 18, id: 'l_westport_millrace', from: 'n_westport', to: 'n_millrace', kv: 220, circuits: 1 },
    { ageYears: 15, id: 'l_westgate_westport', from: 'n_westgate', to: 'n_westport', kv: 220, circuits: 1 },
  ],

  // None. See the note at the top of the file: repeating the opening scenario's heat network here
  // would make this the same problem twice.
  heatPipes: [],

  endYear: 2050,

  objectives: [
    {
      id: 'keep-lights-on',
      descriptionKey: 'objective.keepLightsOn',
      condition: { kind: 'unservedShareBelow', threshold: 0.001 },
      timing: 'continuous',
      required: true,
      // Sixty years is twice the opening scenario's span, so a tolerance of one bad year is
      // proportionally stricter here rather than more forgiving. Two is the same standard.
      breachTolerance: 2,
    },
    {
      id: 'stay-solvent',
      descriptionKey: 'objective.staySolvent',
      condition: { kind: 'neverBankrupt' },
      timing: 'continuous',
      required: true,
    },
    {
      id: 'keep-up-with-growth',
      descriptionKey: 'objective.keepUpWithGrowth',
      // The load roughly doubles over sixty years. Starting firm capacity is about 1.1 GW, so
      // this cannot be met by holding what was inherited — which is the difference between this
      // scenario and the last one.
      condition: { kind: 'capacityAtLeast', mw: 2400 },
      timing: 'atEnd',
      required: true,
    },
    {
      id: 'half-low-carbon',
      descriptionKey: 'objective.halfLowCarbon',
      // Half the energy from something that does not burn, by 2050. Deliberately a share of
      // *energy* rather than of capacity, and deliberately silent about which technology: a
      // reactor meets it, so does enough wind with something firm behind it, and so does a
      // combination. What it rules out is sixty years of gas, which is the one answer the
      // starting position hands the player for free.
      condition: { kind: 'lowCarbonShareAtLeast', share: 0.5 },
      timing: 'atEnd',
      required: false,
    },
  ],

  feedInTariffs: {},
}
