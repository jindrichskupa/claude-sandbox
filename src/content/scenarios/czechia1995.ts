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
 * Two more honest departures. **Dlouhé stráně** was commissioned in 1996, not 1995, and is here
 * at zero years old — a year early, because a scenario about Czech flexibility without its
 * pumped storage would be a stranger distortion than a twelve-month one. **Temelín is absent**,
 * and that is the point: in 1995 it was eight years into construction, four years from its
 * original commissioning date, and the argument over whether to finish it was the loudest thing
 * in Czech energy. The scenario hands the player the empty site and the same decision.
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
import type { ScenarioContent } from './types'

export const CZECHIA_1995: ScenarioContent = {
  id: 'czechia-1995',
  nameKey: 'scenario.czechia1995.name',
  descriptionKey: 'scenario.czechia1995.description',
  startYear: 1995,
  seed: 19950101,
  mapWidth: 50,
  mapHeight: 24,
  // The land runs about forty tiles west to east for the country's four hundred and ninety
  // kilometres. Which also means the Ostrava corner really is four hundred kilometres from the
  // lignite, and the map will make the player feel it.
  kmPerTile: 12,
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

  /**
   * The map, drawn rather than generated.
   *
   * A landlocked basin ringed by border mountains: the Krušné hory and Krkonoše along the north,
   * Šumava down the south-west, the Českomoravská vrchovina as the highland in the middle, the
   * Jeseníky and Beskydy in the east. The flat ground is where it is in life — the north Bohemian
   * lignite basin, the Elbe lowland, the Haná and the Ostrava basin — and the rivers are the
   * Vltava, the Elbe, the Ohře, the Morava and the Odra.
   */
  terrainRows: [
    'MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM',
    'MMMMMMMMMMMMMMMMMHMMMMMhhMMMMMMMMMMMMMMMMMMMMMMMMM',
    'MMMMMMMMMMMMMMMhhHhhhhhhhhHhMMMMMMMMMMMMMMMMMMMMMM',
    'MMMMMMMMMMMhhhhhfFffffffffFhhhhhhhhhMMMMMMMMMMMMMM',
    'MMMMMMMMMMMhfffff,........fFfffffffhhhMMMMMMMMMMMM',
    'MMMMMMMMMMhhf.....,........,......fffhhhMMMMMMMMMM',
    'MMMMMMMMhhHFF,,,,,,,,.......,.......ffFhhhhhHMMMMM',
    'MMMMMMhhHFff.........,,,....,.........FffffHhMMMMM',
    'MMMMMMhfff...........,..,,.,.......f..,...FfhMMMMM',
    'MMMMMMhff...........,.....,.......fff.,..FfhhMMMMM',
    'MMMMMMhhff..........,............ffhff,.ffhhMMMMMM',
    'MMMMMMMhhf.........,.........ffffffff.,.fhhMMMMMMM',
    'MMMMMMMMhff........,......ffffffffff..,.fhMMMMMMMM',
    'MMMMMMMMhhf.......,.....ffffhhhffff..,..fhMMMMMMMM',
    'MMMMMMMMMhff......,....ffffhhhhhfff..,..fhMMMMMMMM',
    'MMMMMMMMMhhf.....,....ffffffhhhfff...,..fhhMMMMMMM',
    'MMMMMMMMMMhff....,....fffffffffff...,...ffhMMMMMMM',
    'MMMMMMMMMMhhff..,.....ffffffffff....,..ffhhMMMMMMM',
    'MMMMMMMMMMMhhff,.......ffffffff.....,.ffhhMMMMMMMM',
    'MMMMMMMMMMMMhhFfff......f.....,,,,..,.fhhMMMMMMMMM',
    'MMMMMMMMMMMMMHhhhfffffffffff......,.FffhMMMMMMMMMM',
    'MMMMMMMMMMMMMHMMhhhhhhhhhhhfffff...FfhhhMMMMMMMMMM',
    'MMMMMMMMMMMMMMMMMMMMMMMMMMhhhhhffffFhhMMMMMMMMMMMM',
    'MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMhhhfhhhMMMMMMMMMMMMM',
  ],

  nodes: [
    // The thirteen load points. Each is a region rather than a town: Prague here is Prague and
    // the ring around it, Ostrava is the whole Moravian-Silesian industrial belt.
    { id: 'n_praha', kind: 'city', x: 20, y: 10, name: 'Praha' },
    { id: 'n_usti', kind: 'city', x: 17, y: 5, name: 'Ústí nad Labem' },
    { id: 'n_kvary', kind: 'city', x: 10, y: 9, name: 'Karlovy Vary' },
    { id: 'n_plzen', kind: 'city', x: 13, y: 13, name: 'Plzeň' },
    { id: 'n_budejovice', kind: 'city', x: 20, y: 19, name: 'České Budějovice' },
    { id: 'n_liberec', kind: 'city', x: 23, y: 4, name: 'Liberec' },
    { id: 'n_hradec', kind: 'city', x: 27, y: 9, name: 'Hradec Králové' },
    { id: 'n_pardubice', kind: 'city', x: 26, y: 12, name: 'Pardubice' },
    { id: 'n_jihlava', kind: 'city', x: 26, y: 17, name: 'Jihlava' },
    { id: 'n_brno', kind: 'city', x: 32, y: 18, name: 'Brno' },
    { id: 'n_olomouc', kind: 'city', x: 36, y: 14, name: 'Olomouc' },
    { id: 'n_zlin', kind: 'city', x: 38, y: 18, name: 'Zlín' },
    { id: 'n_ostrava', kind: 'city', x: 40, y: 13, name: 'Ostrava' },

    // The lignite basin under the Krušné hory. Six stations inside sixty kilometres of each
    // other, all burning fuel that comes out of the ground beside them, and between them more
    // than half the country's electricity.
    { id: 'n_prunerov', kind: 'plant', x: 12, y: 7, name: 'Prunéřov' },
    { id: 'n_tusimice', kind: 'plant', x: 14, y: 7, name: 'Tušimice' },
    { id: 'n_pocerady', kind: 'plant', x: 17, y: 7, name: 'Počerady' },
    { id: 'n_ledvice', kind: 'plant', x: 15, y: 6, name: 'Ledvice' },
    // Down the Elbe from the basin, on rail-hauled lignite rather than a conveyor.
    { id: 'n_melnik', kind: 'plant', x: 21, y: 7, name: 'Mělník' },
    { id: 'n_chvaletice', kind: 'plant', x: 25, y: 10, name: 'Chvaletice' },
    // Hard coal, at the far end of the country, on the Ostrava coalfield.
    { id: 'n_detmarovice', kind: 'plant', x: 41, y: 11, name: 'Dětmarovice' },

    // The heating plants. Every one of these sits inside or beside the city it heats, because a
    // hot-water main is not a transmission line and thirty kilometres is already a long one.
    { id: 'n_malesice', kind: 'plant', x: 21, y: 10, name: 'Praha-Malešice' },
    { id: 'n_trmice', kind: 'plant', x: 18, y: 6, name: 'Trmice' },
    { id: 'n_tisova', kind: 'plant', x: 10, y: 10, name: 'Tisová' },
    { id: 'n_opatovice', kind: 'plant', x: 28, y: 10, name: 'Opatovice' },
    { id: 'n_trebovice', kind: 'plant', x: 40, y: 11, name: 'Ostrava-Třebovice' },

    // The reactor, out on the plateau, with its pumped storage three tiles away — which is not a
    // coincidence in life either.
    { id: 'n_dukovany', kind: 'plant', x: 30, y: 19, name: 'Dukovany' },
    { id: 'n_dalesice', kind: 'plant', x: 28, y: 17, name: 'Dalešice' },
    { id: 'n_dlouhestrane', kind: 'plant', x: 35, y: 10, name: 'Dlouhé stráně' },

    // The Vltava cascade, from the Šumava border down to Prague.
    { id: 'n_lipno', kind: 'plant', x: 14, y: 19, name: 'Lipno' },
    { id: 'n_orlik', kind: 'plant', x: 17, y: 16, name: 'Orlík' },
    { id: 'n_slapy', kind: 'plant', x: 18, y: 14, name: 'Slapy' },

    // The empty site. Eight years of construction and no unit; whether it is ever finished is the
    // player's decision rather than the scenario's.
    { id: 'n_temelin', kind: 'substation', x: 15, y: 18, name: 'Temelín', kvLevels: [400] },

    // The backbone. Three switching stations, which is what turns a coalfield in the north-west
    // and a load in the north-east into one grid.
    { id: 'n_reporyje', kind: 'substation', x: 19, y: 12, name: 'Řeporyje' },
    { id: 'n_krasikov', kind: 'substation', x: 34, y: 13, name: 'Krasíkov' },
    { id: 'n_nosovice', kind: 'substation', x: 41, y: 15, name: 'Nošovice' },
  ],

  /**
   * Thirteen regions, about 2.44 GW of base load between them, which peaks near 4.8.
   *
   * Split by 1995 population with an industrial weighting on top — Ostrava and the north-west
   * consumed far more per head than their population implies, because that is where the steel,
   * the chemicals and the smelting were, and Prague rather less. Heat is on for the six regions
   * whose district heating is fed by a station on this map; the other seven burned gas and coal
   * in their own cellars, as most of the country did.
   */
  cities: [
    {
      id: 'c_praha',
      nodeId: 'n_praha',
      name: 'Praha',
      population: 2320,
      baseDemandMw: 469,
      baseHeatDemandMwth: 190,
    },
    {
      id: 'c_usti',
      nodeId: 'n_usti',
      name: 'Ústí nad Labem',
      population: 826,
      baseDemandMw: 255,
      baseHeatDemandMwth: 130,
    },
    {
      id: 'c_kvary',
      nodeId: 'n_kvary',
      name: 'Karlovy Vary',
      population: 305,
      baseDemandMw: 78,
      baseHeatDemandMwth: 60,
    },
    {
      id: 'c_plzen',
      nodeId: 'n_plzen',
      name: 'Plzeň',
      population: 555,
      baseDemandMw: 130,
      baseHeatDemandMwth: 0,
    },
    {
      id: 'c_budejovice',
      nodeId: 'n_budejovice',
      name: 'České Budějovice',
      population: 700,
      baseDemandMw: 134,
      baseHeatDemandMwth: 0,
    },
    {
      id: 'c_liberec',
      nodeId: 'n_liberec',
      name: 'Liberec',
      population: 428,
      baseDemandMw: 91,
      baseHeatDemandMwth: 0,
    },
    {
      id: 'c_hradec',
      nodeId: 'n_hradec',
      name: 'Hradec Králové',
      population: 553,
      baseDemandMw: 112,
      baseHeatDemandMwth: 85,
    },
    {
      id: 'c_pardubice',
      nodeId: 'n_pardubice',
      name: 'Pardubice',
      population: 508,
      baseDemandMw: 130,
      baseHeatDemandMwth: 85,
    },
    {
      id: 'c_jihlava',
      nodeId: 'n_jihlava',
      name: 'Jihlava',
      population: 521,
      baseDemandMw: 94,
      baseHeatDemandMwth: 0,
    },
    {
      id: 'c_brno',
      nodeId: 'n_brno',
      name: 'Brno',
      population: 1130,
      baseDemandMw: 240,
      baseHeatDemandMwth: 0,
    },
    {
      id: 'c_olomouc',
      nodeId: 'n_olomouc',
      name: 'Olomouc',
      population: 645,
      baseDemandMw: 124,
      baseHeatDemandMwth: 0,
    },
    {
      id: 'c_zlin',
      nodeId: 'n_zlin',
      name: 'Zlín',
      population: 597,
      baseDemandMw: 139,
      baseHeatDemandMwth: 0,
    },
    {
      id: 'c_ostrava',
      nodeId: 'n_ostrava',
      name: 'Ostrava',
      population: 1290,
      baseDemandMw: 440,
      baseHeatDemandMwth: 190,
    },
  ],

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
    { id: 'p_tusimice', nodeId: 'n_tusimice', typeId: 'lignite', name: 'Tušimice II', ageYears: 21 },
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
    { id: 'p_dlouhestrane', nodeId: 'n_dlouhestrane', typeId: 'pumped', name: 'Dlouhé stráně', ageYears: 0 },

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

  /**
   * The 400 kV backbone and what hangs off it.
   *
   * Built in the seventies and early eighties to get lignite from the north-west to the industry
   * in the north-east, which is precisely the corridor it still is. The 220 kV network beneath it
   * is older, and the regional 110 kV feeds are older still.
   */
  lines: [
    // The western coalfield onto the backbone.
    { ageYears: 24, id: 'l_prunerov_reporyje', from: 'n_prunerov', to: 'n_reporyje', kv: 400, circuits: 2 },
    { ageYears: 21, id: 'l_pocerady_reporyje', from: 'n_pocerady', to: 'n_reporyje', kv: 400, circuits: 1 },
    { ageYears: 30, id: 'l_melnik_reporyje', from: 'n_melnik', to: 'n_reporyje', kv: 400, circuits: 2 },
    { ageYears: 26, id: 'l_prunerov_tusimice', from: 'n_prunerov', to: 'n_tusimice', kv: 220, circuits: 1 },
    { ageYears: 28, id: 'l_ledvice_usti', from: 'n_ledvice', to: 'n_usti', kv: 220, circuits: 2 },
    { ageYears: 27, id: 'l_trmice_usti', from: 'n_trmice', to: 'n_usti', kv: 110, circuits: 1 },
    { ageYears: 33, id: 'l_tisova_kvary', from: 'n_tisova', to: 'n_kvary', kv: 110, circuits: 2 },
    { ageYears: 31, id: 'l_kvary_prunerov', from: 'n_kvary', to: 'n_prunerov', kv: 220, circuits: 1 },
    { ageYears: 29, id: 'l_tisova_plzen', from: 'n_tisova', to: 'n_plzen', kv: 220, circuits: 1 },

    // Prague and the middle.
    { ageYears: 20, id: 'l_reporyje_praha', from: 'n_reporyje', to: 'n_praha', kv: 400, circuits: 2 },
    { ageYears: 34, id: 'l_malesice_praha', from: 'n_malesice', to: 'n_praha', kv: 110, circuits: 2 },
    { ageYears: 32, id: 'l_reporyje_plzen', from: 'n_reporyje', to: 'n_plzen', kv: 220, circuits: 1 },
    { ageYears: 38, id: 'l_slapy_reporyje', from: 'n_slapy', to: 'n_reporyje', kv: 110, circuits: 1 },
    { ageYears: 34, id: 'l_orlik_slapy', from: 'n_orlik', to: 'n_slapy', kv: 220, circuits: 1 },
    { ageYears: 34, id: 'l_orlik_budejovice', from: 'n_orlik', to: 'n_budejovice', kv: 220, circuits: 1 },
    { ageYears: 36, id: 'l_lipno_budejovice', from: 'n_lipno', to: 'n_budejovice', kv: 110, circuits: 1 },
    // The 400 kV compound at Temelín, waiting for a unit that does not exist. Strung to the
    // backbone in the eighties on the assumption the station would be finished in 1991.
    { ageYears: 12, id: 'l_temelin_reporyje', from: 'n_temelin', to: 'n_reporyje', kv: 400, circuits: 2 },
    { ageYears: 12, id: 'l_temelin_budejovice', from: 'n_temelin', to: 'n_budejovice', kv: 220, circuits: 1 },

    // The north-east corridor: the reason the backbone exists.
    { ageYears: 22, id: 'l_reporyje_chvaletice', from: 'n_reporyje', to: 'n_chvaletice', kv: 400, circuits: 1 },
    { ageYears: 22, id: 'l_chvaletice_opatovice', from: 'n_chvaletice', to: 'n_opatovice', kv: 400, circuits: 1 },
    { ageYears: 22, id: 'l_opatovice_krasikov', from: 'n_opatovice', to: 'n_krasikov', kv: 400, circuits: 1 },
    { ageYears: 20, id: 'l_krasikov_nosovice', from: 'n_krasikov', to: 'n_nosovice', kv: 400, circuits: 1 },
    { ageYears: 20, id: 'l_detmarovice_nosovice', from: 'n_detmarovice', to: 'n_nosovice', kv: 400, circuits: 2 },
    { ageYears: 33, id: 'l_opatovice_hradec', from: 'n_opatovice', to: 'n_hradec', kv: 220, circuits: 2 },
    { ageYears: 28, id: 'l_chvaletice_hradec', from: 'n_chvaletice', to: 'n_hradec', kv: 220, circuits: 1 },
    { ageYears: 33, id: 'l_opatovice_pardubice', from: 'n_opatovice', to: 'n_pardubice', kv: 110, circuits: 2 },
    { ageYears: 30, id: 'l_chvaletice_pardubice', from: 'n_chvaletice', to: 'n_pardubice', kv: 110, circuits: 2 },
    { ageYears: 35, id: 'l_hradec_liberec', from: 'n_hradec', to: 'n_liberec', kv: 220, circuits: 1 },
    // The northern rim, which is what stops the corner behind the Krkonoše from being fed down
    // one line through the middle of the country. Both of these are real corridors: the long
    // 400 kV from the coalfield, and the older 220 kV along the Elbe.
    { ageYears: 19, id: 'l_ledvice_liberec', from: 'n_ledvice', to: 'n_liberec', kv: 400, circuits: 1 },
    { ageYears: 30, id: 'l_usti_liberec', from: 'n_usti', to: 'n_liberec', kv: 220, circuits: 1 },
    { ageYears: 26, id: 'l_krasikov_olomouc', from: 'n_krasikov', to: 'n_olomouc', kv: 220, circuits: 2 },
    { ageYears: 18, id: 'l_dlouhestrane_krasikov', from: 'n_dlouhestrane', to: 'n_krasikov', kv: 400, circuits: 1 },
    { ageYears: 24, id: 'l_nosovice_ostrava', from: 'n_nosovice', to: 'n_ostrava', kv: 400, circuits: 2 },
    { ageYears: 34, id: 'l_trebovice_ostrava', from: 'n_trebovice', to: 'n_ostrava', kv: 110, circuits: 2 },
    // The second way into the Ostrava basin, up the Morava valley. Without it the whole
    // industrial east hangs on one corridor, which measured as twenty islanded hours in the
    // first year alone.
    { ageYears: 25, id: 'l_olomouc_ostrava', from: 'n_olomouc', to: 'n_ostrava', kv: 220, circuits: 1 },

    // Moravia and the plateau. The reactor feeds Brno and the backbone; Dalešice hangs off it,
    // which is how it was built.
    { ageYears: 11, id: 'l_dukovany_brno', from: 'n_dukovany', to: 'n_brno', kv: 400, circuits: 2 },
    { ageYears: 11, id: 'l_dukovany_reporyje', from: 'n_dukovany', to: 'n_reporyje', kv: 400, circuits: 1 },
    { ageYears: 17, id: 'l_dalesice_dukovany', from: 'n_dalesice', to: 'n_dukovany', kv: 400, circuits: 1 },
    { ageYears: 30, id: 'l_dukovany_jihlava', from: 'n_dukovany', to: 'n_jihlava', kv: 110, circuits: 1 },
    { ageYears: 28, id: 'l_jihlava_reporyje', from: 'n_jihlava', to: 'n_reporyje', kv: 220, circuits: 1 },
    { ageYears: 24, id: 'l_brno_krasikov', from: 'n_brno', to: 'n_krasikov', kv: 400, circuits: 1 },
    { ageYears: 29, id: 'l_brno_zlin', from: 'n_brno', to: 'n_zlin', kv: 220, circuits: 1 },
    { ageYears: 27, id: 'l_zlin_nosovice', from: 'n_zlin', to: 'n_nosovice', kv: 220, circuits: 1 },
    { ageYears: 31, id: 'l_olomouc_zlin', from: 'n_olomouc', to: 'n_zlin', kv: 110, circuits: 1 },
  ],

  /**
   * The heat network.
   *
   * Six regions on district heating, which is roughly the share of Czech households that were and
   * are. Opatovice is the interesting one and it is real: a single station out in the fields
   * feeding both Hradec Králové and Pardubice down mains long enough that the losses are a line
   * item rather than a rounding error.
   */
  heatPipes: [
    { id: 'h_malesice_praha', from: 'n_malesice', to: 'n_praha', dn: 700, pipes: 2 },
    { id: 'h_trmice_usti', from: 'n_trmice', to: 'n_usti', dn: 700, pipes: 1 },
    { id: 'h_tisova_kvary', from: 'n_tisova', to: 'n_kvary', dn: 400, pipes: 1 },
    { id: 'h_opatovice_hradec', from: 'n_opatovice', to: 'n_hradec', dn: 400, pipes: 1 },
    { id: 'h_opatovice_pardubice', from: 'n_opatovice', to: 'n_pardubice', dn: 400, pipes: 2 },
    { id: 'h_trebovice_ostrava', from: 'n_trebovice', to: 'n_ostrava', dn: 700, pipes: 2 },
  ],

  // Thirty years. Long enough that the whole lignite fleet reaches the end of its design life
  // inside the run, short enough that it is one utility's problem rather than three.
  endYear: 2025,

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
}
