/**
 * The same country, twenty years on, at the point where the argument had already been had.
 *
 * Czechia in 2015. Temelín is finished and running. The solar boom of 2009-10 happened, was paid
 * for at four hundred and ninety euros a megawatt-hour, and was then levied retroactively. The
 * lignite basin is still there, still more than half the electricity, and every unit in it has now
 * been rebuilt once — which is the only reason it is still there. And the whole fleet is between
 * thirty and fifty-five years old, so the decade the 1995 scenario spends its last third
 * approaching, this one opens standing in.
 *
 * ## Why this date, when 1995 already exists
 *
 * Because 1995 answers a different question. There the interesting decisions — finish Temelín or
 * walk away, retrofit the basin or replace it — are all in the first ten years, and the collapse
 * they lead to is thirty-five years out. Measured on the clock rather than the calendar, a player
 * at fifty times real speed needs about forty-eight minutes to reach the year the lignite starts
 * dying. That is a long time to wait for the subject of the game.
 *
 * This scenario starts in the year the bill comes due. On day one the player owns a unit at
 * forty-nine, a unit at fifty-four, a heat network standing on plant from the fifties, a support
 * scheme that expires inside fifteen years, and a coal deadline that a government has not yet set
 * but will. Nothing here is a harder version of 1995; it is the same country with the easy part
 * already spent, which is a different game and not a longer one.
 *
 * ## What is real here and what is not
 *
 * The scale rule is the one 1995 set and it still binds: the fleet is the real one rounded to the
 * units the catalogue owns, at about half the country's size. Real Czechia in 2015 had about
 * 20.4 GW installed against a peak near 10.6; this is 10.8 GW against a peak near 5.4 — the same
 * two-to-one reserve margin on half the country. The proportions between the parts are kept, the
 * absolute size is not, and nothing read off this scenario is about how big the Czech system is.
 *
 * Two things about the ownership are worth saying plainly, because they flatter the player. Most
 * of the real Czech solar fleet was *not* owned by the utility that owned the coal, and the
 * feed-in tariff that made it profitable was paid by everybody else's bill. Here one company owns
 * the whole system, so it collects that tariff too. And the real windfall from the 2009-10 vintage
 * was cut by a 26% levy from 2011, which the `affordability` government in office at the start is
 * the position that does — the levy is in force on day one, not scheduled.
 *
 * ## What is not finished
 *
 * Two projects, both real and both in the same year. **Ledvice** is building a new 660 MW
 * supercritical unit — begun in 2008 for 2012, and it eventually started in 2017, which is what
 * nine-year overruns look like from inside. **Prunéřov II** is in pieces in the middle of the
 * comprehensive retrofit that ran from 2012 to 2016 and is the reason it is still running today.
 * Either can be walked away from; both cost money the player would rather spend on the fleet
 * that is about to die.
 *
 * ## Why it is hard
 *
 * Three clocks, all already running, and every date below is measured off the built fleet by
 * `scripts/fleetDates.ts` rather than chosen.
 *
 * The coal comes due between 2021 and 2043: Mělník in 2021, Ledvice's old unit in 2026, Počerady in
 * 2031, Tušimice in 2035, Dětmarovice in 2038, Chvaletice in 2039, Prunéřov II in 2043. Seven units
 * over twenty-two years, which is the real Czech coal exit window, arrived at from commissioning
 * dates and one overhaul each.
 *
 * The reactors are the second problem rather than the answer to the first. Dukovany's two units come
 * due in 2033 and 2036 — not the sixty years the datasheet quotes, because `designLifeFactor` gives
 * a machine the life its own vintage was built for, and a 1985 Soviet unit was designed for thirty
 * years and licensed on from there. That is the right answer and an uncomfortable one: the reactor
 * fleet expires in the same decade as half the coal.
 *
 * And the district heating plant, rebuilt twice and still made of 1950s steel, runs out between 2028
 * and 2042 — Třebovice first, Trmice last — while heat, unlike electricity, cannot be left
 * undelivered in February at any price.
 *
 * ## What it measures as, played
 *
 * All five archetypes to 2050, on the same seed (`scripts/cashLine.ts czechia-2015 <strategy> 2050`):
 *
 *     nuclear     0.76% unserved  0.273 t/MWh  10.3bn cash  3/5 objectives
 *     fossil      1.35%           0.448        30.2bn       2/5
 *     least-cost  3.93%           0.445        27.5bn       2/5
 *     green       5.70%           0.281        19.3bn       2/5
 *     novelty    11.52%           0.478        0, 7.2bn debt 2/5
 *
 * Two things to read off that, one good and one a defect elsewhere.
 *
 * The good one: **the pressure here is physical, not financial.** Every one of them loses, and every
 * one loses on the lights rather than on the money — the fleet dies faster than a crude planner
 * replaces it, and no amount of cash in the bank buys a reactor in under nine years. That is the
 * scenario working: 1995's bots mostly died insolvent, and starting in the year the bill comes due
 * moves the failure from the balance sheet to the system.
 *
 * The defect: four of the five end debt-free with between 10 and 30 billion, which no utility that
 * failed its brief should. That is not this scenario — it is the regulated tariff paying depreciation
 * on a modern-equivalent rate base out as free cash flow, in every scenario, and it is why the money
 * cannot be lost. Recorded here because a reader comparing these five numbers deserves to know which
 * of them is a finding about Czechia and which is a finding about `sim/economy/tariff.ts`.
 */

import { TEMPERATE_CLIMATE } from '../../sim/weather/weather'
import {
  agedBy,
  czechiaCities,
  CZECHIA_HEAT_PIPES,
  CZECHIA_KM_PER_TILE,
  CZECHIA_MAP_HEIGHT,
  CZECHIA_MAP_WIDTH,
  CZECHIA_NODES,
  CZECHIA_TERRAIN_ROWS,
} from './czechiaMap'
import type { ScenarioContent } from './types'

export const CZECHIA_2015: ScenarioContent = {
  id: 'czechia-2015',
  nameKey: 'scenario.czechia2015.name',
  descriptionKey: 'scenario.czechia2015.description',
  startYear: 2015,
  seed: 20150101,
  mapWidth: CZECHIA_MAP_WIDTH,
  mapHeight: CZECHIA_MAP_HEIGHT,
  kmPerTile: CZECHIA_KM_PER_TILE,

  /**
   * A large utility in the middle of a capital programme, and it shows in the debt.
   *
   * ČEZ carried net debt near CZK 154 bn at the end of 2015, against revenue around CZK 210 bn:
   * roughly one year of turnover. Halved with everything else, that is about €2.6 bn against a
   * €2.7 bn book — which is a company that can borrow, but not twice.
   */
  startingCash: 950_000_000,
  startingDebt: 2_600_000_000,
  /**
   * What a delivered megawatt-hour earned in 2015, not what it cost on the exchange.
   *
   * The wholesale price that year was near €32; a Czech household paid about €92 excluding VAT,
   * and the difference is the network, the levies and the regulated margin that this game's single
   * tariff rolls together. 105 is that figure at the model's own scale — the 1995 scenario's
   * regulated tariff reaches 107 by 2015 under the same cost trends, which is the check that the
   * two dates are describing one country and not two.
   */
  tariffPerMwh: 105,
  heatTariffPerMwh: 66,
  /** The ETS traded near €7.7 through 2015, four years into the surplus that the reserve fixed. */
  carbonPricePerTonne: 8,
  /**
   * The government of the solar levy, still.
   *
   * A better fit than it looks. 2015 is the year of the State Energy Policy, which is a
   * `clean_firm` document — reactors to half the mix, coal declining — but the policy in *force*
   * was the 26% levy on the 2009-10 photovoltaic vintage, a regulator cutting support as fast as
   * the law allowed, and a stated priority of the household bill. `affordability` is that, and the
   * timeline moves to `clean_firm` in 2019 when the carbon price made it true.
   */
  initialRegimeId: 'affordability',
  climate: TEMPERATE_CLIMATE,

  terrainRows: CZECHIA_TERRAIN_ROWS,
  nodes: CZECHIA_NODES,

  /**
   * The load, twenty years of two opposite trends later.
   *
   * Czech net electricity consumption rose from about 52 TWh in 1995 to 59 TWh in 2015, near
   * enough fourteen per cent. District heat deliveries fell about a sixth over the same period —
   * the same flats, insulated, with meters on the radiators. The population moved by two per cent.
   */
  cities: czechiaCities({ electric: 1.14, heat: 0.84, population: 1.02 }),

  /**
   * The fleet, at the real commissioning dates, with the overhauls that kept it alive.
   *
   * **One overhaul each on the surviving thermal fleet**, and that number is doing a lot of work,
   * so here is what it means. Between 1993 and 1998 ČEZ desulphurised the units it meant to keep
   * and closed the rest; several were then comprehensively rebuilt again in the 2000s and 2010s.
   * This game has one overhaul mechanism, which buys half the design life back and costs a third
   * of a new machine, so the count here is *how many overhauls' worth* of renewal a unit has had
   * rather than how many contracts were signed. One for the thermal units, because the substantive
   * job largely replaced what the earlier one had renewed; two for the district heating stations,
   * because a sixty-year-old backpressure set genuinely has been rebuilt around its turbine twice.
   *
   * What falls out of that was not chosen, and is not what one overhaul's arithmetic would suggest
   * either — a 45-year unit plus half again is 67 years, which would put a 1961 machine in 2028, and
   * the model says 2021. The difference is `designLifeFactor`: a plant gets the design life its own
   * vintage was built for, and the sixties built for less than the 2023 datasheet does. Run
   * `scripts/fleetDates.ts czechia-2015` for the list the simulation actually ages the fleet by.
   */
  plants: [
    // ---- Lignite. Six units on the basin, one of them in pieces. -----------------------------
    //
    // Prunéřov I is not here. ČEZ decided in 2010 not to retrofit it, and it closed in 2020 — by
    // 2015 it was a unit with a date on it, and a scenario that handed the player a machine the
    // real owner had already written off would be inventing an asset.
    {
      id: 'p_prunerov2',
      nodeId: 'n_prunerov',
      typeId: 'lignite',
      name: 'Prunéřov II',
      ageYears: 34,
      refurbishments: 1,
      // The comprehensive retrofit, 2012-2016: three units of 250 MW rebuilt in place. A year and
      // a half left to run on day one, and the expensive half of it still to pay.
      inProgress: { kind: 'refurbishing', yearsElapsed: 3, yearsRemaining: 1.5, costRemainingShare: 0.55 },
    },
    // Retrofitted 2007-2012 and good for another twenty years, which is why it is the youngest
    // thing in the basin despite being the second oldest.
    { id: 'p_tusimice', nodeId: 'n_tusimice', typeId: 'lignite', name: 'Tušimice II', ageYears: 41, refurbishments: 1 },
    { id: 'p_pocerady', nodeId: 'n_pocerady', typeId: 'lignite', name: 'Počerady', ageYears: 45, refurbishments: 1 },
    { id: 'p_ledvice2', nodeId: 'n_ledvice', typeId: 'lignite', name: 'Ledvice 2', ageYears: 49, refurbishments: 1 },
    // The new unit. Begun in 2008 against a 2012 date, still not finished in 2015, and eventually
    // synchronised in 2017 — a 660 MW supercritical set, the only new lignite unit built in the
    // country this century. Two years left and a quarter of the bill, which is what the last
    // stretch of a nine-year overrun costs.
    {
      id: 'p_ledvice4',
      nodeId: 'n_ledvice',
      typeId: 'lignite',
      name: 'Ledvice 4',
      ageYears: 0,
      inProgress: { kind: 'building', yearsElapsed: 7, yearsRemaining: 2, costRemainingShare: 0.25 },
    },
    // The oldest thing on the map that still generates, and the first to go.
    { id: 'p_melnik', nodeId: 'n_melnik', typeId: 'lignite', name: 'Mělník I', ageYears: 54, refurbishments: 1 },
    { id: 'p_chvaletice', nodeId: 'n_chvaletice', typeId: 'lignite', name: 'Chvaletice', ageYears: 38, refurbishments: 1 },

    // ---- Hard coal, at the far end of the country. -------------------------------------------
    { id: 'p_detmarovice', nodeId: 'n_detmarovice', typeId: 'coal', name: 'Dětmarovice', ageYears: 39, refurbishments: 1 },

    // ---- Gas. One station, and it barely ran. ------------------------------------------------
    //
    // The 840 MW combined cycle at Počerady, finished in 2013 and idle for most of its early life
    // because the spark spread did not cover its fuel. It is here because it is real and because
    // it is the cheapest lesson in the scenario: a modern, clean, flexible machine can be the
    // wrong investment, and the dispatch will say so every hour.
    { id: 'p_pocerady_ccgt', nodeId: 'n_pocerady', typeId: 'ccgt', name: 'Počerady paroplyn', ageYears: 2 },

    // ---- Nuclear. Three units, and the argument of 1995 settled. -----------------------------
    { id: 'p_dukovany1', nodeId: 'n_dukovany', typeId: 'nuclear', name: 'Dukovany 1', ageYears: 30 },
    { id: 'p_dukovany2', nodeId: 'n_dukovany', typeId: 'nuclear', name: 'Dukovany 2', ageYears: 28 },
    // Finished in 2002, fifteen years after the first concrete against a plan of six.
    { id: 'p_temelin1', nodeId: 'n_temelin', typeId: 'nuclear', name: 'Temelín 1', ageYears: 13 },

    // ---- Water. The part of the system that outlives everything else. ------------------------
    // All three modernised between the two dates — Orlík's turbines from 1994, Slapy and Lipno in
    // the 2000s. Without that on the record the model retires the Vltava cascade inside the run,
    // when in life its civil works will outlast every thermal station on this map.
    { id: 'p_orlik', nodeId: 'n_orlik', typeId: 'hydro', name: 'Orlík', ageYears: 54, refurbishments: 1 },
    { id: 'p_slapy', nodeId: 'n_slapy', typeId: 'hydro', name: 'Slapy', ageYears: 61, refurbishments: 1 },
    { id: 'p_lipno', nodeId: 'n_lipno', typeId: 'hydro', name: 'Lipno', ageYears: 56, refurbishments: 1 },
    { id: 'p_dalesice', nodeId: 'n_dalesice', typeId: 'pumped', name: 'Dalešice', ageYears: 37 },
    // Switched on in 1996, a year into the scenario that precedes this one.
    { id: 'p_dlouhestrane', nodeId: 'n_dlouhestrane', typeId: 'pumped', name: 'Dlouhé stráně', ageYears: 19 },

    // ---- What the support scheme built. ------------------------------------------------------
    //
    // Twenty farms of 50 MW: about a gigawatt, which is half of the 2.1 GW the country actually
    // had, on the same halving rule as everything else. Almost all of it commissioned in 2009 and
    // 2010 — that is not a simplification, it is what happened, because Act 180/2005 capped how
    // fast the regulator could cut the guaranteed price at five per cent a year while the price of
    // a panel was falling by forty.
    //
    // Every one of these carries a twenty-year contract from its commissioning year, so the fleet
    // comes off support between 2029 and 2031. Which lands, without anyone arranging it, in the
    // same window as the first three coal closures.
    { id: 'p_pv_jih_1', nodeId: 'n_pv_jih', typeId: 'solar', name: 'Vepřek-jih 1', ageYears: 6 },
    { id: 'p_pv_jih_2', nodeId: 'n_pv_jih', typeId: 'solar', name: 'Vepřek-jih 2', ageYears: 6 },
    { id: 'p_pv_jih_3', nodeId: 'n_pv_jih', typeId: 'solar', name: 'Vepřek-jih 3', ageYears: 5 },
    { id: 'p_pv_jih_4', nodeId: 'n_pv_jih', typeId: 'solar', name: 'Vepřek-jih 4', ageYears: 5 },
    { id: 'p_pv_vysocina_1', nodeId: 'n_pv_vysocina', typeId: 'solar', name: 'Vysočina 1', ageYears: 6 },
    { id: 'p_pv_vysocina_2', nodeId: 'n_pv_vysocina', typeId: 'solar', name: 'Vysočina 2', ageYears: 5 },
    { id: 'p_pv_vysocina_3', nodeId: 'n_pv_vysocina', typeId: 'solar', name: 'Vysočina 3', ageYears: 5 },
    { id: 'p_pv_vysocina_4', nodeId: 'n_pv_vysocina', typeId: 'solar', name: 'Vysočina 4', ageYears: 4 },
    { id: 'p_pv_morava_1', nodeId: 'n_pv_morava', typeId: 'solar', name: 'Dolní Morava 1', ageYears: 6 },
    { id: 'p_pv_morava_2', nodeId: 'n_pv_morava', typeId: 'solar', name: 'Dolní Morava 2', ageYears: 5 },
    { id: 'p_pv_morava_3', nodeId: 'n_pv_morava', typeId: 'solar', name: 'Dolní Morava 3', ageYears: 5 },
    { id: 'p_pv_morava_4', nodeId: 'n_pv_morava', typeId: 'solar', name: 'Dolní Morava 4', ageYears: 5 },
    { id: 'p_pv_basin_1', nodeId: 'n_pv_basin', typeId: 'solar', name: 'Podkrušnohoří 1', ageYears: 5 },
    { id: 'p_pv_basin_2', nodeId: 'n_pv_basin', typeId: 'solar', name: 'Podkrušnohoří 2', ageYears: 5 },
    { id: 'p_pv_basin_3', nodeId: 'n_pv_basin', typeId: 'solar', name: 'Podkrušnohoří 3', ageYears: 5 },
    { id: 'p_pv_basin_4', nodeId: 'n_pv_basin', typeId: 'solar', name: 'Podkrušnohoří 4', ageYears: 4 },
    { id: 'p_pv_stredni_1', nodeId: 'n_pv_stredni', typeId: 'solar', name: 'Střední Čechy 1', ageYears: 6 },
    { id: 'p_pv_stredni_2', nodeId: 'n_pv_stredni', typeId: 'solar', name: 'Střední Čechy 2', ageYears: 5 },
    { id: 'p_pv_stredni_3', nodeId: 'n_pv_stredni', typeId: 'solar', name: 'Střední Čechy 3', ageYears: 5 },
    { id: 'p_pv_stredni_4', nodeId: 'n_pv_stredni', typeId: 'solar', name: 'Střední Čechy 4', ageYears: 4 },

    // And the wind, which in Czechia is 280 MW in a system of twenty thousand — three farms here,
    // on the Krušné hory ridge and the exposed ground of the highlands. Small on purpose: this is
    // a landlocked country with a poor wind resource and a hostile permitting record, and a
    // scenario that gave it a North Sea would be arguing rather than describing.
    { id: 'p_wind_ridge_1', nodeId: 'n_wind_ridge', typeId: 'wind', name: 'Kryštofovy Hamry 1', ageYears: 8 },
    { id: 'p_wind_ridge_2', nodeId: 'n_wind_ridge', typeId: 'wind', name: 'Kryštofovy Hamry 2', ageYears: 7 },
    { id: 'p_wind_vysocina_1', nodeId: 'n_wind_vysocina', typeId: 'wind', name: 'Věžnice 1', ageYears: 6 },

    // ---- The heat network. Two overhauls each, and still made of 1950s steel. ----------------
    { id: 'p_malesice', nodeId: 'n_malesice', typeId: 'coal_chp', name: 'Praha-Malešice', ageYears: 50, refurbishments: 2 },
    { id: 'p_trmice', nodeId: 'n_trmice', typeId: 'coal_chp', name: 'Trmice', ageYears: 47, refurbishments: 2 },
    { id: 'p_tisova', nodeId: 'n_tisova', typeId: 'coal_chp', name: 'Tisová', ageYears: 57, refurbishments: 2 },
    { id: 'p_opatovice', nodeId: 'n_opatovice', typeId: 'coal_chp', name: 'Opatovice', ageYears: 55, refurbishments: 2 },
    { id: 'p_trebovice', nodeId: 'n_trebovice', typeId: 'coal_chp', name: 'Ostrava-Třebovice', ageYears: 59, refurbishments: 2 },

    // The peak boilers, and a different set from the ones in the 1995 scenario — which is the
    // point. A boiler has a thirty-year life and is simply replaced when it runs out, so a
    // utility's boiler fleet turns over twice in the time its turbine hall does not.
    { id: 'p_malesice_boiler_a', nodeId: 'n_malesice', typeId: 'heat_boiler', name: 'Malešice Boiler A', ageYears: 14 },
    { id: 'p_malesice_boiler_b', nodeId: 'n_malesice', typeId: 'heat_boiler', name: 'Malešice Boiler B', ageYears: 11 },
    { id: 'p_malesice_boiler_c', nodeId: 'n_malesice', typeId: 'heat_boiler', name: 'Malešice Boiler C', ageYears: 8 },
    { id: 'p_malesice_boiler_d', nodeId: 'n_malesice', typeId: 'heat_boiler', name: 'Malešice Boiler D', ageYears: 6 },
    { id: 'p_trmice_boiler_a', nodeId: 'n_trmice', typeId: 'heat_boiler', name: 'Trmice Boiler A', ageYears: 15 },
    { id: 'p_trmice_boiler_b', nodeId: 'n_trmice', typeId: 'heat_boiler', name: 'Trmice Boiler B', ageYears: 12 },
    { id: 'p_trmice_boiler_c', nodeId: 'n_trmice', typeId: 'heat_boiler', name: 'Trmice Boiler C', ageYears: 5 },
    { id: 'p_tisova_boiler', nodeId: 'n_tisova', typeId: 'heat_boiler', name: 'Tisová Boiler', ageYears: 16 },
    { id: 'p_opatovice_boiler_a', nodeId: 'n_opatovice', typeId: 'heat_boiler', name: 'Opatovice Boiler A', ageYears: 16 },
    { id: 'p_opatovice_boiler_b', nodeId: 'n_opatovice', typeId: 'heat_boiler', name: 'Opatovice Boiler B', ageYears: 11 },
    { id: 'p_trebovice_boiler_a', nodeId: 'n_trebovice', typeId: 'heat_boiler', name: 'Třebovice Boiler A', ageYears: 14 },
    { id: 'p_trebovice_boiler_b', nodeId: 'n_trebovice', typeId: 'heat_boiler', name: 'Třebovice Boiler B', ageYears: 13 },
    { id: 'p_trebovice_boiler_c', nodeId: 'n_trebovice', typeId: 'heat_boiler', name: 'Třebovice Boiler C', ageYears: 7 },
  ],

  /**
   * The network of 1995, twenty years older, with what was actually built in between.
   *
   * Three changes, and each is a real corridor rather than a balance adjustment:
   *
   * - **Krasíkov-Nošovice** doubled. The eastern leg of the backbone was reinforced through the
   *   2000s, because the whole Moravian-Silesian load hangs off it.
   * - **Olomouc-Ostrava** taken from 220 to 400 kV. ČEPS's programme of the period was exactly
   *   this: converting the old 220 kV Moravian corridors to 400 kV rather than building new ones.
   * - **Temelín-Budějovice** rebuilt. The station's outlet was completed for units that in 1995
   *   did not exist, so the corridor dates from the commissioning rather than from the eighties.
   *
   * The new solar and wind sites bring their own connections, all of them 110 kV, because that is
   * what a 200 MW cluster of farms is connected at.
   */
  lines: [
    ...agedBy(20, {
      l_krasikov_nosovice: { circuits: 2, ageYears: 12 },
      l_olomouc_ostrava: { kv: 400, ageYears: 9 },
      l_temelin_budejovice: { ageYears: 13 },
    }),
    { ageYears: 5, id: 'l_pv_jih_reporyje', from: 'n_pv_jih', to: 'n_reporyje', kv: 110, circuits: 2 },
    { ageYears: 5, id: 'l_pv_vysocina_krasikov', from: 'n_pv_vysocina', to: 'n_krasikov', kv: 110, circuits: 2 },
    { ageYears: 5, id: 'l_pv_morava_brno', from: 'n_pv_morava', to: 'n_brno', kv: 110, circuits: 2 },
    { ageYears: 5, id: 'l_pv_basin_prunerov', from: 'n_pv_basin', to: 'n_prunerov', kv: 110, circuits: 2 },
    { ageYears: 5, id: 'l_pv_stredni_praha', from: 'n_pv_stredni', to: 'n_praha', kv: 110, circuits: 2 },
    { ageYears: 8, id: 'l_wind_ridge_prunerov', from: 'n_wind_ridge', to: 'n_prunerov', kv: 110, circuits: 1 },
    { ageYears: 6, id: 'l_wind_vysocina_dukovany', from: 'n_wind_vysocina', to: 'n_dukovany', kv: 110, circuits: 1 },
  ],

  heatPipes: CZECHIA_HEAT_PIPES,

  /**
   * The guaranteed prices the inherited renewables are on, and they are enormous.
   *
   * The 2010 Czech feed-in tariff for a ground-mounted photovoltaic plant was CZK 12,150 per
   * megawatt-hour — about €490 at the exchange rate of the day, against a wholesale price near
   * €45. That is the number, it is not a typo, and it is the single most consequential fact about
   * Czech energy policy in this century: it produced 2 GW of solar in eighteen months, a levy that
   * broke the state's word to its own investors, and a decade of expensive capital afterwards.
   *
   * Wind was supported at about a fifth of that, which is why there is almost none.
   *
   * `buildWorld` writes these as twenty-year contracts from each plant's commissioning, so this
   * fleet's support ends between 2029 and 2031 — and a later government can tear them up sooner.
   * The `affordability` government in office at the start does not honour its predecessors'
   * contracts, which is not a coincidence: it is the one that levied them in 2011.
   */
  feedInTariffs: {
    solar: 490,
    wind: 88,
  },

  /**
   * Thirty-five years, ending where the 1995 scenario ends.
   *
   * The same horizon on purpose: the two dates are then directly comparable, and the question
   * "does starting later make this easier or only shorter?" has an answer rather than an excuse.
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
      // A capacity floor, met by whatever the player likes — including new lignite, if they can
      // keep it legal and paid for. What it rules out is arriving in 2050 having let a fleet die
      // without replacing it, which is the failure this starting position invites.
      condition: { kind: 'capacityAtLeast', mw: 6500 },
      timing: 'atEnd',
      required: true,
    },
    {
      id: 'cleaner-than-inherited',
      descriptionKey: 'objective.cleanerThanInherited',
      // The inherited system runs near 0.45 t/MWh — cleaner than 1995's 0.6, because Temelín and
      // the solar fleet are already in it. So the optional target is correspondingly harder, and
      // it is optional: there are several ways to reach it and no way the scenario prefers.
      condition: { kind: 'carbonIntensityBelow', tPerMwh: 0.15 },
      timing: 'atEnd',
      required: false,
    },
  ],

  /**
   * What happened anyway, between 2015 and 2025.
   *
   * The same record as the 1995 scenario carries for these years, because it is the same decade:
   * the drought, the carbon price coming back with a date attached, gas climbing through 2021, the
   * invasion and the security turn that followed it, and then the coal deadline moving forward in
   * the same year as the reactor tender.
   *
   * **It stops in 2025, and that is deliberate.** Past the present there is no record to be
   * faithful to, and a scenario that scheduled the 2030s would be authoring difficulty and calling
   * it history. From 2025 the politics is entirely emergent: elections read the price, the
   * blackouts, the emissions and the import exposure, and the player's own record decides who
   * governs for the remaining twenty-five years — which are the years that matter here.
   */
  timeline: [
    {
      // The 2015 drought lands in the scenario's own first year, which is a hard opening and a
      // real one: river flows and cooling water went together that summer.
      year: 2015,
      eventId: 'drought',
      headlineKey: 'history.cz.drought',
      source: 'Czech drought of 2015; Vltava and Elbe flows at record lows',
    },
    {
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
      year: 2024,
      regimeId: 'clean_firm',
      headlineKey: 'history.cz.coalDeadline',
      source: 'Czech coal phase-out target brought forward to 2033; Dukovany unit 5 tender, 2024',
    },
  ],
}
