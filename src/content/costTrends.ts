/**
 * How prices move with time.
 *
 * Until now every figure in this game was frozen at the year its source published it, so a
 * station built in 2035 cost what a 2020 report said it cost. That is wrong in a way that
 * matters more than it sounds, because the *whole* of the interesting history of the electricity
 * sector over the last thirty years is a cost story, and a simulation that holds costs still
 * cannot tell it.
 *
 * The temptation is a single "things get cheaper" dial. That would be worse than nothing: it
 * would teach the player something false. The forces here move in **opposite directions** and
 * land on **different technologies by different amounts**, and the divergence between them is
 * the entire phenomenon.
 *
 * Four forces, all real, none of them a balance knob:
 *
 * 1. **Inflation** moves every price nominally and nothing really. Its home is already in the
 *    content: `Sourced<T>` carries the year each figure refers to, so a 2020 IEA capital cost
 *    and a 2022 EIA one are not the same money. Carrying each figure from its own `sourceYear`
 *    to the game year is well defined and needs no new data. That the provenance system turns
 *    out to be exactly the machinery an inflation model requires is a happy accident of having
 *    insisted on provenance from the first commit.
 *
 * 2. **Capital cost is not one thing.** Split it into equipment, labour, and civil works and
 *    land, and those three then move differently:
 *
 *      - **Equipment falls** in real terms with cumulative deployment — the learning curve
 *        proper, driven by megawatts built rather than years elapsed.
 *      - **Labour rises** faster than general inflation, as skilled construction labour does,
 *        and learns back only as fast as the installation is repeatable.
 *      - **Land and civil works rise** too, and for most technologies barely learn at all: a
 *        cubic metre of concrete poured on a difficult site in 2040 is not cheaper than one
 *        poured in 2000.
 *
 *    The consequence is the thing this game could not previously produce, and it is emphatically
 *    not a balance choice: an equipment-dominated technology deployed at enormous scale gets
 *    radically cheaper, while a civil-and-labour-dominated one built a handful of times gets
 *    *more expensive in real terms*. That is the actual divergence between photovoltaics and new
 *    nuclear over the last twenty years, and here it falls out of the cost structure rather than
 *    being asserted about either technology.
 *
 * 3. **Progress makes a machine better and dearer.** A turbine built ten years later is more
 *    efficient, cleaner and longer-lived, and it costs more per kilowatt for exactly those
 *    reasons. This is the force most often left out, and leaving it out produces the fantasy
 *    where everything improves and nothing costs anything.
 *
 * 4. **Standardisation** cuts cost and build time for repeated builds of the same type, which
 *    rewards a coherent programme over a zoo of one-offs. Unlike learning, this one *is* driven
 *    by the player's own deployment, because it is about their supply chain and their crews.
 *
 * ## Why learning is driven by an exogenous path
 *
 * Learning is a function of cumulative deployment **worldwide**, and the player's region is a
 * rounding error in that. Driving it off `state.cumulativeDeployedMw` alone would be both wrong
 * and a thumb on the scale of the worst kind: whatever the player happened to build first would
 * become the cheapest thing to keep building, and the game would quietly reward the first guess
 * rather than the best answer. So the world deploys on its own, from published trajectories, and
 * the player's own megawatts are added to that total — where they are visible in the arithmetic
 * and negligible in the result, which is the truth.
 */

import { sourced, type Sourced } from './schema'
import type { PlantTypeId } from './plantTypes'

/**
 * Economy-wide price trends.
 *
 * Real escalation rates are *above* general inflation, so labour at 2.1% general plus 0.8% real
 * rises about 2.9% a year in nominal terms.
 */
export interface PriceTrendsDef {
  /** General consumer price inflation. Everything nominal moves at least this fast. */
  generalInflationPerYear: Sourced<number>
  /**
   * Skilled construction labour, above general inflation.
   *
   * Positive because it has been, persistently, in every industrialised economy: construction
   * productivity growth is close to zero while wages track the wider economy, so the real cost
   * of putting a thing together goes up.
   */
  labourRealGrowthPerYear: Sourced<number>
  /** Land, civil works and grid connection, above general inflation. */
  civilRealGrowthPerYear: Sourced<number>
  /**
   * Real growth in fuel prices, before the per-fuel political index on top.
   *
   * Near zero, and deliberately so: over thirty years fossil fuel prices have been dominated by
   * cycles and shocks rather than by trend, and both of those are already modelled — the
   * mean-reverting per-fuel index in `policy/regime.ts` and the geopolitical events. Adding a
   * trend on top would be counting the same thing twice.
   */
  fuelRealGrowthPerYear: Sourced<number>
}

export const PRICE_TRENDS: PriceTrendsDef = {
  generalInflationPerYear: sourced(0.021, 'fraction', 'iea-weo', 2023, 'Long-run euro-area average; the ECB target is 2%'),
  labourRealGrowthPerYear: sourced(
    0.008,
    'fraction',
    'eia-electricity',
    2022,
    'Construction labour indices persistently outrun CPI, as productivity growth is near zero',
  ),
  civilRealGrowthPerYear: sourced(
    0.005,
    'fraction',
    'eia-electricity',
    2022,
    'Concrete, steelwork, land and grid connection; no learning curve worth the name',
  ),
  fuelRealGrowthPerYear: sourced(0, 'fraction', 'iea-weo', 2023, 'Cycles and shocks dominate the trend; both are modelled separately'),
}

/**
 * What a technology's capital cost is actually made of.
 *
 * The three shares must sum to one, which `tests/content.test.ts` checks — a split that does not
 * add up would silently rescale that technology's whole capital cost.
 *
 * These are the most consequential numbers added in this milestone, because the divergence
 * between technologies comes out of them rather than out of any per-technology assertion. A
 * reader who disagrees with the split should disagree with it here, where it is visible, rather
 * than with a cost curve somewhere downstream.
 */
export interface CostStructureDef {
  /** Factory-built plant: turbines, modules, cells, transformers. Learns fastest. */
  equipment: Sourced<number>
  /** Site labour: erection, commissioning, project management. Escalates, and learns slowly. */
  labour: Sourced<number>
  /** Land, groundworks, concrete, grid connection. Escalates, and barely learns at all. */
  civil: Sourced<number>
}

/** How fast the equipment share falls, and how fast the world is building the technology. */
export interface LearningDef {
  /**
   * Fractional cost reduction in the equipment share per doubling of cumulative deployment.
   * A learning rate of 0.20 means each doubling takes 20% off.
   */
  ratePerDoubling: Sourced<number>
  /**
   * The same, for the labour and civil shares. Always smaller, and for some technologies
   * essentially zero.
   *
   * This field exists because the first version of this model was wrong in an instructive way.
   * Treating labour and civil works as a hard floor that never learns made photovoltaics bottom
   * out at about 40% of their original cost, when the real fall is nearer 90% — because what
   * actually happened is that *installing* a solar farm became a repeatable industrial process:
   * standard racking, standard inverters, crews that do nothing else, and fewer square metres to
   * cover per watt as modules improved.
   *
   * None of that happens to a dam or a reactor building, which is why this is a per-technology
   * number rather than a global one. The distinction it draws is real and it is the sharpest one
   * in this file: **what learns is not "equipment", it is whatever is repeatable.** A factory
   * product installed the same way ten thousand times learns nearly all the way through; a
   * bespoke civil engineering project on a difficult site learns almost not at all.
   */
  installRatePerDoubling: Sourced<number>
  /** Cumulative capacity installed worldwide in 1995, the reference year for the paths below. */
  worldInstalled1995Mw: Sourced<number>
  /** Annual compound growth of that worldwide total. */
  worldGrowthPerYear: Sourced<number>
}

/**
 * Progress: the machine itself gets better, and costs more for it.
 *
 * Rates are per decade, applied to the technology as a class rather than to any one unit — a
 * plant built in 2015 is built to 2015's state of the art and keeps it. An existing machine does
 * not improve by standing there; that is what refurbishment is for.
 */
export interface ProgressDef {
  /** Relative efficiency gained per decade, e.g. 0.06 means 40% becomes 42.4%. */
  efficiencyGainPerDecade: Sourced<number>
  /** Relative design life gained per decade. */
  lifeGainPerDecade: Sourced<number>
  /**
   * Extra equipment cost per decade for being a better machine.
   *
   * The counterweight to the two above, and the reason this is a model rather than a wish: a
   * more efficient, longer-lived turbine costs more per kilowatt because better alloys, tighter
   * tolerances and more expensive fabrication are what made it better.
   */
  qualityCostPerDecade: Sourced<number>
}

export interface CostTrendDef {
  structure: CostStructureDef
  learning: LearningDef
  progress: ProgressDef
}

/** The year the world deployment figures above are anchored to. */
export const TREND_BASE_YEAR = 1995

const IRENA = 'irena-costs'
const IEA = 'iea-projected-costs'
const NREL = 'nrel-atb'
const ENG = 'engineering-standard'

function structure(equipment: number, labour: number, civil: number, note: string): CostStructureDef {
  return {
    equipment: sourced(equipment, 'fraction', IEA, 2020, note),
    labour: sourced(labour, 'fraction', IEA, 2020, note),
    civil: sourced(civil, 'fraction', IEA, 2020, note),
  }
}

/**
 * Per-technology trends.
 *
 * Two things to read here rather than take on trust. The **structure** rows are where the
 * long-run divergence lives: photovoltaics are two thirds factory output, a dam is half concrete,
 * and a nuclear station is mostly people and civil engineering. The **learning** rows are where
 * the speed of it lives: a technology the world is doubling every three years travels down its
 * curve in a decade, one growing at two percent a year does not move at all.
 *
 * Nothing here says a technology is good or bad. A high learning rate on a small equipment share
 * is worth little; a modest one on a large share, deployed at scale, is transformative. That
 * interaction is the point, and it is why these are two separate tables rather than one dial.
 */
export const COST_TRENDS: Record<PlantTypeId, CostTrendDef> = {
  coal: {
    structure: structure(0.45, 0.30, 0.25, 'Boiler and turbine island, erected on site over years'),
    learning: {
      ratePerDoubling: sourced(0.02, 'fraction', IEA, 2020, 'A mature technology learns very slowly'),
      installRatePerDoubling: sourced(0.01, 'fraction', IEA, 2020, 'Site erection of a bespoke boiler house learns very little'),
      worldInstalled1995Mw: sourced(1_050_000, 'MW', 'iea-weo', 2023),
      worldGrowthPerYear: sourced(0.019, 'fraction', 'iea-weo', 2023, 'Asian build-out against Western retirement'),
    },
    progress: {
      efficiencyGainPerDecade: sourced(0.03, 'fraction', IEA, 2020, 'Supercritical then ultra-supercritical steam'),
      lifeGainPerDecade: sourced(0.02, 'fraction', ENG, 2023),
      qualityCostPerDecade: sourced(0.05, 'fraction', IEA, 2020, 'Higher steam conditions need better alloys'),
    },
  },
  lignite: {
    structure: structure(0.42, 0.30, 0.28, 'As hard coal, with more fuel handling and site works'),
    learning: {
      ratePerDoubling: sourced(0.02, 'fraction', IEA, 2020),
      installRatePerDoubling: sourced(0.01, 'fraction', IEA, 2020, 'As hard coal, with more site-specific fuel handling'),
      worldInstalled1995Mw: sourced(150_000, 'MW', 'iea-weo', 2023),
      worldGrowthPerYear: sourced(0.004, 'fraction', 'iea-weo', 2023, 'Essentially flat: tied to local mines'),
    },
    progress: {
      efficiencyGainPerDecade: sourced(0.03, 'fraction', IEA, 2020),
      lifeGainPerDecade: sourced(0.02, 'fraction', ENG, 2023),
      qualityCostPerDecade: sourced(0.05, 'fraction', IEA, 2020),
    },
  },
  ccgt: {
    structure: structure(0.55, 0.25, 0.20, 'A large factory-built turbine set in a modest building'),
    learning: {
      ratePerDoubling: sourced(0.03, 'fraction', IEA, 2020),
      installRatePerDoubling: sourced(0.02, 'fraction', IEA, 2020, 'A repeatable building around a standard machine'),
      worldInstalled1995Mw: sourced(180_000, 'MW', 'iea-weo', 2023),
      worldGrowthPerYear: sourced(0.055, 'fraction', 'iea-weo', 2023, 'The dash for gas, then sustained growth'),
    },
    progress: {
      // The largest efficiency gain of any thermal technology, and it is real: combined-cycle
      // efficiency went from the high forties to the low sixties within the game's span.
      efficiencyGainPerDecade: sourced(0.05, 'fraction', IEA, 2020, 'Firing temperature and blade cooling'),
      lifeGainPerDecade: sourced(0.03, 'fraction', ENG, 2023),
      qualityCostPerDecade: sourced(0.06, 'fraction', IEA, 2020, 'Single-crystal blades and thermal barrier coatings'),
    },
  },
  ocgt: {
    structure: structure(0.65, 0.20, 0.15, 'Nearly all machine: a turbine on a pad'),
    learning: {
      ratePerDoubling: sourced(0.04, 'fraction', IEA, 2020),
      installRatePerDoubling: sourced(0.03, 'fraction', IEA, 2020, 'Barely a building at all, so most of the install is repeatable'),
      worldInstalled1995Mw: sourced(120_000, 'MW', 'iea-weo', 2023),
      worldGrowthPerYear: sourced(0.04, 'fraction', 'iea-weo', 2023),
    },
    progress: {
      efficiencyGainPerDecade: sourced(0.04, 'fraction', IEA, 2020),
      lifeGainPerDecade: sourced(0.03, 'fraction', ENG, 2023),
      qualityCostPerDecade: sourced(0.05, 'fraction', IEA, 2020),
    },
  },
  nuclear: {
    structure: structure(0.30, 0.40, 0.30, 'Mostly people and civil engineering; the reactor is the cheap part'),
    learning: {
      // Not zero. Asserting that nuclear cannot learn would be the thumb on the scale; what the
      // model says instead is that a modest learning rate on the smallest equipment share in the
      // table, at the slowest deployment growth in the table, cannot outrun escalation on the
      // other seventy percent. The real-terms cost rise falls out — it is not written down.
      ratePerDoubling: sourced(0.03, 'fraction', IEA, 2020, 'Observed where a single design was built repeatedly'),
      installRatePerDoubling: sourced(0.01, 'fraction', IEA, 2020, 'Only where one design was built repeatedly by one organisation'),
      worldInstalled1995Mw: sourced(340_000, 'MW', 'iea-weo', 2023),
      worldGrowthPerYear: sourced(0.006, 'fraction', 'iea-weo', 2023, 'Almost flat worldwide across the period'),
    },
    progress: {
      efficiencyGainPerDecade: sourced(0.01, 'fraction', ENG, 2023, 'Steam temperature is limited by the fuel cladding'),
      lifeGainPerDecade: sourced(0.06, 'fraction', IEA, 2020, 'Sixty-year design life became routine'),
      qualityCostPerDecade: sourced(0.08, 'fraction', IEA, 2020, 'Post-Fukushima safety requirements are cumulative'),
    },
  },
  hydro: {
    structure: structure(0.25, 0.30, 0.45, 'A dam is concrete and excavation with a turbine in it'),
    learning: {
      ratePerDoubling: sourced(0.01, 'fraction', IRENA, 2022, 'Civil works do not learn'),
      installRatePerDoubling: sourced(0.005, 'fraction', IRENA, 2022, 'Every dam is its own civil engineering project'),
      worldInstalled1995Mw: sourced(620_000, 'MW', IRENA, 2022),
      worldGrowthPerYear: sourced(0.022, 'fraction', IRENA, 2022),
    },
    progress: {
      efficiencyGainPerDecade: sourced(0.01, 'fraction', ENG, 2023, 'Already above ninety percent'),
      lifeGainPerDecade: sourced(0.02, 'fraction', ENG, 2023),
      qualityCostPerDecade: sourced(0.03, 'fraction', ENG, 2023),
    },
  },
  pumped: {
    structure: structure(0.25, 0.30, 0.45, 'Two reservoirs and a tunnel; the machine is a minority of it'),
    learning: {
      ratePerDoubling: sourced(0.01, 'fraction', IRENA, 2022),
      installRatePerDoubling: sourced(0.005, 'fraction', IRENA, 2022, 'As hydro: the site dictates the works'),
      worldInstalled1995Mw: sourced(90_000, 'MW', IRENA, 2022),
      worldGrowthPerYear: sourced(0.017, 'fraction', IRENA, 2022),
    },
    progress: {
      efficiencyGainPerDecade: sourced(0.01, 'fraction', ENG, 2023),
      lifeGainPerDecade: sourced(0.02, 'fraction', ENG, 2023),
      qualityCostPerDecade: sourced(0.03, 'fraction', ENG, 2023),
    },
  },
  wind: {
    structure: structure(0.68, 0.17, 0.15, 'Turbine, tower and blades, on a foundation and an access road'),
    learning: {
      ratePerDoubling: sourced(0.10, 'fraction', IRENA, 2022, 'Well documented across four decades'),
      installRatePerDoubling: sourced(0.06, 'fraction', IRENA, 2022, 'Foundations and erection standardised; the crane campaign did not'),
      worldInstalled1995Mw: sourced(4_800, 'MW', IRENA, 2022),
      worldGrowthPerYear: sourced(0.21, 'fraction', IRENA, 2022, 'Roughly a doubling every four years'),
    },
    progress: {
      // Capacity factor, not thermal efficiency: taller towers and larger rotors take more
      // energy out of the same wind. The efficiency field is what carries it for this class.
      efficiencyGainPerDecade: sourced(0.08, 'fraction', IRENA, 2022, 'Taller towers, larger rotors, better sites reachable'),
      lifeGainPerDecade: sourced(0.10, 'fraction', IRENA, 2022, 'Twenty-year design life became twenty-five to thirty'),
      qualityCostPerDecade: sourced(0.07, 'fraction', IRENA, 2022, 'A bigger machine costs more per kilowatt to build and install'),
    },
  },
  offshore_wind: {
    structure: structure(0.44, 0.44, 0.12, 'The turbine is under half of it; foundations, cables and vessels are the rest'),
    learning: {
      // Faster than onshore on both counts, and for a reason that is about age rather than
      // cleverness: onshore wind had already had its steep decades by the time this started, so
      // offshore spent the 2010s doing what onshore did in the 1990s. The equipment share is not
      // only the turbine — it carries the monopile and the export cable, and those fell hard as
      // the industry stopped adapting oil-and-gas kit and started building for the job.
      ratePerDoubling: sourced(0.15, 'fraction', IRENA, 2022, 'Turbine, foundation and cable together; the whole package was new'),
      installRatePerDoubling: sourced(0.11, 'fraction', IRENA, 2022, 'Purpose-built jack-up vessels and a serial supply chain — fast for installation, still behind the equipment'),
      worldInstalled1995Mw: sourced(5, 'MW', IRENA, 2022, 'Vindeby and little else; effectively a standing start'),
      worldGrowthPerYear: sourced(0.28, 'fraction', IRENA, 2022, 'From nothing to tens of gigawatts inside twenty-five years'),
    },
    progress: {
      efficiencyGainPerDecade: sourced(0.11, 'fraction', IRENA, 2022, 'Rotor growth offshore ran ahead of onshore; there is no road to move the blade along'),
      lifeGainPerDecade: sourced(0.09, 'fraction', IRENA, 2022),
      qualityCostPerDecade: sourced(0.09, 'fraction', IRENA, 2022, 'Deeper water and longer export cables as the near sites fill up'),
    },
  },
  solar: {
    structure: structure(0.62, 0.20, 0.18, 'Modules and inverters, plus mounting, wiring and land'),
    learning: {
      ratePerDoubling: sourced(0.20, 'fraction', IRENA, 2022, 'The steepest well-attested learning rate in the sector'),
      installRatePerDoubling: sourced(0.12, 'fraction', IRENA, 2022, 'Racking and installation became an industrial process, and fewer square metres per watt'),
      worldInstalled1995Mw: sourced(600, 'MW', IRENA, 2022, 'Almost nothing, which is why the doublings came so fast'),
      worldGrowthPerYear: sourced(0.34, 'fraction', IRENA, 2022, 'A doubling roughly every two and a half years'),
    },
    progress: {
      efficiencyGainPerDecade: sourced(0.09, 'fraction', NREL, 2023, 'Module conversion efficiency'),
      lifeGainPerDecade: sourced(0.06, 'fraction', NREL, 2023),
      qualityCostPerDecade: sourced(0.04, 'fraction', NREL, 2023),
    },
  },
  battery: {
    structure: structure(0.80, 0.12, 0.08, 'Cells and power electronics in a container on a slab'),
    learning: {
      ratePerDoubling: sourced(0.18, 'fraction', NREL, 2023, 'Cell costs, carried by the vehicle industry rather than by the grid'),
      installRatePerDoubling: sourced(0.1, 'fraction', NREL, 2023, 'Containerised: the install is a slab, a fence and a cable'),
      worldInstalled1995Mw: sourced(100, 'MW', NREL, 2023, 'Nominal: grid storage barely existed'),
      worldGrowthPerYear: sourced(0.30, 'fraction', NREL, 2023),
    },
    progress: {
      efficiencyGainPerDecade: sourced(0.03, 'fraction', NREL, 2023, 'Round-trip efficiency was already high'),
      lifeGainPerDecade: sourced(0.12, 'fraction', NREL, 2023, 'Cycle life is where the chemistry gains have landed'),
      qualityCostPerDecade: sourced(0.03, 'fraction', NREL, 2023),
    },
  },
  gas_chp: {
    structure: structure(0.55, 0.25, 0.20, 'As combined cycle, plus the heat extraction plant'),
    learning: {
      ratePerDoubling: sourced(0.03, 'fraction', 'euro-chp-practice', 2021),
      installRatePerDoubling: sourced(0.02, 'fraction', 'euro-chp-practice', 2021, 'As combined cycle'),
      worldInstalled1995Mw: sourced(60_000, 'MW', 'euro-chp-practice', 2021),
      worldGrowthPerYear: sourced(0.035, 'fraction', 'euro-chp-practice', 2021),
    },
    progress: {
      efficiencyGainPerDecade: sourced(0.05, 'fraction', IEA, 2020),
      lifeGainPerDecade: sourced(0.03, 'fraction', ENG, 2023),
      qualityCostPerDecade: sourced(0.06, 'fraction', IEA, 2020),
    },
  },
  coal_chp: {
    structure: structure(0.45, 0.30, 0.25, 'A coal station with a heat main out of the back'),
    learning: {
      ratePerDoubling: sourced(0.02, 'fraction', 'euro-chp-practice', 2021),
      installRatePerDoubling: sourced(0.01, 'fraction', 'euro-chp-practice', 2021, 'As hard coal'),
      worldInstalled1995Mw: sourced(90_000, 'MW', 'euro-chp-practice', 2021),
      worldGrowthPerYear: sourced(0.008, 'fraction', 'euro-chp-practice', 2021),
    },
    progress: {
      efficiencyGainPerDecade: sourced(0.03, 'fraction', IEA, 2020),
      lifeGainPerDecade: sourced(0.02, 'fraction', ENG, 2023),
      qualityCostPerDecade: sourced(0.05, 'fraction', IEA, 2020),
    },
  },
  heat_boiler: {
    structure: structure(0.55, 0.25, 0.20, 'A packaged boiler in a boiler house'),
    learning: {
      ratePerDoubling: sourced(0.03, 'fraction', 'euro-chp-practice', 2021),
      installRatePerDoubling: sourced(0.02, 'fraction', 'euro-chp-practice', 2021, 'A packaged unit dropped into a standard boiler house'),
      worldInstalled1995Mw: sourced(200_000, 'MWth', 'euro-chp-practice', 2021),
      worldGrowthPerYear: sourced(0.02, 'fraction', 'euro-chp-practice', 2021),
    },
    progress: {
      efficiencyGainPerDecade: sourced(0.02, 'fraction', ENG, 2023, 'Condensing designs; already near the limit'),
      lifeGainPerDecade: sourced(0.02, 'fraction', ENG, 2023),
      qualityCostPerDecade: sourced(0.02, 'fraction', ENG, 2023),
    },
  },
  heat_accumulator: {
    structure: structure(0.35, 0.25, 0.40, 'A very large insulated tank: mostly steel plate, foundation and land'),
    learning: {
      ratePerDoubling: sourced(0.05, 'fraction', 'euro-chp-practice', 2021),
      installRatePerDoubling: sourced(0.03, 'fraction', 'euro-chp-practice', 2021, 'A tank is a repeatable weld, its foundation is not'),
      worldInstalled1995Mw: sourced(20_000, 'MWth', 'euro-chp-practice', 2021),
      worldGrowthPerYear: sourced(0.05, 'fraction', 'euro-chp-practice', 2021),
    },
    progress: {
      efficiencyGainPerDecade: sourced(0.02, 'fraction', ENG, 2023, 'Better insulation, lower standing loss'),
      lifeGainPerDecade: sourced(0.02, 'fraction', ENG, 2023),
      qualityCostPerDecade: sourced(0.02, 'fraction', ENG, 2023),
    },
  },
}

/**
 * Standardisation: what a programme buys over a collection of one-offs.
 *
 * Unlike learning, this one *is* driven by the player's own building, because it is about their
 * supply chain, their engineers and their crews — the second identical unit is cheaper and
 * quicker because the people who built the first one are still there.
 *
 * Capped, and the cap matters more than the rate. Without one, a player who built forty of the
 * same thing would eventually get it for nothing, which would turn a real effect into an exploit
 * and would also quietly punish having a mixed fleet far beyond what the effect justifies.
 */
export interface StandardisationDef {
  /** Cost reduction per repeat build, before the cap. */
  capexReductionPerRepeat: Sourced<number>
  /** Build-time reduction per repeat build, before the cap. */
  buildTimeReductionPerRepeat: Sourced<number>
  /** The most either can ever reach. */
  maxReduction: Sourced<number>
}

export const STANDARDISATION: StandardisationDef = {
  capexReductionPerRepeat: sourced(0.025, 'fraction', IEA, 2020, 'Observed in repeated builds of one design'),
  buildTimeReductionPerRepeat: sourced(0.03, 'fraction', IEA, 2020, 'Learning by the construction organisation'),
  maxReduction: sourced(0.20, 'fraction', IEA, 2020, 'Beyond this the gains are in the technology, not the repetition'),
}
