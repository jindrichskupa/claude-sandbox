/**
 * The world: everything the simulation knows, and the tick that advances it.
 *
 * `WorldState` deliberately holds the policy, opinion, carbon-price, fuel-index and
 * technology fields even though the early milestones barely move them. They are the single
 * place later systems write to, and having them in the save format from the start is what
 * keeps those systems additive.
 */

import { ECONOMICS } from '@content/economics'
import { FUELS, type FuelId } from '@content/fuels'
import { LINE_TYPES } from '@content/lineTypes'
import { heatCapacityOf, mixBand, PLANT_TYPES } from '@content/plantTypes'
import { HEAT_PIPE_TYPES } from '@content/heatPipeTypes'
import { RandomSource } from './core/rng'
import {
  isMonthBoundary,
  isYearBoundary,
  MONTHS_PER_YEAR,
  TICKS_PER_YEAR,
  tickToDate,
  type GameDate,
} from './core/time'

const TICKS_PER_MONTH = TICKS_PER_YEAR / MONTHS_PER_YEAR
import { Network, nodeInService, PLAYER, type NodeId } from './grid/network'
import { IslandCache } from './grid/islands'
import {
  advanceLineCondition,
  lineAgingModifiers,
  lineFaultRate,
  lineLifeFraction,
  lineWearFactor,
  repairTicks,
  LINE_AGE_SOURCE,
} from './grid/aging'
import {
  advanceCondition,
  ageYears,
  agingModifiers,
  forcedOutageRate,
  terminalFailureShare,
  AGE_SOURCE,
} from './assets/aging'
import { isDispatchable, LifecyclePhase, type CityAsset, type PlantAsset } from './assets/types'
import { ModifierRegistry } from './params/ModifierRegistry'
import { Params } from './params/Params'
import { Param } from './params/types'
import { dispatch, lossDemandOf, type DispatchResult } from './dispatch/dispatch'
import { WeatherModel, type ClimateDef, type Weather } from './weather/weather'
import { weatherModifiers, WEATHER_SOURCE } from './weather/effects'
import { generateTerrain, windSiteFactor, type TerrainMap } from './map/terrain'
import { planStorage, settleStorage, isStorage, FORECAST_WINDOW_HOURS, type StoragePlan } from './dispatch/storage'
import { dispatchHeat, isHeatStore, settleHeatStore, type HeatResult } from './heat/heat'
import { CARBON_PHASE_IN_YEARS, ELECTION_TERM_YEARS, REGIMES_BY_ID } from '@content/policies'
import { initialFuelIndices, policyModifiers, POLICY_SOURCE, stepFuelPrices, importExposure } from './policy/regime'
import {
  confidenceAfterBreach,
  contractedPriceFor,
  CONFIDENCE_RECOVERY_PER_YEAR,
  remainingValue,
  revokeAll,
  type SupportContract,
} from './policy/contracts'
import { runElection, salienceFrom } from './policy/elections'
import {
  evaluateObjectives,
  scenarioOutcome,
  type ObjectiveContext,
  type ObjectiveDef,
  type ObjectiveProgress,
  type ScenarioOutcome,
} from './scenario/objectives'
import { forecastResidualLoad, type ForecastHour } from './dispatch/forecast'
import { AssetBooks } from './economy/assetLedger'
import { recordYear, type YearRecord } from './economy/yearbook'
import { rateBase, revenueRequirementPerMwh, reviewTariff } from './economy/tariff'
import { NewsDesk, NewsImportance, type NewsItem, type UpcomingItem } from './news/news'
import { growthModifiers, stepCityGrowth, GROWTH_SOURCE } from './city/growth'
import { rooftopOutputMw, rooftopSplit, stepRooftop } from './city/rooftop'
import { ROOFTOP } from '@content/cityTrends'
import { techModifiers, TECH_SOURCE } from './tech/modifiers'
import { nominal, pricesFor, type Prices } from './tech/money'
import { realDecommissioningFactor } from './tech/costs'
import type { SaveData } from './scenario/save'
import { EventDirector } from './events/director'
import { EVENTS_BY_ID } from '@content/events'
import {
  addLedger,
  chargeCapex,
  chargeEventCost,
  chargeInsurance,
  chargeUnservedHeat,
  chargeCorporateTax,
  chargeWindfallLevy,
  creditCapacityPayment,
  creditHeatSales,
  chargeDecommissioning,
  creditRecycling,
  chargeFixedCosts,
  chargeGeneration,
  repayLoan,
  serviceLoans,
  takeLoan,
  type Loan,
  chargeUnserved,
  creditSales,
  emptyLedger,
  ledgerProfit,
  settlePeriod,
  thermalInputMwh,
  type Finances,
  type PeriodLedger,
} from './economy/economy'

/**
 * World-level state that policy, events and geopolitics will later write to. Read from
 * scenario data and mostly constant in the first milestone.
 */
export interface WorldState {
  policyRegimeId: string
  /** How the public feels about the utility, 0..1. Reacts to price, reliability and emissions. */
  publicOpinion: number
  /**
   * The carbon price now in force. A *mirror* of `params.get('world', CarbonPricePerTonne)`,
   * refreshed monthly so the hot dispatch loop can read a number instead of walking the chain.
   * Never the parameter's base value — see the note in `baseValue`.
   */
  carbonPricePerTonne: number
  /**
   * Price index per fuel, 1 being the reference price in `fuels.ts`.
   *
   * Per fuel rather than one global scalar, because a political shock does not move mine-mouth
   * lignite and imported pipeline gas by the same amount — and a model that said it did would
   * remove the main reason to care what you burn.
   */
  fuelPriceIndex: Record<string, number>
  /** Support contracts, live, expired and torn up. See `policy/contracts.ts`. */
  contracts: SupportContract[]
  /**
   * How far the country's promises are believed, 0..1. Falls when a government repudiates a
   * support contract and raises the cost of debt for everything afterwards.
   */
  investorConfidence: number
  /** When the government next has to face the voters. */
  nextElectionTick: number
  /**
   * When the government in office took it, and what the carbon price was that day.
   *
   * Together these are the whole of the phase-in: a government legislates a carbon price and it
   * arrives over its term, starting from whatever its predecessor left. See `carbonPriceInForce`.
   */
  regimeTookOfficeTick: number
  carbonPriceAtTakeover: number
  /** Vote share per regime at the last election, for the polling display. */
  polls: Record<string, number>
  /**
   * The regulated tariff now in force, reset each year against what the market actually cleared
   * at over the past twelve months.
   *
   * Without this the utility sells at a fixed price forever, so every cost the government adds
   * — a carbon price above all — is a pure loss with no pass-through. That is not a hard policy
   * environment, it is a broken market, and it would make every decarbonisation regime lethal
   * regardless of what the player did. A price-capping government can still hold it down, which
   * is exactly what `tariffFactor` is for and why that regime bites.
   */
  regulatedTariffPerMwh: number
  /** Technology level per plant type, 1 = as at scenario start. */
  techLevel: Record<string, number>
  /** Cumulative MW of each technology deployed, which is what drives learning curves. */
  cumulativeDeployedMw: Record<string, number>
  /**
   * How hard the utility maintains its fleet. 0.6 is deferred, 1 is normal, 1.4 is thorough.
   * Multiplies fixed cost and divides the technical failure rate, so it is a straight trade of
   * money now against risk later — and the reason a bad year is usually traceable to a decision.
   */
  maintenanceLevel: number
  /** Whether the fleet is insured. Turns a capital shock into a monthly premium. */
  insured: boolean
}

export interface TickSnapshot {
  tick: number
  date: GameDate
  weather: Weather
  demandMw: number
  generationMw: number
  lossMw: number
  unservedMw: number
  pricePerMwh: number
  cash: number
  debt: number
  co2Tonnes: number
  /** MW generated per plant category, for the mix chart. */
  mixMw: Record<string, number>
  /** District heat demanded by connected cities, MW thermal. */
  heatDemandMw: number
  heatSuppliedMw: number
  heatUnservedMw: number
  /** Rooftop energy consumed behind the meter — demand the utility no longer gets to serve. */
  rooftopSelfUseMw: number
  /** Rooftop energy the network absorbed and paid for. */
  rooftopExportMw: number
}

export interface ScenarioDef {
  id: string
  nameKey: string
  startYear: number
  seed: number
  mapWidth: number
  mapHeight: number
  /** Kilometres per map tile. */
  kmPerTile: number
  climate: ClimateDef
  startingCash: number
  startingDebt: number
  tariffPerMwh: number
  /** Price the utility is paid per MWh of district heat. */
  heatTariffPerMwh: number
  carbonPricePerTonne: number
  /** The government in office when the scenario begins. */
  initialRegimeId: string
  objectives: ObjectiveDef[]
  /** The year the scenario is judged. */
  endYear: number
  /** Guaranteed price per MWh by technology, paid outside the market. */
  feedInTariffs: Partial<Record<string, number>>
}

const HISTORY_LENGTH = TICKS_PER_YEAR
/** How long a failure to supply stays in the utility's reputation, for event risk. */
const BLACKOUT_MEMORY_TICKS = 24 * 30
/**
 * Below this, "unserved" is solver noise rather than a town in the dark.
 *
 * The same tolerance the rest of the world uses for the same judgement, named once so the
 * regulator's view of a failed hour and the banner that tells the player about it can never
 * disagree about which hours those were.
 */
const UNSERVED_EPSILON_MW = 0.01
/**
 * What share of a year's demand must have been served before its prices are worth resetting the
 * tariff against. A tenth: enough that a seasonal quirk cannot set the price of everything.
 */
const MIN_TARIFF_SAMPLE_SHARE = 0.1
/** How many recent hours the storage arbitrage policy looks back over. */
const PRICE_WINDOW_TICKS = 24 * 7

/**
 * Money committed to a project and paid out over its duration. Keeping the schedule here
 * rather than on the asset means a cancelled or completed project simply stops being billed,
 * with no partial-payment bookkeeping scattered through the lifecycle code.
 */
interface ScheduledSpend {
  /** Plant or edge id this belongs to. */
  ownerId: string
  perTick: number
  remainingTicks: number
  kind: 'capex' | 'decommissioning'
}

export class World {
  readonly network = new Network()
  readonly plants: PlantAsset[] = []
  readonly cities: CityAsset[] = []
  readonly registry = new ModifierRegistry()
  readonly params: Params
  readonly rng: RandomSource
  readonly electricIslands: IslandCache
  readonly heatIslands: IslandCache

  readonly state: WorldState
  readonly finances: Finances
  /** Owned by the world, not the renderer: it decides where things can stand. */
  readonly terrain: TerrainMap

  private readonly weatherModel: WeatherModel
  weather: Weather
  tick = 0

  /** Ring buffer of recent ticks, for the charts. */
  private readonly history: (TickSnapshot | undefined)[] = new Array(HISTORY_LENGTH)
  private historyCount = 0

  /** Accumulates until the month closes. */
  openLedger: PeriodLedger = emptyLedger()
  lastMonthLedger: PeriodLedger = emptyLedger()
  yearLedger: PeriodLedger = emptyLedger()
  /** Everything since the scenario began, which is the window most objectives are judged over. */
  lifetimeLedger: PeriodLedger = emptyLedger()

  /**
   * Accounts per plant and per line. See `economy/assetLedger.ts` for why a line has revenue.
   *
   * Kept beside the utility's own books rather than on the assets, so a station that has been
   * demolished keeps its history — which is what any honest account of a run needs.
   */
  readonly books = new AssetBooks()

  /**
   * What has happened, in words.
   *
   * Systems post here rather than the interface inferring things from state, which is the change
   * that turned "Something is happening" into a sentence naming a place. See `news/news.ts`.
   */
  readonly news = new NewsDesk()

  /**
   * One line per completed year, for the whole run.
   *
   * Every chart in the game shows the last ten days, which is the right window for operating a
   * system and the wrong one for every decision the player makes. See `economy/yearbook.ts`.
   */
  readonly yearbook: YearRecord[] = []
  /** Generation by category since the year opened, MWh. Reset when the year closes. */
  private yearMix: Record<string, number> = {}

  /**
   * Whether the player has asked to carry on after the verdict.
   *
   * A scenario that stops the clock the moment its brief is blown is answering a question nobody
   * asked. The player is running a forty-year strategy; being told in 2004 that they have missed
   * an unserved-energy target does not make the other twenty years uninteresting, and for a
   * strategy played deliberately — all nuclear, all renewables, no carbon price survives contact
   * with reality — the interesting part is precisely what happens *after* the brief fails.
   *
   * The verdict stands: `outcome` is not reset, the objectives keep their statuses, and the end
   * screen said what it said. This only means the hours keep passing.
   *
   * Bankruptcy is deliberately not covered. A utility whose creditors have taken it is not a
   * utility any more, and there is nothing left to play — the model has no owner to make
   * decisions and no balance sheet to make them against.
   */
  freePlay = false

  /** How each objective stands. Re-judged when the year closes; a breach is permanent. */
  objectives: ObjectiveProgress[] = []
  outcome: ScenarioOutcome = 'playing'
  private periodStartTick = 0

  readonly director = new EventDirector()

  lastDispatch: DispatchResult | null = null
  lastHeat: HeatResult | null = null
  /**
   * Last hour's clearing price, which is what cogeneration heat is costed against. Held here
   * rather than read back out of the history buffer so the heat solve does not depend on the
   * charting layer existing.
   */
  private lastSystemPrice = 0

  /**
   * What the last hour cleared at, system-wide.
   *
   * Exposed because it is the headline the topbar shows and the series the price chart draws, so
   * it is already public in every sense that matters; reaching it through a snapshot only made it
   * awkward to assert on.
   */
  get systemPricePerMwh(): number {
    return this.lastSystemPrice
  }
  lastStoragePlans: Map<string, StoragePlan> = new Map()
  /** Residual load for the coming hours, current hour first. Drives storage and the UI. */
  lastForecast: ForecastHour[] = []

  /** Recent prices, feeding the storage arbitrage policy. */
  private readonly priceWindow: number[] = []
  private serial = 0
  private readonly spending: ScheduledSpend[] = []
  private readonly energiseAt = new Map<string, number>()
  private recentBlackoutTicks = 0
  /** Previous hour's loss estimate, used to warm-start the next hour's iteration. */
  private lastLossDemand: Map<NodeId, number> | null = null
  /** Accumulated over the electoral term, because that is the period voters judge. */
  private termPriceSum = 0
  private termPriceTicks = 0
  /** Cost of energy delivered in the hours the system actually served, for the annual reset. */
  private termGenerationByFuel = new Map<FuelId, number>()
  /** So a summer of below-zero hours produces one headline rather than four hundred. */
  private lastNegativePriceYear = 0
  /** Set for one tick after an election, so the UI can announce it. */
  lastElection: { year: number; fromId: string; toId: string; contractsRevoked: number } | null = null

  constructor(readonly scenario: ScenarioDef) {
    this.rng = new RandomSource(scenario.seed)
    this.terrain = generateTerrain(scenario.seed, scenario.mapWidth, scenario.mapHeight)
    this.weatherModel = new WeatherModel(this.rng, scenario.climate)
    this.electricIslands = new IslandCache(this.network, 'electric')
    this.heatIslands = new IslandCache(this.network, 'heat')

    this.state = {
      policyRegimeId: scenario.initialRegimeId,
      publicOpinion: 0.5,
      carbonPricePerTonne: scenario.carbonPricePerTonne,
      fuelPriceIndex: initialFuelIndices(),
      contracts: [],
      investorConfidence: 1,
      nextElectionTick: Math.round(ELECTION_TERM_YEARS.value * TICKS_PER_YEAR),
      // The scenario's opening government is not "new": its price is the one the player inherits
      // and has been living with, so it is in force from the first hour rather than phasing in.
      regimeTookOfficeTick: -Math.round(CARBON_PHASE_IN_YEARS.value * TICKS_PER_YEAR),
      carbonPriceAtTakeover: scenario.carbonPricePerTonne,
      polls: {},
      regulatedTariffPerMwh: scenario.tariffPerMwh,
      techLevel: {},
      cumulativeDeployedMw: {},
      maintenanceLevel: 1,
      insured: false,
    }

    this.finances = {
      cash: scenario.startingCash,
      debt: scenario.startingDebt,
      trailingRevenue: 0,
      bankrupt: false,
      loans: [],
      loanSerial: 0,
    }
    // The debt the scenario hands over is a loan like any other, and has to be, or it would be the
    // one borrowing in the game that is never repaid and never costs an instalment. It is taken as
    // already part-way through its term, for the same reason the fleet is already part-way through
    // its life: this is a utility with a history, not one that opened yesterday.
    if (scenario.startingDebt > 0) {
      const term = ECONOMICS.loanTermYears.value
      this.finances.loans.push({
        id: 'loan_inherited',
        principal: scenario.startingDebt,
        outstanding: scenario.startingDebt,
        ratePerYear: ECONOMICS.loanInterestRate.value,
        takenTick: -Math.round((term / 2) * TICKS_PER_YEAR),
        maturesTick: Math.round((term / 2) * TICKS_PER_YEAR),
        kind: 'planned',
      })
    }

    this.params = new Params(this.registry, (targetId, param) => this.baseValue(targetId, param))
    this.weather = this.weatherModel.generate(0, 0)
    this.applyRegime()
  }

  /**
   * Base values for every parameter. This is the only place raw content numbers are read;
   * everything else in the simulation goes through `params.get`.
   */
  private baseValue(targetId: string, param: Param): number | undefined {
    // Synthetic target used to price a plant that does not exist yet, so the build menu and
    // the eventual charge come from the same code path and cannot drift apart.
    if (targetId.startsWith('quote:')) {
      const typeId = targetId.slice('quote:'.length) as keyof typeof PLANT_TYPES
      const type = PLANT_TYPES[typeId]
      if (!type) return undefined
      switch (param) {
        case Param.CapacityMw:
          return type.capacityMw.value
        case Param.CapexPerKw:
          return type.capexPerKw.value
        case Param.BuildTimeMonths:
          return type.buildTimeMonths.value
        case Param.FixedOpexPerKwYear:
          return type.fixedOpexPerKwYear.value
        case Param.Efficiency:
          return type.efficiency.value
        default:
          return undefined
      }
    }

    const plant = this.plantsById.get(targetId)
    if (plant) {
      const type = PLANT_TYPES[plant.typeId]
      switch (param) {
        case Param.CapacityMw:
          // Uprating during an overhaul is permanent, so it belongs in the base value rather
          // than as a modifier — it changed what the machine is, not what is happening to it.
          return type.capacityMw.value * (1 + plant.capacityUplift)
        case Param.Efficiency:
          return type.efficiency.value * (1 + plant.efficiencyUplift)
        case Param.Availability:
          return 1 - type.forcedOutageRate.value
        case Param.VarOpexPerMwh:
          return type.varOpexPerMwh.value
        case Param.FixedOpexPerKwYear:
          return type.fixedOpexPerKwYear.value
        case Param.CapexPerKw:
          return type.capexPerKw.value
        case Param.BuildTimeMonths:
          return type.buildTimeMonths.value
        case Param.RampRatePerHour:
          return type.rampRatePerHour.value
        case Param.FuelPricePerMwhThermal:
          return FUELS[type.fuel].pricePerMwhThermal.value * (this.state.fuelPriceIndex[type.fuel] ?? 1)
        case Param.FeedInTariffPerMwh:
          // What was promised to *this machine*, not what its technology is currently in
          // favour with. A contract outlives the government that signed it, or is torn up.
          return contractedPriceFor(this.state.contracts, plant.id, this.tick)
        case Param.HeatCapacityMwth:
          return heatCapacityOf(plant.typeId)
        default:
          return undefined
      }
    }

    const city = this.citiesById.get(targetId)
    if (city) {
      if (param === Param.DemandMw) return city.baseDemandMw
      if (param === Param.HeatDemandMw) return city.baseHeatDemandMwth
      return undefined
    }

    const edge = this.network.getEdge(targetId)
    if (edge && param === Param.PipeCapacityMwth && edge.dn !== undefined) {
      return HEAT_PIPE_TYPES[edge.dn].capacityMwth.value * Math.max(1, edge.circuits)
    }
    if (edge && param === Param.LineCapacityMw) {
      if (edge.kv === 110 || edge.kv === 220 || edge.kv === 400) {
        return LINE_TYPES[edge.kv].capacityMw.value * edge.circuits
      }
      return 0
    }

    if (targetId === 'world') {
      // The scenario's figure, never the current one. Reading the mutable state here would
      // make the parameter its own input: the policy layer adds its delta, the result is
      // written back to the state, and next month the same delta is added to that. The price
      // compounded to €11,000 a tonne in twenty years before this was caught, which is the
      // sort of thing a feedback loop does quietly while every individual step looks right.
      if (param === Param.CarbonPricePerTonne) return this.scenario.carbonPricePerTonne
      // The regulated tariff, not the scenario's opening figure: it is reset against the market
      // every year so that costs the government adds can be passed through, and the policy layer
      // then multiplies it by whatever cap is in force.
      if (param === Param.TariffPerMwh) return this.state.regulatedTariffPerMwh
      if (param === Param.HeatTariffPerMwh) return this.scenario.heatTariffPerMwh
      // Both start at nothing and are set entirely by the government of the day, so the
      // explanation chain reads "base 0, policy +19%" rather than hiding the source.
      if (param === Param.CorporateTaxRate) return 0
      if (param === Param.CapacityPaymentPerKwYear) return 0
    }

    return undefined
  }

  private plantsById = new Map<string, PlantAsset>()
  private citiesById = new Map<string, CityAsset>()

  addPlant(plant: PlantAsset): void {
    this.plants.push(plant)
    this.plantsById.set(plant.id, plant)
    // Filed here rather than in the build command, because this is the one door every new
    // machine comes through — a scenario's inherited fleet included, which is why it is routine
    // rather than notable and why the phase decides the headline.
    if (plant.phase === LifecyclePhase.Building) {
      this.postNews({
        category: 'construction',
        importance: NewsImportance.Notable,
        titleKey: 'news.constructionStarted',
        params: {
          plant: this.plantName(plant.id),
          type: PLANT_TYPES[plant.typeId].nameKey,
          months: Math.max(1, Math.round((plant.phaseEndsTick - this.tick) / (TICKS_PER_YEAR / 12))),
        },
        subjectId: plant.id,
        subjectKind: 'plant',
      })
    }
    const type = PLANT_TYPES[plant.typeId]
    const key = plant.typeId
    this.state.cumulativeDeployedMw[key] = (this.state.cumulativeDeployedMw[key] ?? 0) + type.capacityMw.value
    // A new machine needs its vintage before it generates anything, and the type it belongs to
    // may now be one build further down its standardisation curve.
    this.techDirty = true
  }

  addCity(city: CityAsset): void {
    this.cities.push(city)
    this.citiesById.set(city.id, city)
  }

  getPlant(id: string): PlantAsset | undefined {
    return this.plantsById.get(id)
  }

  getCity(id: string): CityAsset | undefined {
    return this.citiesById.get(id)
  }

  /** Monotonic counter for generated ids. Part of the world state, so replays match. */
  nextSerial(): number {
    return ++this.serial
  }

  /** Any node within `radius` tiles, used to stop the player stacking stations on one spot. */
  nodeNear(x: number, y: number, radius: number): NodeId | null {
    for (const node of this.network.allNodes()) {
      if (Math.hypot(node.x - x, node.y - y) <= radius) return node.id
    }
    return null
  }

  /** Commit money to a project, paid in equal instalments across its duration. */
  scheduleSpending(ownerId: string, total: number, ticks: number, kind: ScheduledSpend['kind']): void {
    if (total <= 0 || ticks <= 0) return
    this.spending.push({ ownerId, perTick: total / ticks, remainingTicks: ticks, kind })
  }

  /** Stop billing a project, e.g. because it was cancelled. */
  cancelSpending(ownerId: string): void {
    for (let i = this.spending.length - 1; i >= 0; i--) {
      if (this.spending[i]!.ownerId === ownerId) this.spending.splice(i, 1)
    }
  }

  /** Remaining committed spend, so the UI can show what is already promised. */
  committedSpend(): number {
    let total = 0
    for (const s of this.spending) total += s.perTick * s.remainingTicks
    return total
  }

  /**
   * Pay for something taken down now rather than over years.
   *
   * A line is dismantled in weeks and there is nothing to make safe afterwards, so unlike a power
   * station's decommissioning this is a single charge rather than a schedule.
   */
  chargeDemolition(cost: number): void {
    chargeDecommissioning(this.openLedger, cost)
  }

  scheduleEnergising(edgeId: string, tick: number): void {
    this.energiseAt.set(edgeId, tick)
    // Same reasoning as `addPlant`: every corridor under construction passes through here, so
    // this is the one place the headline cannot be forgotten.
    const edge = this.network.getEdge(edgeId)
    if (!edge) return
    this.postNews({
      category: 'grid',
      importance: NewsImportance.Notable,
      titleKey: edge.commodity === 'heat' ? 'news.pipeStarted' : 'news.lineStarted',
      params: {
        from: this.nodeName(edge.from),
        to: this.nodeName(edge.to),
        kv: edge.kv,
        months: Math.max(1, Math.round((tick - this.tick) / (TICKS_PER_YEAR / 12))),
      },
      subjectId: edgeId,
      subjectKind: 'edge',
    })
  }

  /**
   * When a line under construction will be energised, or undefined if it already is.
   *
   * Exposed so the inspector can tell the player when a half-built corridor will start carrying
   * anything. A plant under construction has said so since M1; a line said nothing at all, which
   * made the one asset whose whole point is a long lead time the one you could learn least about.
   *
   * The later of the line's own completion and its two ends', because a corridor run to a station
   * that is still being dug waits for the compound. Reporting only the line's date would count the
   * player down to a moment when nothing happens, which is worse than saying nothing.
   */
  energisingTick(edgeId: string): number | undefined {
    const own = this.energiseAt.get(edgeId)
    if (own === undefined) return undefined
    const edge = this.network.getEdge(edgeId)
    if (!edge) return own
    let at = own
    for (const nodeId of [edge.from, edge.to]) {
      const node = this.network.getNode(nodeId)
      if (node?.inServiceTick !== undefined) at = Math.max(at, node.inServiceTick)
    }
    return at
  }

  get date(): GameDate {
    return tickToDate(this.tick, this.scenario.startYear)
  }

  /**
   * Take a loan, at the rate the balance sheet currently earns.
   *
   * On the world rather than in the panel that offers it, because it is a command like building a
   * station: it changes the run, and it has to be reachable from anywhere the player can decide to
   * do it — including, one day, from an auto-player.
   */
  borrow(amount: number, termYears: number): Loan | null {
    const loan = takeLoan(this.finances, amount, termYears, this.tick, this.state.investorConfidence)
    if (loan) {
      this.postNews({
        category: 'finance',
        importance: NewsImportance.Notable,
        titleKey: 'news.loanTaken',
        params: {
          amount: Math.round(loan.principal / 1e6),
          rate: (loan.ratePerYear * 100).toFixed(1),
          years: Math.round((loan.maturesTick - loan.takenTick) / TICKS_PER_YEAR),
        },
      })
    }
    return loan
  }

  /** Clear a loan early out of cash, saving the interest it would have accrued. */
  repayLoan(loanId: string): number {
    return repayLoan(this.finances, loanId)
  }

  /** Recent snapshots, oldest first. */
  recentHistory(n: number): TickSnapshot[] {
    const out: TickSnapshot[] = []
    const count = Math.min(n, this.historyCount, HISTORY_LENGTH)
    for (let i = count - 1; i >= 0; i--) {
      const idx = (((this.historyCount - 1 - i) % HISTORY_LENGTH) + HISTORY_LENGTH) % HISTORY_LENGTH
      const s = this.history[idx]
      if (s) out.push(s)
    }
    return out
  }

  /** Advance the world by one hour. */
  step(): TickSnapshot {
    this.tick++
    this.params.setTick(this.tick)
    this.registry.pruneExpired(this.tick)

    const date = this.date

    // 1. Weather, and everything it implies about plants and demand. Wind farms see the
    //    wind their own site gets, not a national average — siting is a real decision.
    this.weather = this.weatherModel.generate(this.tick, this.weather.snowpackMm)
    this.registry.setSource(
      WEATHER_SOURCE,
      weatherModifiers(this.weather, this.plants, this.cities, date.hour, (plant) => {
        const node = this.network.getNode(plant.nodeId)
        return node ? windSiteFactor(this.terrain, node.x, node.y) : 1
      }),
    )

    // 2. Ageing, monthly — nothing here changes meaningfully within a day.
    if (isMonthBoundary(this.tick) || this.tick === 1) {
      this.registry.setSource(AGE_SOURCE, agingModifiers(this.plants, this.tick))
      // The network ages too, and until now it did not. A worn corridor is derated rather than
      // disconnected — a few percent, landing exactly on the constraint this scenario is built
      // around.
      this.registry.setSource(LINE_AGE_SOURCE, lineAgingModifiers(this.network.allEdges()))
      // Fuel markets move on a monthly timescale here. Each fuel has its own index, so a
      // political shock moves imported gas and mine-mouth lignite by very different amounts.
      // Re-register the government's modifiers every month rather than only when one takes
      // office. It costs a handful of objects and it means `state.policyRegimeId` is the single
      // source of truth: setting it is enough, and nothing can drift out of step with it.
      this.applyRegime()
      stepFuelPrices(this.state.fuelPriceIndex, this.state.policyRegimeId, this.rng.streamFor('fuel'), this.tick)
      this.state.carbonPricePerTonne = this.params.getOr(
        'world',
        Param.CarbonPricePerTonne,
        this.scenario.carbonPricePerTonne,
      )

      // 2a. The towns. People first, then their roofs, then re-register what both imply for
      //     demand — in that order, because the roofs are sized on the population and the
      //     demand modifiers are ratios to it.
      //
      //     The rooftop step reads the *tariff*, which is what makes this a feedback loop
      //     rather than a schedule: a utility whose price rises is subsidising its customers'
      //     departure, and the panels that result never come off the roof.
      stepCityGrowth(this.cities, this.tick, this.rng.streamFor('city'))
      const retail = this.params.getOr('world', Param.TariffPerMwh, this.scenario.tariffPerMwh)
      stepRooftop(this.cities, retail, date.year, this.rooftopSupportPerMwh())
      this.registry.setSource(GROWTH_SOURCE, growthModifiers(this.cities, date.year, this.scenario.startYear))
    }

    // 2b. Technology and prices, annually. Nothing in here changes within a year: a learning
    //     curve does not move overnight, and inflation is quoted per annum. Re-registered when
    //     the fleet changes as well, because a newly commissioned plant needs its vintage.
    if (isYearBoundary(this.tick) || this.tick === 1 || this.techDirty) {
      this.applyTechTrends()
    }

    // 3. Forced outages. A state transition, not a modifier: the unit is out, not derated.
    this.rollOutages()
    this.rollLineFaults()

    // 3b. Events. Raised, landed and retired here, before anything reads a parameter, so an
    //     event that lands this hour is felt this hour rather than next.
    const pendingBefore = new Set(this.director.state.pending.map((p) => p.uid))
    const events = this.director.step({
      tick: this.tick,
      year: date.year,
      weather: this.weather,
      plants: this.plants,
      cities: this.cities,
      network: this.network,
      finances: this.finances,
      publicOpinion: this.state.publicOpinion,
      maintenanceLevel: this.state.maintenanceLevel,
      insured: this.state.insured,
      recentBlackout: this.recentBlackoutTicks > 0,
      registry: this.registry,
      stream: this.rng.streamFor('events'),
    })
    if (events.spent > 0) chargeEventCost(this.openLedger, events.spent)

    // Two moments per event and they are different news. A forewarning is an *invitation to act*
    // and is the whole point of the director's warning period; the landing is what the player
    // then lives with. Reporting only the landing would file the story after the deadline for
    // doing anything about it had passed.
    for (const pending of this.director.state.pending) {
      if (pendingBefore.has(pending.uid)) continue
      const def = EVENTS_BY_ID.get(pending.defId)
      if (!def) continue
      // Only where there is genuinely a warning. Technical and natural events land the hour they
      // are raised — that is the design, and it is what insurance rather than foresight is for —
      // so a headline reading "expected in 0 hours" would be a lie dressed as a warning. The
      // landing below reports those.
      if (pending.landsTick <= this.tick) continue
      this.postNews({
        category: 'event',
        importance: NewsImportance.Major,
        titleKey: 'news.eventForewarned',
        params: { event: def.nameKey, hours: Math.max(0, pending.landsTick - this.tick) },
      })
    }
    for (const active of events.landed) {
      const def = EVENTS_BY_ID.get(active.defId)
      if (!def) continue
      this.postNews({
        category: 'event',
        importance: NewsImportance.Major,
        titleKey: 'news.eventLanded',
        params: { event: def.nameKey },
      })
      // A project held up gets its own headline, naming the site and pointing at it. The event
      // headline alone said something had happened somewhere; this says what and where, and is
      // still there in the archive months later when the player wonders why a station is late.
      if (active.delayedPlantId) {
        this.postNews({
          category: 'construction',
          importance: NewsImportance.Major,
          titleKey: 'news.buildDelayed',
          params: {
            plant: this.plantDisplayName(active.delayedPlantId),
            months: Math.round((active.delayTicks ?? 0) / TICKS_PER_MONTH),
          },
          subjectId: active.delayedPlantId,
          subjectKind: 'plant',
        })
      }
    }

    // 4. Lifecycle transitions (construction finishing, dismantling completing) and the
    //    instalments owed on whatever is still being built.
    this.advanceLifecycles()
    this.payInstalments()

    // 5. Storage decides before the flow problem is posed, and it plans forward rather than
    //    reacting to the recent past. See `dispatch/storage.ts` for why that matters.
    this.lastForecast = forecastResidualLoad({
      weatherModel: this.weatherModel,
      plants: this.plants,
      cities: this.cities,
      params: this.params,
      // One tick back, so the window starts with the hour being solved.
      fromTick: this.tick - 1,
      snowpackMm: this.weather.snowpackMm,
      hours: FORECAST_WINDOW_HOURS,
      year: date.year,
      startYear: this.scenario.startYear,
      siteWindFactor: (plant) => {
        const node = this.network.getNode(plant.nodeId)
        return node ? windSiteFactor(this.terrain, node.x, node.y) : 1
      },
    })

    const storagePlans = planStorage({
      plants: this.plants,
      params: this.params,
      priceHistory: this.priceWindow,
      recentShortage: (this.lastDispatch?.totalUnservedMw ?? 0) > 0.01,
      forecast: this.lastForecast,
    })
    this.lastStoragePlans = storagePlans

    // 6. Heat, before electricity and on purpose. A cogeneration unit's heat duty is not
    //    negotiable — people have to be warm — so it is settled first and arrives at the
    //    electrical dispatch as a constraint rather than an option. See `heat/heat.ts`.
    const heat = dispatchHeat({
      network: this.network,
      islands: this.heatIslands.get(),
      plants: this.plants,
      cities: this.cities,
      params: this.params,
      carbonPrice: this.state.carbonPricePerTonne,
      // Last hour's clearing price is the best estimate available of what the electricity a
      // cogeneration unit gives up is worth. Using this hour's would be circular.
      electricityPricePerMwh: this.lastSystemPrice,
      prices: this.prices,
    })
    this.lastHeat = heat

    // 6b. What the roofs are doing this hour, and how it splits between the meter and the
    //     feeder. Computed before the dispatch because both halves change the problem: the
    //     self-consumed part shrinks the demand arc, and the exported part is an offer.
    const rooftopBid = this.rooftopBidPerMwh()
    const rooftop = new Map<string, { selfUseMw: number; exportMw: number; bidPerMwh: number }>()
    for (const city of this.cities) {
      if (city.rooftopSolarMw <= 0) continue
      const output = rooftopOutputMw(city, this.weather)
      if (output <= 0) continue
      const split = rooftopSplit(output, this.params.get(city.id, Param.DemandMw))
      rooftop.set(city.id, { ...split, bidPerMwh: rooftopBid })
    }

    // 7. Dispatch.
    const result = dispatch({
      network: this.network,
      islands: this.electricIslands.get(),
      plants: this.plants,
      cities: this.cities,
      params: this.params,
      carbonPrice: this.state.carbonPricePerTonne,
      storagePlans,
      chpCommitments: heat.commitments,
      auxDemand: heat.pumpingDemandMw,
      prices: this.prices,
      ...(rooftop.size > 0 ? { rooftop } : {}),
      // Last hour's losses are an excellent first guess at this hour's, because load moves
      // slowly. Same fixed point, roughly half the solves to reach it.
      ...(this.lastLossDemand ? { initialLossDemand: this.lastLossDemand } : {}),
    })
    this.lastDispatch = result
    this.lastLossDemand = lossDemandOf(result, this.network)

    // 8. Money and wear from what actually ran.
    const tariff = this.params.getOr('world', Param.TariffPerMwh, this.scenario.tariffPerMwh)
    const heatTariff = this.params.getOr('world', Param.HeatTariffPerMwh, this.scenario.heatTariffPerMwh)
    for (const plant of this.plants) {
      const mw = result.generationMw.get(plant.id) ?? 0
      const heatMw = heat.heatMw.get(plant.id) ?? 0
      if (isStorage(plant)) {
        settleStorage(plant, storagePlans.get(plant.id), mw)
        // Only the discharge burns variable cost; charging is bought energy, not fuel.
        chargeGeneration(this.openLedger, plant, Math.max(0, mw), this.params, this.state.carbonPricePerTonne)
        continue
      }
      if (isHeatStore(plant)) {
        settleHeatStore(plant, heatMw)
        chargeGeneration(this.openLedger, plant, 0, this.params, this.state.carbonPricePerTonne, Math.max(0, heatMw))
        continue
      }
      if (mw > 0 && plant.outputMw <= 0) plant.cumulativeStarts++
      plant.outputMw = mw
      plant.heatOutputMw = heatMw
      // One call, both commodities: a cogeneration unit's fuel bill cannot be split between
      // them after the fact. See `thermalInputMwh`.
      chargeGeneration(this.openLedger, plant, mw, this.params, this.state.carbonPricePerTonne, heatMw)
      advanceCondition(plant, this.tick, mw > 0 || heatMw > 0)
    }

    // --- Per-asset accounts --------------------------------------------
    //
    // Every asset is valued twice, every hour, and the two numbers are kept apart on purpose.
    //
    // At the **tariff**, because that is what this firm is paid. It generates, carries and bills;
    // there is no market and no counterparty, so the price of an internal transfer is the price
    // the company actually receives. This basis reconciles with the cash on screen, and it is the
    // one to answer "can I afford to keep this?" with.
    //
    // At the **nodal price**, because that is what the hour was worth where it happened. This is
    // what the same machine would have earned as a merchant, and it is the only basis on which a
    // peaker that stands idle for a year and then earns it back in forty February hours makes any
    // sense at all. On its own it is misleading — it was the first version of this code, and it
    // showed the inherited gas station eight and a half billion up while the utility's cash fell —
    // because scarcity hours are priced at the value of lost load and no tariff ever pays that.
    // Beside the regulated figure it is exactly the comparison worth having.
    // Heat is credited here on the same principle, and it has to be: a heat-only boiler generates
    // no electricity at all, so on the electrical side alone it is a machine with costs and no
    // product — which is not a diagnosis, it is a missing column. A cogeneration unit has the
    // opposite problem, since its fuel bill covers both jobs and charging all of it against the
    // electricity would condemn the unit for doing the thing it was built to do. So both products
    // are credited at their own tariff and the fuel is taken once, from `thermalInputMwh`, which
    // is the same function the utility's own books use.
    for (const plant of this.plants) {
      const signed = result.generationMw.get(plant.id) ?? 0
      const mw = Math.max(0, signed)
      const heatMw = Math.max(0, plant.heatOutputMw)
      const nodal = result.nodalPrice.get(plant.nodeId) ?? tariff

      // A store that is charging is buying, not producing. Booked as a purchase on both bases,
      // which is what makes storage read correctly: at a flat tariff it buys and sells at the
      // same price and loses its round-trip efficiency every cycle, and only at prices that move
      // does it earn anything. That contrast is the point of keeping two columns.
      if (signed < 0) {
        const drawn = -signed
        const charging = this.books.for(plant.id).open
        charging.energyCost += drawn * tariff
        charging.marketEnergyCost += drawn * nodal
      }

      if (mw <= 0 && heatMw <= 0) continue
      const book = this.books.for(plant.id).open
      book.energyMwh += mw
      book.heatMwh += heatMw
      book.revenue += mw * tariff + heatMw * heatTariff
      // Heat is on the same terms in both views: district heat is sold to a town at a regulated
      // price in every industry structure there is, so there is no second price to show.
      book.marketRevenue += mw * nodal + heatMw * heatTariff
      const type = PLANT_TYPES[plant.typeId]
      book.varOpex += (mw + heatMw) * this.params.getOr(plant.id, Param.VarOpexPerMwh, 0)
      if (type.fuel !== 'none') {
        const thermal = thermalInputMwh(plant, mw, heatMw, this.params)
        book.fuelCost += thermal * this.params.get(plant.id, Param.FuelPricePerMwhThermal)
        const co2 = thermal * FUELS[type.fuel].co2PerMwhThermal.value
        book.co2Tonnes += co2
        book.carbonCost += co2 * this.state.carbonPricePerTonne
      }
    }

    // A line in an integrated utility sells nothing, so on the regulated basis it has no revenue.
    // What it has is a cost: the energy it consumed getting the rest of the way. Charging those
    // losses at the same tariff the plants are credited at makes the whole ranking close on the
    // firm's own revenue — generated × tariff, less lost × tariff, is served × tariff — and turns
    // the network from an asset class with no accounts into the cost centre it actually is.
    //
    // On the market basis the same line is a business: it earns the congestion rent, which is what
    // an unbundled carrier is paid and what a second circuit would be worth. Both are recorded.
    for (const edge of this.network.allEdges()) {
      if (edge.commodity !== 'electric' || !edge.energised) continue
      const flow = result.lineFlowMw.get(edge.id) ?? 0
      if (Math.abs(flow) < 1e-6) continue
      const book = this.books.for(edge.id).open
      const fromPrice = result.nodalPrice.get(edge.from) ?? 0
      const toPrice = result.nodalPrice.get(edge.to) ?? 0
      // Signed flow: positive means from -> to, so the rent is earned on that direction's spread.
      const spread = flow > 0 ? toPrice - fromPrice : fromPrice - toPrice
      const loss = result.lineLossMw.get(edge.id) ?? 0
      const rent = Math.abs(flow) * Math.max(0, spread)
      book.energyMwh += Math.abs(flow)
      book.congestionRent += rent
      // A carrier's entire income in an unbundled market is the rent. In this firm it is nobody's
      // income, which is why it lands in the market column and not in `revenue`.
      book.marketRevenue += rent
      book.lossMwh += loss
      book.energyCost += loss * tariff
      // Losses are bought where they occur, so at the average of the two ends' prices — the only
      // defensible single number when a corridor spans a price difference.
      book.marketEnergyCost += loss * ((fromPrice + toPrice) / 2)
      if (edge.kv !== 0) {
        const capacity = LINE_TYPES[edge.kv].capacityMw.value * edge.circuits
        if (capacity > 0 && Math.abs(flow) >= capacity * 0.99) book.congestedHours++
      }
    }

    let served = 0
    for (const city of this.cities) {
      const s = result.servedMw.get(city.id) ?? 0
      const u = result.unservedMw.get(city.id) ?? 0
      const coldMw = heat.unservedHeatMw.get(city.id) ?? 0
      served += s
      if (u > 0.01 || coldMw > 0.01) {
        city.unservedTicksRecent++
        // A cold February is remembered longer than a dark evening, and the numbers say so.
        city.satisfaction = Math.max(0, city.satisfaction - (coldMw > 0.01 ? 0.05 : 0.02))
      } else {
        city.satisfaction = Math.min(1, city.satisfaction + 0.0005)
      }
    }
    creditSales(this.openLedger, served, tariff)
    chargeUnserved(this.openLedger, result.totalUnservedMw, this.prices)

    // Paid for whether the utility wanted the energy or not — that is what must-take means, and
    // it is the whole reason the household would rather pay to stay on than be curtailed. Only
    // what was actually absorbed is paid for here; curtailed export is the household's loss, and
    // in most countries the subject of a lawsuit.
    if (result.totalRooftopExportMw > 0) {
      this.openLedger.rooftopPurchases += result.totalRooftopExportMw * this.rooftopSupportPerMwh()
    }

    let heatServed = 0
    for (const city of this.cities) heatServed += heat.servedHeatMw.get(city.id) ?? 0
    creditHeatSales(this.openLedger, heatServed, heatTariff)
    chargeUnservedHeat(this.openLedger, heat.totalUnservedHeatMw, this.prices)

    // 9. Close the period if the month turned.
    if (isMonthBoundary(this.tick)) this.closePeriod()
    if (isYearBoundary(this.tick)) this.closeYear()

    // A shortfall beginning is news; one ending is a relief. Only the rising edge is filed,
    // because a fortnight of intermittent failure would otherwise produce a hundred identical
    // headlines and the player would stop reading the feed — which is the only real failure
    // mode a notification system has.
    const short = result.totalUnservedMw > UNSERVED_EPSILON_MW || heat.totalUnservedHeatMw > 0.01
    if (short && this.recentBlackoutTicks === 0) {
      const worst = this.worstServedCity(result, heat)
      const cold = heat.totalUnservedHeatMw > 0.01
      // Named where a town can be named and unnamed where it cannot, rather than leaving a blank
      // where the place should be. A headline with a hole in it reads as a bug, which is exactly
      // what the player will conclude.
      this.postNews({
        category: 'reliability',
        importance: NewsImportance.Major,
        titleKey: cold
          ? worst
            ? 'news.heatFailure'
            : 'news.heatFailureAnon'
          : worst
            ? 'news.blackout'
            : 'news.blackoutAnon',
        params: {
          mw: Math.round(Math.max(result.totalUnservedMw, heat.totalUnservedHeatMw)),
          city: worst ? this.nodeName(worst.nodeId) : '',
        },
        ...(worst ? { subjectId: worst.nodeId, subjectKind: 'node' as const } : {}),
      })
    }

    // A rolling memory of failure, which several event risk factors read. Decays over a month,
    // so one bad evening does not brand the utility for a year.
    this.recentBlackoutTicks =
      result.totalUnservedMw > 0.01 || heat.totalUnservedHeatMw > 0.01
        ? BLACKOUT_MEMORY_TICKS
        : Math.max(0, this.recentBlackoutTicks - 1)

    const snapshot = this.makeSnapshot(date, result, heat)
    this.lastSystemPrice = snapshot.pricePerMwh
    // What the voters will be judging at the end of the term. Every hour counts here, scarcity
    // included: people paid those prices and they remember them.
    this.termPriceSum += snapshot.pricePerMwh
    this.termPriceTicks++

    for (const plant of this.plants) {
      const mw = result.generationMw.get(plant.id) ?? 0
      if (mw <= 0) continue
      const type = PLANT_TYPES[plant.typeId]
      this.termGenerationByFuel.set(type.fuel, (this.termGenerationByFuel.get(type.fuel) ?? 0) + mw)
      const band = mixBand(plant.typeId)
      this.yearMix[band] = (this.yearMix[band] ?? 0) + mw
    }
    if (result.totalRooftopExportMw > 0) {
      this.yearMix.solar = (this.yearMix.solar ?? 0) + result.totalRooftopExportMw
    }
    // The first hour the market ever pays people to stop generating is a genuinely new fact
    // about the system, and it arrives without anything visibly happening. Reported once a year
    // at most, because after the first summer it is weather rather than news.
    if (snapshot.pricePerMwh < -0.5 && date.year > this.lastNegativePriceYear) {
      this.lastNegativePriceYear = date.year
      this.postNews({
        category: 'market',
        importance: NewsImportance.Notable,
        titleKey: 'news.negativePrice',
        params: { price: Math.round(snapshot.pricePerMwh) },
      })
    }

    this.priceWindow.push(snapshot.pricePerMwh)
    if (this.priceWindow.length > PRICE_WINDOW_TICKS) this.priceWindow.shift()
    this.history[this.historyCount % HISTORY_LENGTH] = snapshot
    this.historyCount++
    return snapshot
  }

  private rollOutages(): void {
    const stream = this.rng.streamFor('outage')
    for (let i = 0; i < this.plants.length; i++) {
      const plant = this.plants[i]!
      if (plant.phase !== LifecyclePhase.Operating) continue
      // Wear makes failure more likely, age makes it likelier still, and maintenance makes it
      // less likely. One function, shared with the forecast that warns about it — see
      // `assets/aging.ts`.
      const rate = forcedOutageRate(plant, this.tick, this.state.maintenanceLevel)
      // Convert an annual availability figure into an hourly transition probability.
      const failPerHour = rate / 400
      const repairPerHour = 1 / 72
      if (plant.online) {
        if (!stream.chance(this.tick, failPerHour, i)) continue
        plant.online = false
        // And sometimes it does not come back. A cracked casing or a failed stator on a machine
        // past its design life is not a six-week outage, it is the end of the unit — and the
        // owner finds out that the replacement takes six years. This is what stops an ageing
        // fleet from being a slow cost the player can simply absorb for ever.
        const terminal = terminalFailureShare(plant, this.tick)
        if (terminal > 0 && stream.chance(this.tick, terminal, i + 500_000)) {
          this.forceRetirement(plant)
        }
      } else if (stream.chance(this.tick, repairPerHour, i + 100_000)) {
        plant.online = true
      }
    }
  }

  /**
   * Lines fault, individually and briefly.
   *
   * Not the forced outage of a machine, which is measured in weeks: lightning, a tree, ice, an
   * excavator, and it is back inside a day. What makes it interesting is not the duration but the
   * *place* — a corridor down for eighteen hours in a February peak is a region islanded from its
   * generation, and the flow problem models exactly that without another line of code.
   */
  private rollLineFaults(): void {
    const stream = this.rng.streamFor('lineFault')
    const edges = this.network.allEdges()
    for (let i = 0; i < edges.length; i++) {
      const edge = edges[i]!
      if (edge.commodity !== 'electric' || edge.kv === 0) continue
      advanceLineCondition(edge, this.tick)

      if (edge.faultUntilTick !== undefined) {
        if (this.tick < edge.faultUntilTick) continue
        delete edge.faultUntilTick
        this.network.setEnergised(edge.id, true)
        continue
      }
      // A line still under construction is not a line that can fault.
      if (!edge.energised) continue

      const rate = lineFaultRate(edge, this.state.maintenanceLevel) * lineWearFactor(edge, this.tick)
      if (!stream.chance(this.tick, rate / TICKS_PER_YEAR, i)) continue

      const hours = repairTicks(edge)
      edge.faultUntilTick = this.tick + hours
      this.network.setEnergised(edge.id, false)
      this.postNews({
        category: 'grid',
        importance: NewsImportance.Major,
        titleKey: 'news.lineFault',
        params: { from: this.nodeName(edge.from), to: this.nodeName(edge.to), hours },
        subjectId: edge.id,
        subjectKind: 'edge',
      })
    }
  }

  /**
   * A machine that has failed beyond repair. Dismantled on the same terms as a chosen closure,
   * because the work is the same work and the bill does not care why.
   */
  private forceRetirement(plant: PlantAsset): void {
    const type = PLANT_TYPES[plant.typeId]
    const capacityMw = this.params.get(plant.id, Param.CapacityMw)
    const cost =
      nominal(type.decommissionCostPerKw, this.date.year) *
      realDecommissioningFactor(this.date.year, type.decommissionCostPerKw.sourceYear) *
      capacityMw *
      1000
    const ticks = Math.max(1, Math.round(type.decommissionYears.value * TICKS_PER_YEAR))

    plant.phase = LifecyclePhase.Decommissioning
    plant.phaseEndsTick = this.tick + ticks
    plant.outputMw = 0
    plant.heatOutputMw = 0
    this.scheduleSpending(plant.id, cost, ticks, 'decommissioning')
    this.postNews({
      category: 'fleet',
      importance: NewsImportance.Major,
      titleKey: 'news.terminalFailure',
      params: {
        plant: this.plantName(plant.id),
        mw: Math.round(capacityMw),
        years: Math.round(ageYears(plant, this.tick)),
      },
      subjectId: plant.id,
      subjectKind: 'plant',
    })
  }

  private advanceLifecycles(): void {
    for (const plant of this.plants) {
      if (plant.phase === LifecyclePhase.Building && this.tick >= plant.phaseEndsTick) {
        plant.phase = LifecyclePhase.Operating
        plant.commissionedTick = this.tick
        plant.conditionPct = 1
        plant.online = true
        plant.capexPaid = this.params.get(plant.id, Param.CapexPerKw) * this.params.get(plant.id, Param.CapacityMw) * 1000
        this.postNews({
          category: 'construction',
          importance: NewsImportance.Major,
          titleKey: 'news.plantCommissioned',
          params: {
            plant: this.plantName(plant.id),
            mw: Math.round(this.params.get(plant.id, Param.CapacityMw)),
          },
          subjectId: plant.id,
          subjectKind: 'plant',
        })
      } else if (plant.phase === LifecyclePhase.Refurbishing && this.tick >= plant.phaseEndsTick) {
        const type = PLANT_TYPES[plant.typeId]
        // Diminishing returns: each overhaul buys less than the one before.
        const escalation = 1 / (1 + plant.refurbishments * 0.5)
        plant.refurbishments++
        plant.lifeExtension += type.refurbishLifeExtension.value * escalation
        plant.efficiencyUplift += type.refurbishEfficiencyGain.value * escalation
        plant.capacityUplift += type.refurbishCapacityGain.value * escalation
        // Worn parts are gone, but the shell and the foundations are still the old ones.
        plant.conditionPct = Math.min(1, plant.conditionPct + 0.55 * escalation)
        // Replacing the cells is replacing the thing that wears out.
        if (PLANT_TYPES[plant.typeId].storage?.cycleLife) plant.cyclesUsed = 0
        plant.phase = LifecyclePhase.Operating
        plant.online = true
        this.postNews({
          category: 'construction',
          importance: NewsImportance.Notable,
          titleKey: 'news.plantRefurbished',
          params: { plant: this.plantName(plant.id) },
          subjectId: plant.id,
          subjectKind: 'plant',
        })
      } else if (plant.phase === LifecyclePhase.Decommissioning && this.tick >= plant.phaseEndsTick) {
        const type = PLANT_TYPES[plant.typeId]
        plant.phase = LifecyclePhase.Remediating
        plant.phaseEndsTick = this.tick + Math.round(type.remediationYears.value * TICKS_PER_YEAR)
        // Scrap value comes back only once the machine is actually dismantled.
        // Scrap is a commodity, so it inflates but does not learn — and neither does the bill
        // for the dismantling that produced it, which is charged at today's labour rates.
        creditRecycling(
          this.openLedger,
          nominal(type.recyclingRecoveryPerKw, this.date.year) * type.capacityMw.value * 1000,
        )
        this.postNews({
          category: 'fleet',
          importance: NewsImportance.Notable,
          titleKey: 'news.plantDismantled',
          params: { plant: this.plantName(plant.id) },
          subjectId: plant.id,
          subjectKind: 'plant',
        })
      } else if (plant.phase === LifecyclePhase.Remediating && this.tick >= plant.phaseEndsTick) {
        plant.phase = LifecyclePhase.Cleared
        this.postNews({
          category: 'fleet',
          importance: NewsImportance.Routine,
          titleKey: 'news.siteCleared',
          params: { plant: this.plantName(plant.id) },
          subjectId: plant.id,
          subjectKind: 'plant',
        })
      }
    }

    // A finished line joins the grid. Until then it exists on the map but carries nothing,
    // which is what makes the construction time mean something.
    //
    // Both ends have to be finished too, not just the line. A corridor may be run to a station
    // that is still being dug — that is how the work is really sequenced, the two contracts
    // proceeding side by side — and it simply waits for the compound before it is switched in.
    // Forbidding the order instead would have made the player stand idle for the station's whole
    // build before starting a line that takes years of its own.
    if (this.energiseAt.size > 0) {
      for (const [edgeId, tick] of [...this.energiseAt]) {
        if (this.tick < tick) continue
        const edge = this.network.getEdge(edgeId)
        if (!edge) {
          this.energiseAt.delete(edgeId)
          continue
        }
        const ends = [this.network.getNode(edge.from), this.network.getNode(edge.to)]
        if (ends.some((n) => n && !nodeInService(n, this.tick))) continue
        this.energiseAt.delete(edgeId)
        this.network.setEnergised(edgeId, true)
        this.postNews({
          category: 'grid',
          importance: NewsImportance.Major,
          titleKey: edge.commodity === 'heat' ? 'news.pipeEnergised' : 'news.lineEnergised',
          params: { from: this.nodeName(edge.from), to: this.nodeName(edge.to), kv: edge.kv },
          subjectId: edgeId,
          subjectKind: 'edge',
        })
      }
    }

    // A switching station finishing. Kept on the node, like the second-circuit upgrade below and
    // for the same reason: the nodes are saved wholesale, so a field on the node survives a save
    // with no format work, and there is exactly one place that decides whether it is in service.
    for (const node of this.network.allNodes()) {
      if (node.inServiceTick === undefined || this.tick !== node.inServiceTick) continue
      this.postNews({
        category: 'grid',
        importance: NewsImportance.Major,
        titleKey: 'news.substationBuilt',
        params: { kv: node.kvLevels?.join('/') ?? '' },
        subjectId: node.id,
        subjectKind: 'node',
      })
    }

    // A second circuit strung on towers that are already standing. Kept on the edge rather than
    // in a side table because, unlike energising, it is a change to what the line *is* — and the
    // edges are saved wholesale, so it survives a save without any format work at all.
    for (const edge of this.network.allEdges()) {
      if (edge.upgradeAtTick === undefined || this.tick < edge.upgradeAtTick) continue
      const wasKv = edge.kv
      const wasCircuits = edge.circuits
      edge.circuits = edge.upgradeToCircuits ?? edge.circuits
      if (edge.upgradeToKv !== undefined) edge.kv = edge.upgradeToKv
      // Re-conductoring and a voltage rebuild put new metal on the corridor, so the clock starts
      // again. A second circuit on old towers does not: the old conductors are still up there.
      if (edge.upgradeRenewsAge) {
        edge.builtTick = this.tick
        edge.conditionPct = 1
      }
      const uprated = edge.kv !== wasKv
      const renewed = !uprated && edge.circuits === wasCircuits
      // A voltage rebuild replaces the switchgear at both ends — the quote charged for two new
      // stations, and this is where they arrive. Without it a station would end up hosting a
      // voltage it is not built for, which is the thing the connection rules exist to prevent.
      if (uprated && edge.kv !== 0) {
        for (const nodeId of [edge.from, edge.to]) {
          const node = this.network.requireNode(nodeId)
          if (node.kind !== 'substation' || !node.kvLevels) continue
          if (!node.kvLevels.includes(edge.kv)) {
            node.kvLevels = [...node.kvLevels, edge.kv].sort((a, b) => a - b)
          }
        }
      }
      delete edge.upgradeAtTick
      delete edge.upgradeToCircuits
      delete edge.upgradeToKv
      delete edge.upgradeRenewsAge
      this.postNews({
        category: 'grid',
        importance: NewsImportance.Major,
        titleKey: uprated ? 'news.lineUprated' : renewed ? 'news.lineRenewed' : 'news.circuitAdded',
        params: {
          from: this.nodeName(edge.from),
          to: this.nodeName(edge.to),
          circuits: edge.circuits,
          kv: edge.kv,
        },
        subjectId: edge.id,
        subjectKind: 'edge',
      })
    }
  }

  /** Pay this tick's share of everything under construction or being dismantled. */
  private payInstalments(): void {
    for (let i = this.spending.length - 1; i >= 0; i--) {
      const item = this.spending[i]!
      if (item.kind === 'capex') chargeCapex(this.openLedger, item.perTick)
      else chargeDecommissioning(this.openLedger, item.perTick)
      // Attributed to whatever is being built or torn down, so a project's own account carries
      // what it cost rather than the money vanishing into the utility's capital line.
      this.books.for(item.ownerId).open.capital += item.perTick
      item.remainingTicks--
      if (item.remainingTicks <= 0) this.spending.splice(i, 1)
    }
  }

  private closePeriod(): void {
    const ticks = this.tick - this.periodStartTick
    chargeFixedCosts(this.openLedger, this.plants, this.params, ticks, this.state.maintenanceLevel)
    // The same charge again, per machine. Fixed cost is what makes an idle plant expensive, so an
    // account that left it out would flatter exactly the assets a player most needs to question.
    for (const plant of this.plants) {
      if (plant.phase !== LifecyclePhase.Operating && plant.phase !== LifecyclePhase.Mothballed) continue
      const perKwYear = this.params.get(plant.id, Param.FixedOpexPerKwYear)
      const capacityKw = PLANT_TYPES[plant.typeId].capacityMw.value * 1000
      this.books.for(plant.id).open.fixedOpex +=
        perKwYear * capacityKw * (ticks / TICKS_PER_YEAR) * this.state.maintenanceLevel
    }
    // The network costs money to own even when nothing is flowing: vegetation management, tower
    // painting, insulator washing, patrols, easements. The content has carried this figure since
    // the first milestone and nobody was ever charged it — so the network was free, and a network
    // that is free is one the player has no reason to think about.
    for (const edge of this.network.allEdges()) {
      if (edge.commodity !== 'electric' || edge.kv === 0) continue
      const perYear =
        nominal(LINE_TYPES[edge.kv].fixedOpexPerKmYear, this.date.year) *
        edge.lengthKm *
        Math.max(1, edge.circuits) *
        this.state.maintenanceLevel
      const cost = perYear * (ticks / TICKS_PER_YEAR)
      this.openLedger.fixedOpex += cost
      this.books.for(edge.id).open.fixedOpex += cost
    }

    // And the switching stations, for the same reason. Switchgear maintenance, protection
    // testing, the site, and the transformer's no-load losses — which are real energy, burned
    // continuously for as long as the station is energised. Charged from the day it enters
    // service, not from the day it was ordered: nothing is standing there losing anything yet.
    for (const node of this.network.allNodes()) {
      if (node.kind !== 'substation' || !node.kvLevels?.length) continue
      if (!nodeInService(node, this.tick)) continue
      // Every level on the site costs something to keep: a transformer station is two compounds
      // sharing a fence, and both need their switchgear tested.
      const perYear =
        node.kvLevels.reduce(
          (sum, kv) => sum + nominal(LINE_TYPES[kv].substationFixedOpexPerYear, this.date.year),
          0,
        ) * this.state.maintenanceLevel
      const cost = perYear * (ticks / TICKS_PER_YEAR)
      this.openLedger.fixedOpex += cost
      this.books.for(node.id).open.fixedOpex += cost
    }

    if (this.state.insured) chargeInsurance(this.openLedger, this.plants, ticks)
    serviceLoans(this.openLedger, this.finances, ticks)

    // The windfall levy is monthly because it is charged on a price, and a price averaged over a
    // year would never exceed a crisis threshold that a single hard winter month does.
    const regime = REGIMES_BY_ID.get(this.state.policyRegimeId)
    if (regime && this.openLedger.energySoldMwh > 0) {
      const averagePrice = this.termPriceTicks > 0 ? this.termPriceSum / this.termPriceTicks : 0
      chargeWindfallLevy(
        this.openLedger,
        this.openLedger.energySoldMwh,
        averagePrice,
        regime.levers.windfallThresholdPerMwh.value,
        regime.levers.windfallRate.value,
      )
    }
    const solventBefore = !this.finances.bankrupt
    const rescue = settlePeriod(this.finances, this.openLedger, this.tick, this.state.investorConfidence)
    // Being bailed out is news. It used to happen in silence — the shortfall was added to a debt
    // total nothing ever paid down, and the player found out, if at all, by noticing a number had
    // grown. Now it is a dear, short loan with instalments to carry, and saying so is the whole
    // point of having made it one.
    if (rescue) {
      this.postNews({
        category: 'finance',
        importance: NewsImportance.Major,
        titleKey: 'news.emergencyLoan',
        params: {
          amount: Math.round(rescue.principal / 1e6),
          rate: (rescue.ratePerYear * 100).toFixed(1),
          years: Math.round((rescue.maturesTick - rescue.takenTick) / TICKS_PER_YEAR),
        },
      })
    }
    // The hour the money runs out is the hour the clock stops, and it is almost never the first
    // of January — so waiting for the year-end verdict to say anything left the player watching a
    // frozen game with no explanation anywhere. This files it the moment it happens, at the one
    // importance that raises a card over the map whether the news panel is open or not.
    if (solventBefore && this.finances.bankrupt) {
      this.postNews({
        category: 'finance',
        importance: NewsImportance.Major,
        titleKey: 'news.bankrupt',
        params: { debt: Math.round(this.finances.debt / 1e6) },
      })
    }

    this.finances.trailingRevenue = this.finances.trailingRevenue * (11 / 12) + this.openLedger.revenue
    addLedger(this.yearLedger, this.openLedger)
    addLedger(this.lifetimeLedger, this.openLedger)
    this.lastMonthLedger = this.openLedger
    this.openLedger = emptyLedger()
    this.books.closeMonth()
    this.periodStartTick = this.tick
  }

  /**
   * Register everything the government of the day is doing.
   *
   * One call, one source id, so taking office simply replaces the previous government's entire
   * contribution — the same pattern weather and ageing use, and the reason a change of
   * government cannot leave anything of its predecessor behind by accident.
   */
  /**
   * File an item, stamped with the hour it happened.
   *
   * Every caller would otherwise repeat the tick, and a headline stamped with the wrong hour is
   * worse than no headline: the archive is the raw material for a post-mortem.
   */
  private postNews(item: Omit<NewsItem, 'tick'>): void {
    this.news.post({ ...item, tick: this.tick })
  }

  /**
   * What is coming, with a date where there is one and a probability where there is not.
   *
   * Computed on demand from state rather than stored, because a stored forecast is one that can
   * be wrong about the present — and because everything here is already knowable: a construction
   * end tick, an election date, a forewarned event's landing hour, the age of a machine against
   * its design life.
   *
   * The distinction between `whenTicks` and `chance` is deliberate and is the honest part. A
   * station completing in eleven months is a date the player can plan against. A plant of this
   * age suffering a forced outage this year is a risk they can only insure against. Presenting
   * them in the same shape would teach the player to distrust both, so they are different fields
   * and the panel renders them differently.
   */
  upcoming(): UpcomingItem[] {
    const out: UpcomingItem[] = []

    for (const pending of this.director.state.pending) {
      const def = EVENTS_BY_ID.get(pending.defId)
      if (!def) continue
      out.push({
        category: 'event',
        titleKey: 'upcoming.event',
        params: { event: def.nameKey },
        whenTicks: pending.landsTick - this.tick,
      })
    }

    for (const plant of this.plants) {
      if (plant.phase === LifecyclePhase.Building) {
        out.push({
          category: 'construction',
          titleKey: 'upcoming.plantCompletes',
          params: { plant: this.plantName(plant.id) },
          whenTicks: plant.phaseEndsTick - this.tick,
          subjectId: plant.id,
          subjectKind: 'plant',
        })
      } else if (plant.phase === LifecyclePhase.Refurbishing || plant.phase === LifecyclePhase.Decommissioning) {
        out.push({
          category: 'fleet',
          titleKey:
            plant.phase === LifecyclePhase.Refurbishing ? 'upcoming.refurbishEnds' : 'upcoming.dismantlingEnds',
          params: { plant: this.plantName(plant.id) },
          whenTicks: plant.phaseEndsTick - this.tick,
          subjectId: plant.id,
          subjectKind: 'plant',
        })
      } else if (plant.phase === LifecyclePhase.Operating) {
        // End of life, which is the most plannable and most ignored fact in the game. Shown from
        // five years out, because that is roughly how long a replacement takes to permit and
        // build — a warning that arrives later than the lead time is not a warning.
        const ageTicks = this.tick - plant.commissionedTick
        const lifeTicks = plant.designLifeYears * (1 + plant.lifeExtension) * TICKS_PER_YEAR
        const remaining = lifeTicks - ageTicks
        if (remaining < 5 * TICKS_PER_YEAR) {
          out.push({
            category: 'fleet',
            titleKey: 'upcoming.endOfLife',
            params: { plant: this.plantName(plant.id) },
            whenTicks: remaining,
            subjectId: plant.id,
            subjectKind: 'plant',
          })
        }
        // And the risk that it does not get there. The same function `rollOutages` rolls
        // against, so the warning and the dice cannot disagree.
        const rate = forcedOutageRate(plant, this.tick, this.state.maintenanceLevel)
        if (rate > 0.08) {
          out.push({
            category: 'fleet',
            titleKey: 'upcoming.outageRisk',
            params: { plant: this.plantName(plant.id) },
            chance: Math.min(1, rate),
            subjectId: plant.id,
            subjectKind: 'plant',
          })
        }
        // The one worth acting on. A machine that can fail beyond repair is a machine whose
        // replacement should already be under construction, because it will not be after.
        const terminal = terminalFailureShare(plant, this.tick) * rate
        if (terminal > 0.002) {
          out.push({
            category: 'fleet',
            titleKey: 'upcoming.terminalRisk',
            params: { plant: this.plantName(plant.id) },
            chance: Math.min(1, terminal),
            subjectId: plant.id,
            subjectKind: 'plant',
          })
        }
      }
    }

    for (const edge of this.network.allEdges()) {
      if (edge.commodity !== 'electric' || edge.kv === 0 || !edge.energised) continue
      const rate = lineFaultRate(edge, this.state.maintenanceLevel) * lineWearFactor(edge, this.tick)
      if (rate > 0.15) {
        out.push({
          category: 'grid',
          titleKey: 'upcoming.lineFaultRisk',
          params: { from: this.nodeName(edge.from), to: this.nodeName(edge.to) },
          chance: Math.min(1, rate),
          subjectId: edge.id,
          subjectKind: 'edge',
        })
      }
      // Renewal is a plan, not a repair. A corridor whose conductors are past their design life
      // is one to re-string before it starts costing outages, and the warning has to arrive with
      // enough time to do something about it.
      const life = lineLifeFraction(edge, this.tick)
      if (life > 0.85) {
        out.push({
          category: 'grid',
          titleKey: 'upcoming.lineEndOfLife',
          params: { from: this.nodeName(edge.from), to: this.nodeName(edge.to) },
          whenTicks: Math.round((1 - life) * LINE_TYPES[edge.kv].designLifeYears.value * TICKS_PER_YEAR),
          subjectId: edge.id,
          subjectKind: 'edge',
        })
      }
    }

    for (const [edgeId, tick] of this.energiseAt) {
      const edge = this.network.getEdge(edgeId)
      if (!edge) continue
      out.push({
        category: 'grid',
        titleKey: 'upcoming.lineEnergises',
        params: { from: this.nodeName(edge.from), to: this.nodeName(edge.to) },
        whenTicks: tick - this.tick,
        subjectId: edgeId,
        subjectKind: 'edge',
      })
    }
    for (const edge of this.network.allEdges()) {
      if (edge.upgradeAtTick === undefined) continue
      out.push({
        category: 'grid',
        titleKey: 'upcoming.circuitArrives',
        params: { from: this.nodeName(edge.from), to: this.nodeName(edge.to) },
        whenTicks: edge.upgradeAtTick - this.tick,
        subjectId: edge.id,
        subjectKind: 'edge',
      })
    }

    out.push({
      category: 'politics',
      titleKey: 'upcoming.election',
      whenTicks: this.state.nextElectionTick - this.tick,
    })

    // The scenario's own deadline, which a player thirty years in has usually stopped counting.
    const endTick = (this.scenario.endYear - this.scenario.startYear + 1) * TICKS_PER_YEAR
    if (endTick > this.tick) {
      out.push({
        category: 'objective',
        titleKey: 'upcoming.scenarioEnds',
        params: { year: this.scenario.endYear },
        whenTicks: endTick - this.tick,
      })
    }

    // Dates first and soonest first; risks after, worst first. Two orderings because they are
    // two kinds of thing, and interleaving them by any single key produces a list where nothing
    // is where the reader expects it.
    const dated = out.filter((i) => i.whenTicks !== undefined).sort((a, b) => a.whenTicks! - b.whenTicks!)
    const risks = out.filter((i) => i.whenTicks === undefined).sort((a, b) => (b.chance ?? 0) - (a.chance ?? 0))
    return [...dated, ...risks]
  }

  /**
   * File a headline from outside the world's own tick — the build commands, mostly.
   *
   * Public because a command module is not part of the world and should not be reaching into a
   * private, and because keeping the tick stamping in one place is the whole point of it.
   */
  reportNews(item: Omit<NewsItem, 'tick'>): void {
    this.postNews(item)
  }

  /** Which town is worst off this hour, so a shortfall headline can name a place. */
  private worstServedCity(result: DispatchResult, heat: HeatResult): { nodeId: string } | null {
    let worst: { nodeId: string } | null = null
    let most = 0
    for (const city of this.cities) {
      const short = (result.unservedMw.get(city.id) ?? 0) + (heat.unservedHeatMw.get(city.id) ?? 0)
      if (short > most) {
        most = short
        worst = { nodeId: city.nodeId }
      }
    }
    return worst
  }

  /**
   * A plant's name as a player would say it, rather than as it is keyed.
   *
   * Scenario nodes carry a literal name ("Blackridge"); nodes the player built carry a key and an
   * index instead, because "220 kV substation 4" has to be translatable. The simulation has no
   * business knowing what language the interface is in, so a keyed name is returned as the
   * composite `key#index` and expanded by `headline()` in the UI. One convention, documented in
   * both places, and the alternative was importing the translator into the model.
   */
  displayName(nodeId: string): string {
    const node = this.network.getNode(nodeId)
    if (!node) return nodeId.replace(/^n_/, '')
    if (node.name) return node.name
    if (node.nameKey) return node.nameIndex === undefined ? node.nameKey : `${node.nameKey}#${node.nameIndex}`
    return nodeId.replace(/^n_/, '')
  }

  /** The same, for a plant, via the node it stands on. */
  plantDisplayName(plantId: string): string {
    const nodeId = this.plantsById.get(plantId)?.nodeId
    return nodeId ? this.displayName(nodeId) : plantId.replace(/^p_/, '')
  }

  private plantName(plantId: string): string {
    return this.plantDisplayName(plantId)
  }

  nodeName(nodeId: string): string {
    return this.displayName(nodeId)
  }

  private applyRegime(): void {
    this.registry.setSource(
      POLICY_SOURCE,
      policyModifiers(this.state.policyRegimeId, this.scenario.carbonPricePerTonne, this.carbonPriceInForce()),
    )
  }

  /**
   * The carbon price actually being charged, on its way to the one this government legislated.
   *
   * A government does not change the price of carbon on the morning it takes office; it passes a
   * trajectory, and the trajectory lands over its term. Without that, a 1999 election took this
   * scenario's carbon bill from 6 to 59 EUR/MWh between one month and the next — bigger than the
   * whole tariff at the time, on a coal fleet with fifty-year lives, with no warning and nothing
   * the player could do about it in the time available. This project's own fairness rule says
   * political change has to have a run-up the player can see and act on.
   *
   * Interpolated from what was in force when the government took office rather than from the
   * scenario's opening price, so a government that cuts the price phases *down* by the same rule.
   * Nothing here is hidden from the pipeline: this only decides the value of the modifier the
   * policy layer registers, and `explain()` shows both the price in force and where it is going.
   */
  carbonPriceInForce(): number {
    const target =
      REGIMES_BY_ID.get(this.state.policyRegimeId)?.levers.carbonPricePerTonne.value ??
      this.scenario.carbonPricePerTonne
    const years = Math.max(0, (this.tick - this.state.regimeTookOfficeTick) / TICKS_PER_YEAR)
    const phase = Math.max(0, Math.min(1, years / CARBON_PHASE_IN_YEARS.value))
    return this.state.carbonPriceAtTakeover + (target - this.state.carbonPriceAtTakeover) * phase
  }

  /**
   * What a household is paid per MWh it exports.
   *
   * Taken from the government's support offer for solar rather than from a lever of its own. A
   * regime that is paying for solar farms is paying for solar roofs; one that is not, is not.
   * That keeps the political side of this honest — rooftop support is not a separate dial the
   * content author can tune to make a point — and it means withdrawing support hits households
   * and the player's own subsidised plant on the same day, which is what actually happened.
   *
   * The floor is the avoided-cost export payment that exists everywhere even with no scheme at
   * all. It is small, and being small is why negative prices are a phenomenon of the subsidy era
   * rather than a permanent feature.
   */
  private rooftopSupportPerMwh(): number {
    const regime = REGIMES_BY_ID.get(this.state.policyRegimeId)
    const offer = regime?.levers.supportOffers.solar
    const support = offer ? nominal(offer, this.date.year) : 0
    return Math.max(nominal(ROOFTOP.baseExportPricePerMwh, this.date.year), support)
  }

  /**
   * What the roofs bid into the dispatch.
   *
   * Negative, by exactly what the household forfeits by being curtailed. This is not a special
   * case for rooftop: it is the same arithmetic `marginalCostPerMwh` does for any plant on a
   * guaranteed price, and it is the only reason a power market ever clears below zero.
   */
  private rooftopBidPerMwh(): number {
    return -this.rooftopSupportPerMwh()
  }

  /**
   * Cash including the month that has not closed yet.
   *
   * `finances.cash` only moves when a period settles, which is once a game month — six minutes of
   * real time at normal speed. So the single number the player watches most closely sat perfectly
   * still while the thing it measures moved every hour, and every consequence of a decision was
   * invisible until a boundary that gives no warning it is coming.
   *
   * The settled figure stays the authoritative one: borrowing, bankruptcy and the objectives are
   * all judged on it, because a utility is solvent or not at the moment its bills fall due and not
   * on a running total. This is for the display, which needs to move when the world does.
   */
  get liveCash(): number {
    return this.finances.cash + ledgerProfit(this.openLedger)
  }

  /**
   * How much delivered energy a year must have accumulated before its prices are worth resetting
   * the tariff against, taken from the demand the cities actually have.
   */
  private minimumTariffSampleMwh(): number {
    let annualMwh = 0
    for (const city of this.cities) annualMwh += city.baseDemandMw * TICKS_PER_YEAR
    return annualMwh * MIN_TARIFF_SAMPLE_SHARE
  }

  /** Set when the fleet changes, so the Tech layer is rebuilt before the next parameter read. */
  private techDirty = true

  private pricesYear = Number.NaN
  private pricesCache: Prices = pricesFor(0)

  /**
   * Economy-wide prices in this year's money.
   *
   * Cached by year rather than recomputed per tick. These feed the dispatch solver's arc costs,
   * so they are read several times an hour, and they change once a year — which is the same
   * argument that put the whole Tech layer on the annual tier.
   */
  get prices(): Prices {
    const year = this.date.year
    if (year !== this.pricesYear) {
      this.pricesYear = year
      this.pricesCache = pricesFor(year)
    }
    return this.pricesCache
  }

  /**
   * Re-register everything the passage of time does to prices and machines.
   *
   * Standardisation counts only what the player has *commissioned themselves*, which is what
   * `commissionedTick >= 0` means — an inherited station was built by somebody else's engineers
   * with somebody else's supply chain, and inheriting it teaches the player's organisation
   * nothing. Deriving the count rather than storing it also means it cannot fall out of step
   * with the fleet across a save.
   */
  applyTechTrends(): void {
    const builtCount: Record<string, number> = {}
    const builtMw: Record<string, number> = {}
    for (const plant of this.plants) {
      if (plant.commissionedTick < 0) continue
      builtCount[plant.typeId] = (builtCount[plant.typeId] ?? 0) + 1
      builtMw[plant.typeId] = (builtMw[plant.typeId] ?? 0) + PLANT_TYPES[plant.typeId].capacityMw.value
    }
    this.registry.setSource(
      TECH_SOURCE,
      techModifiers(this.date.year, this.plants, this.scenario.startYear, builtMw, builtCount),
    )
    this.techDirty = false
  }

  /**
   * Hold an election, and let the winner take office.
   *
   * The salience it runs on is measured over the whole term rather than the last year, because
   * that is the period voters actually judge — and because a government that presided over three
   * good years and one bad one should not be treated as though only the bad one happened.
   */
  private holdElection(year: number): void {
    const averagePrice = this.termPriceTicks > 0 ? this.termPriceSum / this.termPriceTicks : 0
    const sold = this.yearLedger.energySoldMwh + this.yearLedger.heatSoldMwh
    const unserved = this.yearLedger.energyUnservedMwh + this.yearLedger.heatUnservedMwh
    const inputs = {
      averagePricePerMwh: averagePrice,
      unservedShare: sold + unserved > 0 ? unserved / (sold + unserved) : 0,
      carbonIntensity: sold > 0 ? this.yearLedger.co2Tonnes / sold : 0,
      importExposure: importExposure(this.termGenerationByFuel),
      publicOpinion: this.state.publicOpinion,
    }

    const result = runElection(
      salienceFrom(inputs),
      this.state.policyRegimeId,
      inputs,
      year,
      this.rng.streamFor('election'),
      this.tick,
    )
    this.state.polls = result.shares

    const previousId = this.state.policyRegimeId
    // Captured before the new government's modifiers are registered, because the phase-in starts
    // from what the outgoing one left behind, not from the scenario's opening price.
    this.state.carbonPriceAtTakeover = this.carbonPriceInForce()
    this.state.regimeTookOfficeTick = this.tick
    this.state.policyRegimeId = result.winnerId
    this.state.nextElectionTick = this.tick + Math.round(ELECTION_TERM_YEARS.value * TICKS_PER_YEAR)
    this.termPriceSum = 0
    this.termPriceTicks = 0
    this.termGenerationByFuel = new Map()

    let revoked = 0
    const incoming = REGIMES_BY_ID.get(result.winnerId)
    if (incoming && !incoming.levers.honoursContracts) {
      // The moment that makes support policy worth simulating. Everything promised by every
      // previous government stops, and the country pays for it in the cost of capital.
      const torn = revokeAll(this.state.contracts, this.tick)
      revoked = torn.length
      let destroyed = 0
      for (const contract of torn) {
        const plant = this.plantsById.get(contract.plantId)
        const capacity = plant ? this.params.get(plant.id, Param.CapacityMw) : 0
        destroyed += remainingValue(contract, this.tick) * capacity
      }
      this.state.investorConfidence = confidenceAfterBreach(
        this.state.investorConfidence,
        destroyed,
        this.finances.trailingRevenue,
      )
    }

    this.applyRegime()
    this.lastElection = { year, fromId: previousId, toId: result.winnerId, contractsRevoked: revoked }

    // Two separate pieces of news, because they are two separate facts and the second one is
    // worse. A government changing is politics; a government tearing up the contracts its
    // predecessor signed is the thing that makes every future investment more expensive.
    this.postNews({
      category: 'politics',
      importance: NewsImportance.Major,
      titleKey: previousId === result.winnerId ? 'news.governmentReturned' : 'news.governmentChanged',
      params: {
        government: REGIMES_BY_ID.get(result.winnerId)?.nameKey ?? result.winnerId,
        share: Math.round((result.shares[result.winnerId] ?? 0) * 100),
      },
    })
    // Where this government is taking the price of carbon, and by when. The single most
    // consequential thing an incoming government does to a fleet, and the player has to hear it
    // as an intention with a date rather than discover it as a bill.
    const incomingTarget = incoming?.levers.carbonPricePerTonne.value ?? this.scenario.carbonPricePerTonne
    if (Math.abs(incomingTarget - this.state.carbonPriceAtTakeover) > 1) {
      this.postNews({
        category: 'politics',
        importance: NewsImportance.Major,
        titleKey: incomingTarget > this.state.carbonPriceAtTakeover ? 'news.carbonRising' : 'news.carbonFalling',
        params: {
          from: Math.round(this.state.carbonPriceAtTakeover),
          to: Math.round(incomingTarget),
          years: CARBON_PHASE_IN_YEARS.value,
        },
      })
    }
    if (revoked > 0) {
      this.postNews({
        category: 'politics',
        importance: NewsImportance.Major,
        titleKey: 'news.contractsRevoked',
        params: { count: revoked },
      })
    }
  }

  /**
   * Re-judge the scenario's objectives.
   *
   * Once a year rather than every hour, because an objective is a claim about how the year went
   * and because a continuous failure is permanent — judging it hourly would fail a player for a
   * single bad hour that the year as a whole absorbed.
   */
  judgeObjectives(): void {
    const context = this.objectiveContext()
    this.objectives = evaluateObjectives(this.scenario.objectives, context, this.objectives)
    this.outcome = scenarioOutcome(this.scenario.objectives, this.objectives, context)
  }

  /**
   * What the objectives are measured against, right now.
   *
   * Exposed rather than kept inside `judgeObjectives` so the panel can take a live reading of
   * the same numbers between judgements. The verdict is annual — a continuous objective must not
   * fail on one bad hour — but the *measurement* should be current, or the player watching their
   * unserved-energy allowance drain would be reading a figure up to a year out of date.
   */
  objectiveContext(): ObjectiveContext {
    // The year *including* the month that has not closed yet, for the same reason the accounts
    // panel needed it: a player watching their allowance drain on the fourth of January should
    // not be shown a blank.
    const recentYear = emptyLedger()
    addLedger(recentYear, this.yearLedger)
    addLedger(recentYear, this.openLedger)
    return {
      plants: this.plants,
      finances: this.finances,
      lifetime: this.lifetimeLedger,
      recentYear,
      year: this.date.year,
      endYear: this.scenario.endYear,
    }
  }

  private closeYear(): void {
    // Public opinion follows outcomes the utility produced — reliability and emissions —
    // never the identity of the technologies that produced them.
    const unservedShare =
      this.yearLedger.energySoldMwh > 0
        ? this.yearLedger.energyUnservedMwh / (this.yearLedger.energySoldMwh + this.yearLedger.energyUnservedMwh)
        : 0
    const intensity =
      this.yearLedger.energySoldMwh > 0 ? this.yearLedger.co2Tonnes / this.yearLedger.energySoldMwh : 0
    const target = Math.max(0, Math.min(1, 0.75 - unservedShare * 12 - intensity * 0.35))
    this.state.publicOpinion += (target - this.state.publicOpinion) * 0.4

    // Reset the regulated tariff to what providing the service actually cost — the revenue
    // requirement — rather than to what the market cleared at. See `economy/tariff.ts` for why
    // the old formula could not work: it paid short-run marginal cost plus a supply margin to a
    // firm that owns its own generation, so it recovered no fixed cost and no capital at all, and
    // every strategy that spent money died sooner than one that spent none.
    //
    // A year with almost no energy delivered leaves the tariff where it is rather than dividing a
    // year's costs by a handful of megawatt-hours. That is the safe direction to fail in: it
    // neither rewards the collapse nor compounds it, and a utility in that state has larger
    // problems than its tariff.
    if (this.yearLedger.energySoldMwh >= this.minimumTariffSampleMwh()) {
      const reset = revenueRequirementPerMwh({
        ledger: this.yearLedger,
        rateBase: rateBase(
          this.plants,
          [...this.network.allEdges()],
          (plant) =>
            this.params.getOr(`quote:${plant.typeId}`, Param.CapexPerKw, PLANT_TYPES[plant.typeId].capexPerKw.value),
          this.network.allNodes(),
          this.tick,
        ),
        energySoldMwh: this.yearLedger.energySoldMwh,
      })
      const previous = this.state.regulatedTariffPerMwh
      this.state.regulatedTariffPerMwh = reviewTariff(previous, reset, this.prices.tariffFloorPerMwh)
      // Worth reporting only when it actually moved. The tariff is the number every household's
      // decision to put panels on the roof divides by, so a rise is not merely revenue.
      const change = this.state.regulatedTariffPerMwh - previous
      if (Math.abs(change) > previous * 0.02) {
        this.postNews({
          category: 'market',
          importance: NewsImportance.Notable,
          titleKey: change > 0 ? 'news.tariffRaised' : 'news.tariffCut',
          params: {
            from: Math.round(previous),
            to: Math.round(this.state.regulatedTariffPerMwh),
          },
        })
      }
    }

    // Capacity payments and tax both land on the year, in that order: the payment is income and
    // the tax is charged on what is left of it.
    const capacityPayment = this.params.getOr('world', Param.CapacityPaymentPerKwYear, 0)
    if (capacityPayment > 0) {
      let firmMw = 0
      for (const plant of this.plants) {
        if (!isDispatchable(plant)) continue
        if (PLANT_TYPES[plant.typeId].weatherDependence !== 'none') continue
        firmMw += this.params.get(plant.id, Param.CapacityMw)
      }
      creditCapacityPayment(this.openLedger, firmMw, capacityPayment, TICKS_PER_YEAR)
    }
    chargeCorporateTax(
      this.openLedger,
      ledgerProfit(this.yearLedger),
      this.params.getOr('world', Param.CorporateTaxRate, 0),
    )

    // Trust rebuilds slowly and automatically. It is cheap to lose and expensive to regain,
    // which is the asymmetry that makes repudiation a lasting decision rather than a one-off cost.
    this.state.investorConfidence = Math.min(1, this.state.investorConfidence + CONFIDENCE_RECOVERY_PER_YEAR)

    if (this.tick >= this.state.nextElectionTick) this.holdElection(this.date.year)

    const before = new Map(this.objectives.map((o) => [o.id, o.status]))
    this.judgeObjectives()
    for (const objective of this.objectives) {
      const was = before.get(objective.id)
      if (was === objective.status || objective.status === 'pending') continue
      const def = this.scenario.objectives.find((o) => o.id === objective.id)
      this.postNews({
        category: 'objective',
        importance: objective.status === 'failed' ? NewsImportance.Major : NewsImportance.Notable,
        titleKey: objective.status === 'failed' ? 'news.objectiveFailed' : 'news.objectiveMet',
        params: { objective: def?.descriptionKey ?? objective.id },
      })
    }

    // Taken before the annual ledger is reset, which is the only moment it is complete, and
    // dated to the year that just ended rather than the one this tick opened.
    this.yearbook.push(
      recordYear({
        year: this.date.year - 1,
        ledger: this.yearLedger,
        yearMix: this.yearMix,
        plants: this.plants,
        capacityOf: (plant) => this.params.get(plant.id, Param.CapacityMw),
        rooftopMw: this.cities.reduce((sum, c) => sum + c.rooftopSolarMw, 0),
        tariffPerMwh: this.state.regulatedTariffPerMwh,
        profit: ledgerProfit(this.yearLedger),
        cash: this.finances.cash,
        debt: this.finances.debt,
        regimeId: this.state.policyRegimeId,
      }),
    )
    this.yearLedger = emptyLedger()
    this.yearMix = {}

    this.books.closeYear()
    this.director.startYear()
  }

  /**
   * The price the system is actually clearing at: a demand-weighted average of the nodal
   * prices, which are the solver's dual variables and therefore the true cost of delivering
   * one more MW to each city.
   *
   * The obvious alternative — the marginal cost of the most expensive running unit — is
   * wrong, and wrong in a way that quietly ruins the price signal. A unit held at its
   * technical minimum cannot respond to demand, so it is not the marginal unit; but taking
   * the maximum over everything dispatched makes it set the price anyway. In this scenario
   * that pinned 92% of all hours to a single value and left storage with nothing to arbitrage.
   */
  private systemPrice(result: DispatchResult): number {
    let weighted = 0
    let weight = 0
    for (const city of this.cities) {
      const served = result.servedMw.get(city.id) ?? 0
      const unserved = result.unservedMw.get(city.id) ?? 0
      const demand = served + unserved
      if (demand <= 0) continue
      const nodal = result.nodalPrice.get(city.nodeId)
      if (nodal === undefined || !Number.isFinite(nodal)) continue
      weighted += nodal * demand
      weight += demand
    }
    if (weight <= 0) return 0
    // Deliberately not floored at zero. A market with subsidised must-take generation really
    // does clear below zero, and clamping it away would hide the single clearest signal that
    // there is more generation than the system can use.
    return Math.min(this.prices.valueOfLostLoadPerMwh, weighted / weight)
  }

  private makeSnapshot(date: GameDate, result: DispatchResult, heat: HeatResult): TickSnapshot {
    const mixMw: Record<string, number> = {}
    for (const plant of this.plants) {
      const mw = result.generationMw.get(plant.id) ?? 0
      if (mw <= 0) continue
      const band = mixBand(plant.typeId)
      mixMw[band] = (mixMw[band] ?? 0) + mw
    }
    // Rooftop counts in the mix, because on the chart the player is reading it is generation
    // that arrived and displaced something. Only the exported half: self-consumed energy never
    // touched the system and putting it here would make the mix add up to more than the load.
    if (result.totalRooftopExportMw > 0) {
      mixMw.solar = (mixMw.solar ?? 0) + result.totalRooftopExportMw
    }
    return {
      tick: this.tick,
      date,
      weather: this.weather,
      demandMw: result.totalDemandMw,
      generationMw: result.totalGenerationMw,
      rooftopSelfUseMw: result.totalRooftopSelfUseMw,
      rooftopExportMw: result.totalRooftopExportMw,
      lossMw: result.totalLossMw,
      unservedMw: result.totalUnservedMw,
      pricePerMwh: this.systemPrice(result),
      cash: this.finances.cash,
      debt: this.finances.debt,
      co2Tonnes: this.openLedger.co2Tonnes,
      mixMw,
      heatDemandMw: heat.totalHeatDemandMw,
      heatSuppliedMw: heat.totalHeatSuppliedMw,
      heatUnservedMw: heat.totalUnservedHeatMw,
    }
  }

  /** Total dispatchable capacity right now, for the UI headline. */
  availableCapacityMw(): number {
    let total = 0
    for (const plant of this.plants) {
      if (!isDispatchable(plant)) continue
      total += this.params.get(plant.id, Param.CapacityMw) * this.params.get(plant.id, Param.Availability)
    }
    return total
  }

  /** Profit of the last closed month. */
  lastMonthProfit(): number {
    return ledgerProfit(this.lastMonthLedger)
  }

  /** Node ids that currently host at least one operating plant. Used by the renderer. */
  plantNodes(): NodeId[] {
    return this.plants.filter(isDispatchable).map((p) => p.nodeId)
  }

  static playerOwner(): string {
    return PLAYER
  }

  // -------------------------------------------------------------------------
  // Saving and loading
  // -------------------------------------------------------------------------

  /**
   * Everything that could not be recomputed. See `scenario/save.ts` for why the list is this
   * short — the map, the weather model, the islands, the parameter cache and every chart are all
   * functions of what is here, and the randomness is stateless by construction.
   */
  toSaveData(): SaveData {
    return {
      tick: this.tick,
      weather: this.weather,
      nodes: this.network.allNodes(),
      edges: this.network.allEdges(),
      plants: this.plants,
      cities: this.cities,
      state: this.state,
      finances: this.finances,
      openLedger: this.openLedger,
      lastMonthLedger: this.lastMonthLedger,
      yearLedger: this.yearLedger,
      lifetimeLedger: this.lifetimeLedger,
      periodStartTick: this.periodStartTick,
      serial: this.serial,
      spending: this.spending,
      energiseAt: [...this.energiseAt],
      recentBlackoutTicks: this.recentBlackoutTicks,
      lastSystemPrice: this.lastSystemPrice,
      priceWindow: this.priceWindow,
      termPriceSum: this.termPriceSum,
      termPriceTicks: this.termPriceTicks,
      termGenerationByFuel: [...this.termGenerationByFuel],
      director: this.director.state,
      objectives: this.objectives,
      outcome: this.outcome,
      freePlay: this.freePlay,
      books: this.books.toJSON(),
      news: this.news.toJSON(),
      yearbook: this.yearbook,
      yearMix: this.yearMix,
      modifiers: this.registry.toJSON(),
    }
  }

  /**
   * Replace this world's state with a save.
   *
   * Structured as an overwrite of a freshly constructed world rather than a constructor, so the
   * terrain and the weather model are already built from the scenario's seed and this only has
   * to deal with what genuinely varies. Everything is deep-copied out of the save so a loaded
   * game cannot alias the file it came from — a game that mutated its own save while playing
   * would be a memorable bug.
   */
  applySaveData(data: SaveData): void {
    const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T

    this.tick = data.tick
    this.weather = clone(data.weather)

    for (const node of clone(data.nodes)) this.network.addNode(node)
    for (const edge of clone(data.edges)) this.network.addEdge(edge)

    this.plants.length = 0
    this.plantsById.clear()
    for (const plant of clone(data.plants)) {
      this.plants.push(plant)
      this.plantsById.set(plant.id, plant)
    }

    this.cities.length = 0
    this.citiesById.clear()
    for (const city of clone(data.cities)) {
      this.cities.push(city)
      this.citiesById.set(city.id, city)
    }

    Object.assign(this.state, clone(data.state))
    Object.assign(this.finances, clone(data.finances))

    this.openLedger = clone(data.openLedger)
    this.lastMonthLedger = clone(data.lastMonthLedger)
    this.yearLedger = clone(data.yearLedger)
    this.lifetimeLedger = clone(data.lifetimeLedger)
    this.periodStartTick = data.periodStartTick
    this.serial = data.serial

    this.spending.length = 0
    this.spending.push(...clone(data.spending))
    this.energiseAt.clear()
    for (const [id, tick] of data.energiseAt) this.energiseAt.set(id, tick)

    this.recentBlackoutTicks = data.recentBlackoutTicks
    this.lastSystemPrice = data.lastSystemPrice
    this.priceWindow.length = 0
    this.priceWindow.push(...data.priceWindow)

    this.termPriceSum = data.termPriceSum
    this.termPriceTicks = data.termPriceTicks
    this.termGenerationByFuel = new Map(clone(data.termGenerationByFuel) as Array<[FuelId, number]>)

    Object.assign(this.director.state, clone(data.director))
    this.objectives = clone(data.objectives)
    this.outcome = data.outcome
    // Older saves predate the field. Absent means "never carried on", which is the safe
    // reading: it re-offers the verdict rather than silently resuming a run the player ended.
    this.freePlay = data.freePlay ?? false
    this.books.loadJSON(clone(data.books))
    this.news.loadJSON(clone(data.news))
    this.yearbook.length = 0
    this.yearbook.push(...clone(data.yearbook))
    this.yearMix = clone(data.yearMix)

    this.registry.loadJSON(clone(data.modifiers))
    // The parameter cache is keyed by tick, so it has to be told which tick it is now or the
    // first read after a load would return a value computed for a different year.
    this.params.setTick(this.tick)
  }
}
