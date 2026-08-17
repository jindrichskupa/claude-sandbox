/**
 * One country, more than one date.
 *
 * The geography of Czechia does not change between 1995 and 2015, and neither do the sites: the
 * lignite is still in the Ohře valley, Dukovany is still out on the Moravian plateau, Opatovice
 * still heats two cities thirty kilometres apart. So the map, the nodes, the heat mains and the
 * shape of the load live here, and each dated scenario says what was standing on them, what it
 * owed, and who was in government.
 *
 * Split out when the second Czech date arrived rather than in advance, and for a specific reason:
 * two copies of a fifty-by-twenty-four character grid cannot be kept in step by hand. A correction
 * to the Krušné hory ridge has to reach both scenarios or the two describe different countries —
 * and the tests that check no node sits in water would go on passing while they did.
 *
 * What is *not* shared is anything a date can disagree about: the fleet, the money, the tariff,
 * the government, the objectives, the timeline, and the network — which grew between the two
 * dates and is therefore given as the network of 1995, for a later scenario to age and extend.
 */

import type { CitySpec, HeatPipeSpec, LineSpec, NodeSpec } from './types'

/**
 * The map, drawn rather than generated.
 *
 * A landlocked basin ringed by border mountains: the Krušné hory and Krkonoše along the north,
 * Šumava down the south-west, the Českomoravská vrchovina as the highland in the middle, the
 * Jeseníky and Beskydy in the east. The flat ground is where it is in life — the north Bohemian
 * lignite basin, the Elbe lowland, the Haná and the Ostrava basin — and the rivers are the
 * Vltava, the Elbe, the Ohře, the Morava and the Odra.
 *
 * The land runs about forty tiles west to east for the country's four hundred and ninety
 * kilometres, at twelve kilometres to the tile. Which also means the Ostrava corner really is
 * four hundred kilometres from the lignite, and the map will make the player feel it.
 */
export const CZECHIA_TERRAIN_ROWS = [
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
]

export const CZECHIA_MAP_WIDTH = 50
export const CZECHIA_MAP_HEIGHT = 24
export const CZECHIA_KM_PER_TILE = 12

/**
 * Every place either Czech scenario puts something.
 *
 * Shared even where only one date uses a site, because a node is a place and the places did not
 * move. A scenario that does not build on one simply never mentions it — an unused node is
 * cleaned up by `releaseSites` the first time it matters.
 */
export const CZECHIA_NODES: NodeSpec[] = [
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

  // The second reactor site. A hole in the ground in 1995 and two units by 2002, which is the
  // one thing about the Czech system that the two dated scenarios most disagree about.
  { id: 'n_temelin', kind: 'plant', x: 15, y: 18, name: 'Temelín' },

  // The backbone. Three switching stations, which is what turns a coalfield in the north-west
  // and a load in the north-east into one grid.
  { id: 'n_reporyje', kind: 'substation', x: 19, y: 12, name: 'Řeporyje' },
  { id: 'n_krasikov', kind: 'substation', x: 34, y: 13, name: 'Krasíkov' },
  { id: 'n_nosovice', kind: 'substation', x: 41, y: 15, name: 'Nošovice' },

  // ------------------------------------------------------------------------------------------
  // What the 2010 support scheme left behind. Empty in 1995, because in 1995 there was nothing
  // there — the first Czech utility-scale solar farm was built in 2009.
  //
  // Five sites rather than eight hundred: the real fleet is thousands of installations, and the
  // catalogue's unit is a 50 MW farm. These are the places it concentrated — the sunniest and
  // flattest ground in South Bohemia, Vysočina and South Moravia, the brownfields of the lignite
  // basin, and the belt around Prague.
  { id: 'n_pv_jih', kind: 'plant', x: 22, y: 16, name: 'Vepřek-jih' },
  { id: 'n_pv_vysocina', kind: 'plant', x: 29, y: 13, name: 'Vysočina' },
  { id: 'n_pv_morava', kind: 'plant', x: 34, y: 19, name: 'Dolní Morava' },
  { id: 'n_pv_basin', kind: 'plant', x: 13, y: 9, name: 'Podkrušnohoří' },
  { id: 'n_pv_stredni', kind: 'plant', x: 23, y: 12, name: 'Střední Čechy' },

  // And the wind, which in Czechia means the ridge of the Krušné hory and the exposed ground on
  // the Moravian highlands. Small, and on this map two sites.
  { id: 'n_wind_ridge', kind: 'plant', x: 12, y: 3, name: 'Kryštofovy Hamry' },
  { id: 'n_wind_vysocina', kind: 'plant', x: 30, y: 15, name: 'Věžnice' },
]

/**
 * The load, as thirteen regions.
 *
 * Split by population with an industrial weighting on top — Ostrava and the north-west consumed
 * far more per head than their population implies, because that is where the steel, the chemicals
 * and the smelting were, and Prague rather less. Heat is on for the six regions whose district
 * heating is fed by a station on this map; the other seven burned gas and coal in their own
 * cellars, as most of the country did.
 *
 * The numbers below are the 1995 ones. A later date scales them, because what changed between the
 * two dates is not the shape of Czech demand but its size, and in opposite directions for the two
 * commodities: electricity grew, and district heat fell as the buildings were insulated.
 */
const CZECHIA_LOAD_1995 = [
  { id: 'c_praha', nodeId: 'n_praha', name: 'Praha', population: 2320, mw: 469, heat: 190 },
  { id: 'c_usti', nodeId: 'n_usti', name: 'Ústí nad Labem', population: 826, mw: 255, heat: 130 },
  { id: 'c_kvary', nodeId: 'n_kvary', name: 'Karlovy Vary', population: 305, mw: 78, heat: 60 },
  { id: 'c_plzen', nodeId: 'n_plzen', name: 'Plzeň', population: 555, mw: 130, heat: 0 },
  { id: 'c_budejovice', nodeId: 'n_budejovice', name: 'České Budějovice', population: 700, mw: 134, heat: 0 },
  { id: 'c_liberec', nodeId: 'n_liberec', name: 'Liberec', population: 428, mw: 91, heat: 0 },
  { id: 'c_hradec', nodeId: 'n_hradec', name: 'Hradec Králové', population: 553, mw: 112, heat: 85 },
  { id: 'c_pardubice', nodeId: 'n_pardubice', name: 'Pardubice', population: 508, mw: 130, heat: 85 },
  { id: 'c_jihlava', nodeId: 'n_jihlava', name: 'Jihlava', population: 521, mw: 94, heat: 0 },
  { id: 'c_brno', nodeId: 'n_brno', name: 'Brno', population: 1130, mw: 240, heat: 0 },
  { id: 'c_olomouc', nodeId: 'n_olomouc', name: 'Olomouc', population: 645, mw: 124, heat: 0 },
  { id: 'c_zlin', nodeId: 'n_zlin', name: 'Zlín', population: 597, mw: 139, heat: 0 },
  { id: 'c_ostrava', nodeId: 'n_ostrava', name: 'Ostrava', population: 1290, mw: 440, heat: 190 },
] as const

/**
 * The thirteen regions at a given date, as multiples of 1995.
 *
 * Three scales rather than one, because the three moved differently and a single "growth" figure
 * would hide the interesting half of it: Czech electricity consumption rose about fourteen per
 * cent between 1995 and 2015, district heat deliveries *fell* by roughly a sixth as the housing
 * stock was insulated, and the population barely moved.
 */
export function czechiaCities(scale: { electric: number; heat: number; population: number }): CitySpec[] {
  return CZECHIA_LOAD_1995.map((c) => ({
    id: c.id,
    nodeId: c.nodeId,
    name: c.name,
    population: Math.round(c.population * scale.population),
    baseDemandMw: Math.round(c.mw * scale.electric),
    baseHeatDemandMwth: Math.round(c.heat * scale.heat),
  }))
}

/**
 * The heat network.
 *
 * Six regions on district heating, which is roughly the share of Czech households that were and
 * are. Opatovice is the interesting one and it is real: a single station out in the fields
 * feeding both Hradec Králové and Pardubice down mains long enough that the losses are a line
 * item rather than a rounding error.
 *
 * Unchanged between the two dates. Czech district heating mains were built once, in the sixties
 * and seventies, and are still the same pipes — the plants at the end of them have been rebuilt
 * repeatedly and the network has not.
 */
export const CZECHIA_HEAT_PIPES: HeatPipeSpec[] = [
  { id: 'h_malesice_praha', from: 'n_malesice', to: 'n_praha', dn: 700, pipes: 2 },
  { id: 'h_trmice_usti', from: 'n_trmice', to: 'n_usti', dn: 700, pipes: 1 },
  { id: 'h_tisova_kvary', from: 'n_tisova', to: 'n_kvary', dn: 400, pipes: 1 },
  { id: 'h_opatovice_hradec', from: 'n_opatovice', to: 'n_hradec', dn: 400, pipes: 1 },
  { id: 'h_opatovice_pardubice', from: 'n_opatovice', to: 'n_pardubice', dn: 400, pipes: 2 },
  { id: 'h_trebovice_ostrava', from: 'n_trebovice', to: 'n_ostrava', dn: 700, pipes: 2 },
]

/**
 * The 400 kV backbone and what hangs off it, as it stood in 1995.
 *
 * Built in the seventies and early eighties to get lignite from the north-west to the industry
 * in the north-east, which is precisely the corridor it still is. The 220 kV network beneath it
 * is older, and the regional 110 kV feeds are older still.
 *
 * A later scenario ages these and adds what was built in between — see `agedBy`.
 */
export const CZECHIA_LINES_1995: LineSpec[] = [
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
]

/**
 * The same corridors, some years later.
 *
 * Computed rather than written out again, and not to save typing: a hand-copied network with
 * every age raised by twenty is a second network, and the first correction to either would put
 * the two scenarios on different grids. `overrides` is where a corridor that was genuinely
 * rebuilt in between says so.
 */
export function agedBy(years: number, overrides: Partial<Record<string, Partial<LineSpec>>> = {}): LineSpec[] {
  return CZECHIA_LINES_1995.map((line) => ({ ...line, ageYears: line.ageYears + years, ...overrides[line.id] }))
}
