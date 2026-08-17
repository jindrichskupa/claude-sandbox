/**
 * The third scenario: a real country, at a date when everything about it was still open.
 *
 * Czechia in 1995. Half the electricity comes out of lignite dug from one basin under the
 * northern mountains, the reactor in the south is four units of Soviet design that nobody
 * outside the country trusts yet, the second reactor is a hole in the ground at Temelín that has
 * been under construction for eight years, and the heat for a third of the population comes down
 * pipes from the same coal stations. Every one of those was a live argument in 1995 and most of
 * them still are.
 *
 * ## What is real here and what is not
 *
 * The map, the sites and the shape of the system are real. The Ohře valley under the Krušné hory
 * is where the lignite is and where the stations stand on it; Dukovany really is out on the
 * Moravian plateau next to a pumped-storage reservoir; Opatovice really does heat two cities
 * thirty kilometres apart; the Vltava cascade really does run from the Šumava border to Prague.
 * The regions are the fourteen kraje aggregated into thirteen load points, with Prague and the
 * Central Bohemian region taken together because on this grid they are one city.
 *
 * **The scale is not real, and cannot be.** The catalogue has one lignite unit at 600 MW and one
 * reactor at 1000 MW, which is what a lignite unit and a reactor cost and take to build; it has
 * no way to express a 110 MW machine at Hodonín or a 1490 MW site at Prunéřov. So the fleet here
 * is the real one rounded to the units the game owns: about 8.1 GW installed against a real 1995
 * figure near 15 GW, and demand scaled to match. Roughly half a country, with the proportions
 * between its parts kept. Anything read off this scenario is about the *shape* of the Czech
 * system — coal in the north-west, load in Prague and Ostrava, one reactor, a long thin country
 * to carry it across — and never about its size.
 *
 * ## What is not finished
 *
 * Three things on this map are not machines but somebody else's unfinished work, which is half of
 * what a real handover consists of. **Temelín** is eight years into construction with seven to go
 * and no unit running — the loudest argument in Czech energy that year, and the player inherits
 * both the hole in the ground and the argument. **Dlouhé stráně** is a year from finishing after
 * seventeen, which is the reverse case: the cheap end of somebody else's decade. **Tušimice** is
 * in pieces, in the middle of the desulphurisation programme that between 1992 and 1998 decided
 * which lignite units had a future.
 *
 * None of the three is a decoration. The reactor can be finished or walked away from — see
 * `abandonProject`, which exists because of this scenario — and either answer costs money the
 * player would rather spend on something else.
 *
 * ## Why it is hard
 *
 * Not because the fleet is short. It is not — 8.1 GW against a peak near 5.5 is a comfortable
 * margin, as the real one was, and the country exported the difference. It is hard because the
 * margin is made of machines that are all the same age. Prunéřov, Tušimice, Počerady, Ledvice,
 * Mělník and Chvaletice were built inside fifteen years of each other, and thirty years into the
 * scenario they come due inside fifteen years of each other too. Behind them sits a heat network
 * that cannot be switched off in February, and a tariff a 1995 government has every intention of
 * keeping low.
 */

import { TEMPERATE_CLIMATE } from '../../sim/weather/weather'
import {
  czechiaCities,
  CZECHIA_HEAT_PIPES,
  CZECHIA_KM_PER_TILE,
  CZECHIA_LINES_1995,
  CZECHIA_MAP_HEIGHT,
  CZECHIA_MAP_WIDTH,
  CZECHIA_NODES,
  CZECHIA_TERRAIN_ROWS,
} from './czechiaMap'
import type { ScenarioContent } from './types'

export const CZECHIA_1995: ScenarioContent = {
  id: 'czechia-1995',
  nameKey: 'scenario.czechia1995.name',
  descriptionKey: 'scenario.czechia1995.description',
  startYear: 1995,
  seed: 19950101,
  mapWidth: CZECHIA_MAP_WIDTH,
  mapHeight: CZECHIA_MAP_HEIGHT,
  kmPerTile: CZECHIA_KM_PER_TILE,
  // A utility that has been spending on a half-built reactor for eight years. The debt is the
  // interesting number: it is what makes the first replacement decision a financing decision.
  startingCash: 420_000_000,
  startingDebt: 900_000_000,
  tariffPerMwh: 58,
  heatTariffPerMwh: 38,
  // No carbon price anywhere in Europe in 1995. What arrives later arrives because of the
  // politics the player provokes, not because the scenario scheduled it.
  carbonPricePerTonne: 0,
  // A government whose stated priority is the price to households. It was, and the effect on a
  // utility that needs to replace half its fleet is exactly the tension the decade had.
  initialRegimeId: 'affordability',
  climate: TEMPERATE_CLIMATE,

  terrainRows: CZECHIA_TERRAIN_ROWS,

  nodes: CZECHIA_NODES,

  // Thirteen regions, about 2.44 GW of base load between them, which peaks near 4.8. The numbers
  // themselves are in `czechiaMap`, because they are the shape of Czech demand rather than a fact
  // about 1995; this is the date that defines them, so it takes them unscaled.
  cities: czechiaCities({ electric: 1, heat: 1, population: 1 }),

  /**
   * Twenty generating units and the boilers behind the heat network.
   *
   * The ages are the real commissioning dates, which is where most of this scenario's difficulty
   * comes from and none of it is authored: the lignite fleet went in between 1967 and 1981, so it
   * is between fourteen and twenty-eight years old on day one and it all reaches the end of its
   * design life inside the same decade. Nobody arranged that. It is what happens when a country
   * industrialises on one fuel over fifteen years.
   */
  plants: [
    // Prunéřov is the biggest site in the country and gets two units for it; the rest are one
    // apiece, which is the closest the catalogue's 600 MW block comes to the real sites.
    { id: 'p_prunerov1', nodeId: 'n_prunerov', typeId: 'lignite', name: 'Prunéřov I', ageYears: 28 },
    { id: 'p_prunerov2', nodeId: 'n_prunerov', typeId: 'lignite', name: 'Prunéřov II', ageYears: 14 },
    // In pieces, in the middle of the retrofit that decided which lignite units had a future.
    // Between 1992 and 1998 ČEZ desulphurised the fleet it meant to keep and closed the rest; the
    // units that got scrubbers ran on for another quarter century. The game has no separate model
    // for flue gas desulphurisation and treats it as the general overhaul it also was — new
    // burners, turbine work and twenty more years — which is honest about what it buys and silent
    // about the part it does not model, the emissions the scrubber was actually for.
    {
      id: 'p_tusimice',
      nodeId: 'n_tusimice',
      typeId: 'lignite',
      name: 'Tušimice II',
      ageYears: 21,
      inProgress: { kind: 'refurbishing', yearsElapsed: 1, yearsRemaining: 1.5, costRemainingShare: 0.6 },
    },
    { id: 'p_pocerady', nodeId: 'n_pocerady', typeId: 'lignite', name: 'Počerady', ageYears: 25 },
    { id: 'p_ledvice', nodeId: 'n_ledvice', typeId: 'lignite', name: 'Ledvice', ageYears: 29 },
    { id: 'p_melnik', nodeId: 'n_melnik', typeId: 'lignite', name: 'Mělník I', ageYears: 34 },
    { id: 'p_chvaletice', nodeId: 'n_chvaletice', typeId: 'lignite', name: 'Chvaletice', ageYears: 18 },
    // Hard coal from the pit next door, and the only station in the east that is not a reactor.
    { id: 'p_detmarovice', nodeId: 'n_detmarovice', typeId: 'coal', name: 'Dětmarovice', ageYears: 20 },

    // The reactor. Four Soviet units at one site in life, two of the catalogue's blocks here.
    // Nine and eleven years old, so they are the youngest large thing on the map and the only
    // part of the fleet that is not a replacement problem inside this scenario.
    { id: 'p_dukovany1', nodeId: 'n_dukovany', typeId: 'nuclear', name: 'Dukovany 1', ageYears: 11 },
    { id: 'p_dukovany2', nodeId: 'n_dukovany', typeId: 'nuclear', name: 'Dukovany 2', ageYears: 9 },

    // The Vltava cascade. Small, ancient and effectively permanent — Slapy and Orlík were
    // finished in the fifties, and they will still be there when everything else on this list
    // has been demolished twice.
    { id: 'p_orlik', nodeId: 'n_orlik', typeId: 'hydro', name: 'Orlík', ageYears: 34 },
    { id: 'p_slapy', nodeId: 'n_slapy', typeId: 'hydro', name: 'Slapy', ageYears: 41 },
    { id: 'p_lipno', nodeId: 'n_lipno', typeId: 'hydro', name: 'Lipno', ageYears: 36 },

    // The flexibility. Dalešice was built to follow Dukovany; Dlouhé stráně is brand new — a
    // year early, see the note at the top of the file.
    { id: 'p_dalesice', nodeId: 'n_dalesice', typeId: 'pumped', name: 'Dalešice', ageYears: 17 },
    // A year from finishing, seventeen years after the first spade went in — begun in 1978,
    // abandoned for most of the eighties for want of money, restarted, and switched on in 1996.
    // The last year of a project is the cheap part, which is why the player inherits a bargain:
    // six hundred megawatts of flexibility for the price of finishing somebody else's decade.
    {
      id: 'p_dlouhestrane',
      nodeId: 'n_dlouhestrane',
      typeId: 'pumped',
      name: 'Dlouhé stráně',
      ageYears: 0,
      inProgress: { kind: 'building', yearsElapsed: 17, yearsRemaining: 1, costRemainingShare: 0.08 },
    },

    // And the hole in the ground.
    //
    // Temelín was begun in 1987 as four Soviet-design units, cut to two in 1990, and in 1995 it
    // was eight years in with nothing running, four years past its first commissioning date, and
    // the loudest argument in Czech energy. It was finished in 2002 — fifteen years, against a
    // plan of six.
    //
    // One block rather than two, on the same rule as Dukovany: this scenario is the real fleet
    // rounded to the units the game owns, at about half the country's size.
    //
    // The share left to pay is set by what it does to *this* utility rather than by the real
    // percentage, and the difference is worth stating. By 1995 roughly a third of the eventual
    // bill had been spent, so two thirds were left; but the catalogue prices a reactor at Western
    // 2020 rates, four times what Temelín cost per kilowatt, and two thirds of that against a
    // half-scale utility's cash flow would not be a decision, it would be a foregone bankruptcy.
    // What is kept true is the pressure: finishing it costs about a year of everything the company
    // earns, every year, for seven years. That is what the argument was about.
    {
      id: 'p_temelin',
      nodeId: 'n_temelin',
      typeId: 'nuclear',
      name: 'Temelín 1',
      ageYears: 0,
      inProgress: { kind: 'building', yearsElapsed: 8, yearsRemaining: 7, costRemainingShare: 0.35 },
    },

    // The heating plants. Backpressure coal sets, which is what makes the winter hard: on a
    // January evening these are not a choice the dispatch makes, they are an output it is given.
    { id: 'p_malesice', nodeId: 'n_malesice', typeId: 'coal_chp', name: 'Praha-Malešice', ageYears: 31 },
    { id: 'p_trmice', nodeId: 'n_trmice', typeId: 'coal_chp', name: 'Trmice', ageYears: 27 },
    { id: 'p_tisova', nodeId: 'n_tisova', typeId: 'coal_chp', name: 'Tisová', ageYears: 37 },
    { id: 'p_opatovice', nodeId: 'n_opatovice', typeId: 'coal_chp', name: 'Opatovice', ageYears: 35 },
    { id: 'p_trebovice', nodeId: 'n_trebovice', typeId: 'coal_chp', name: 'Ostrava-Třebovice', ageYears: 39 },

    // And the peak boilers, which nobody thinks about until February. Opatovice carries two
    // cities on one set, so it gets the most.
    { id: 'p_malesice_boiler_a', nodeId: 'n_malesice', typeId: 'heat_boiler', name: 'Malešice Boiler A', ageYears: 20 },
    { id: 'p_malesice_boiler_b', nodeId: 'n_malesice', typeId: 'heat_boiler', name: 'Malešice Boiler B', ageYears: 20 },
    { id: 'p_malesice_boiler_c', nodeId: 'n_malesice', typeId: 'heat_boiler', name: 'Malešice Boiler C', ageYears: 12 },
    { id: 'p_malesice_boiler_d', nodeId: 'n_malesice', typeId: 'heat_boiler', name: 'Malešice Boiler D', ageYears: 12 },
    { id: 'p_trmice_boiler_a', nodeId: 'n_trmice', typeId: 'heat_boiler', name: 'Trmice Boiler A', ageYears: 24 },
    { id: 'p_trmice_boiler_b', nodeId: 'n_trmice', typeId: 'heat_boiler', name: 'Trmice Boiler B', ageYears: 15 },
    { id: 'p_trmice_boiler_c', nodeId: 'n_trmice', typeId: 'heat_boiler', name: 'Trmice Boiler C', ageYears: 9 },
    { id: 'p_tisova_boiler', nodeId: 'n_tisova', typeId: 'heat_boiler', name: 'Tisová Boiler', ageYears: 22 },
    { id: 'p_opatovice_boiler_a', nodeId: 'n_opatovice', typeId: 'heat_boiler', name: 'Opatovice Boiler A', ageYears: 26 },
    { id: 'p_opatovice_boiler_b', nodeId: 'n_opatovice', typeId: 'heat_boiler', name: 'Opatovice Boiler B', ageYears: 18 },
    { id: 'p_trebovice_boiler_a', nodeId: 'n_trebovice', typeId: 'heat_boiler', name: 'Třebovice Boiler A', ageYears: 28 },
    { id: 'p_trebovice_boiler_b', nodeId: 'n_trebovice', typeId: 'heat_boiler', name: 'Třebovice Boiler B', ageYears: 16 },
    { id: 'p_trebovice_boiler_c', nodeId: 'n_trebovice', typeId: 'heat_boiler', name: 'Třebovice Boiler C', ageYears: 11 },
  ],

  lines: CZECHIA_LINES_1995,

  heatPipes: CZECHIA_HEAT_PIPES,

  /**
   * Fifty-five years, and the last twenty-five are the point.
   *
   * This was thirty, ending in 2025, and thirty was measurably the wrong number. Five scripted
   * utilities played it to 2025 and every one of them arrived comfortable — cash piled up, the
   * inherited fleet still standing, nothing decided. Then the same five played on: the lignite
   * basin reaches the end of its life between 2028 and 2039, and by 2041 the cheapest of them was
   * bankrupt with 2.5% of demand undelivered. The scenario's whole subject — a fleet built inside
   * fifteen years coming due inside fifteen years — happened *after* the credits rolled.
   *
   * 2050 is not an arbitrary extension either. A reactor commissioned in 1985 with a sixty-year
   * life is due in 2045, so ending here is the first horizon at which the player has to answer for
   * both the coal and the nuclear, which is the actual Czech question.
   */
  endYear: 2050,

  objectives: [
    {
      id: 'keep-lights-on',
      descriptionKey: 'objective.keepLightsOn',
      condition: { kind: 'unservedShareBelow', threshold: 0.001 },
      timing: 'continuous',
      required: true,
      breachTolerance: 1,
    },
    {
      id: 'keep-the-heat-on',
      descriptionKey: 'objective.keepTheHeatOn',
      condition: { kind: 'noUnservedHeat' },
      timing: 'continuous',
      required: true,
    },
    {
      id: 'stay-solvent',
      descriptionKey: 'objective.staySolvent',
      condition: { kind: 'neverBankrupt' },
      timing: 'continuous',
      required: true,
    },
    {
      id: 'replace-the-basin',
      descriptionKey: 'objective.replaceTheBasin',
      // Not "close the lignite" — that would be the thumb on the scale this project is built to
      // avoid. It is a capacity floor, met by whatever the player likes, including new lignite if
      // they can keep it legal and paid for. What it rules out is arriving in 2025 having let the
      // fleet die without replacing it, which is the failure the starting position invites.
      condition: { kind: 'capacityAtLeast', mw: 6500 },
      timing: 'atEnd',
      required: true,
    },
    {
      id: 'cleaner-than-inherited',
      descriptionKey: 'objective.cleanerThanInherited',
      // The inherited system runs near 0.6 t/MWh. Getting under it is optional and there are
      // several ways: finish Temelín, replace lignite with gas, build wind and solar behind the
      // reactor, or some of each.
      condition: { kind: 'carbonIntensityBelow', tPerMwh: 0.45 },
      timing: 'atEnd',
      required: false,
    },
  ],

  feedInTariffs: {},

  /**
   * What happened anyway, between 1995 and 2025.
   *
   * The rest of this game's politics is emergent: elections read the price, the blackouts, the
   * emissions and the import exposure, and the player's own record decides who governs. That
   * stays true here — every one of these governments faces the next election normally and can be
   * thrown out. What the timeline adds is the half of Czech energy policy that was decided in
   * Brussels, Berlin and Moscow, and that no amount of running a good system would have avoided.
   *
   * **On neutrality.** This is a record, not an argument, and the test of that is that it hurts in
   * both directions. A support scheme arrives and is torn up retroactively. A carbon price arrives,
   * collapses, and arrives again. A decarbonisation government is followed by a security
   * government that brings coal back and taxes the windfall. Every entry names something that
   * happened and says where the claim comes from. Nothing here is scheduled because it would make
   * the scenario harder; several entries make it easier, and one of them — the feed-in tariff era —
   * is the single most profitable thing that happens to the player in thirty years, right up until
   * the government takes it back.
   *
   * **On granularity.** The regime table has six positions and history has more than six moods, so
   * each entry picks the government whose stated priorities match the period rather than
   * reproducing a coalition. Where the fit is imperfect it is noted on the entry.
   */
  timeline: [
    {
      year: 2004,
      regimeId: 'market_liberal',
      headlineKey: 'history.cz.euAccession',
      source: 'Accession to the European Union, 1 May 2004; Energy Act 458/2000 and the opening of the market',
    },
    {
      // The feed-in tariff era, and the reason it went the way it did. Act 180/2005 guaranteed a
      // price for fifteen years and capped how fast the regulator could cut it — five per cent a
      // year — while the cost of a solar panel fell by roughly forty per cent a year. About
      // 1,650 MW went in over 2009 and 2010, most of it in the last months before the cap moved.
      //
      // Nothing here schedules that boom. `market_liberal` is the government that offers the
      // tariff; the roofs and the farms arrive because the offer is worth taking, which is the
      // model working rather than the author making a point.
      year: 2006,
      regimeId: 'market_liberal',
      headlineKey: 'history.cz.feedInTariffs',
      source: 'Act 180/2005 Coll. on the promotion of electricity from renewable sources',
    },
    {
      // The financial crisis. Not a policy at all — the price of money.
      year: 2008,
      eventId: 'interest_shock',
      headlineKey: 'history.cz.financialCrisis',
      source: 'Global financial crisis, 2008; European credit conditions 2008-09',
    },
    {
      // And the government tears its own promise up. A 26% levy on solar plant commissioned in
      // 2009 and 2010, applied to contracts already signed, sold as protecting household bills.
      // `affordability` is the position that does this: it does not honour its predecessors'
      // contracts and it levies a windfall, both of which are exactly what happened.
      //
      // This is the entry to point at if anyone claims the timeline has a side. The support was
      // real, the boom was real, the bill to households was real, and so was the retroactive cut —
      // and the cut is the reason capital was expensive in Czech energy for a decade afterwards.
      year: 2011,
      regimeId: 'affordability',
      headlineKey: 'history.cz.solarLevy',
      source: 'Act 402/2010 Coll.; the 26% levy on 2009-2010 photovoltaic plant, in force from 2011',
    },
    {
      // The 2015 drought, which took river flows and cooling water together — the Czech summer
      // that made "enough water to run the coal fleet" a sentence people said out loud.
      year: 2015,
      eventId: 'drought',
      headlineKey: 'history.cz.drought',
      source: 'Czech drought of 2015; Vltava and Elbe flows at record lows',
    },
    {
      // The carbon price comes back. The market stability reserve took the allowance from about
      // five euros to twenty-five in two years, and the Green Deal put a date on the rest of it.
      // `clean_firm` rather than `renewables_push` because that is the Czech reading of it:
      // decarbonise with the reactor, keep the district heating, and argue about the rest.
      year: 2019,
      regimeId: 'clean_firm',
      headlineKey: 'history.cz.etsReform',
      source: 'EU ETS Market Stability Reserve from 2019; European Green Deal, December 2019',
    },
    {
      year: 2021,
      eventId: 'fuel_price_spike',
      headlineKey: 'history.cz.gasPriceClimb',
      source: 'European gas price rise through 2021; TTF from 20 to over 100 EUR/MWh',
    },
    {
      // The invasion, and everything that followed it in one year: the gas cut, the price cap,
      // the windfall levy, and lignite units pulled back out of reserve. `energy_security` is
      // that government exactly — it does not honour contracts, it levies ninety per cent of a
      // windfall, and it pays for coal.
      year: 2022,
      eventId: 'gas_supply_interruption',
      headlineKey: 'history.cz.invasion',
      source: 'Russian invasion of Ukraine, February 2022; Nord Stream flows to zero, September 2022',
    },
    {
      year: 2022,
      regimeId: 'energy_security',
      headlineKey: 'history.cz.securityTurn',
      source: 'Czech windfall levy (60%, from 2023) and the EU emergency price cap, Council Regulation 2022/1854',
    },
    {
      // And back again, because that is what the record shows: the coal deadline moved forward
      // from 2038 to 2033 and the reactor tender went ahead in the same years as the windfall tax.
      year: 2024,
      regimeId: 'clean_firm',
      headlineKey: 'history.cz.coalDeadline',
      source: 'Czech coal phase-out target brought forward to 2033; Dukovany unit 5 tender, 2024',
    },
  ],
}
