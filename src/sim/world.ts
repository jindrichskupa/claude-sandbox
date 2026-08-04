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
import { heatCapacityOf, PLANT_TYPES } from '@content/plantTypes'
import { HEAT_PIPE_TYPES } from '@content/heatPipeTypes'
import { RandomSource } from './core/rng'
import { isMonthBoundary, isYearBoundary, TICKS_PER_YEAR, tickToDate, type GameDate } from './core/time'
import { Network, PLAYER, type NodeId } from './grid/network'
import { IslandCache } from './grid/islands'
import { advanceCondition, agingModifiers, AGE_SOURCE } from './assets/aging'
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
import { ELECTION_TERM_YEARS, REGIMES_BY_ID } from '@content/policies'
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
import { forecastResidualLoad, type ForecastHour } from './dispatch/forecast'
import { EventDirector } from './events/director'
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
  chargeInterest,
  chargeUnserved,
  creditSales,
  emptyLedger,
  ledgerProfit,
  settlePeriod,
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
}

export interface ScenarioObjective {
  id: string
  descriptionKey: string
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
  objectives: ScenarioObjective[]
  /** Guaranteed price per MWh by technology, paid outside the market. */
  feedInTariffs: Partial<Record<string, number>>
}

const HISTORY_LENGTH = TICKS_PER_YEAR
/** How long a failure to supply stays in the utility's reputation, for event risk. */
const BLACKOUT_MEMORY_TICKS = 24 * 30
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
  private termGenerationByFuel = new Map<FuelId, number>()
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
    const type = PLANT_TYPES[plant.typeId]
    const key = plant.typeId
    this.state.cumulativeDeployedMw[key] = (this.state.cumulativeDeployedMw[key] ?? 0) + type.capacityMw.value
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

  scheduleEnergising(edgeId: string, tick: number): void {
    this.energiseAt.set(edgeId, tick)
  }

  get date(): GameDate {
    return tickToDate(this.tick, this.scenario.startYear)
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
    }

    // 3. Forced outages. A state transition, not a modifier: the unit is out, not derated.
    this.rollOutages()

    // 3b. Events. Raised, landed and retired here, before anything reads a parameter, so an
    //     event that lands this hour is felt this hour rather than next.
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
    })
    this.lastHeat = heat

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
    chargeUnserved(this.openLedger, result.totalUnservedMw)

    let heatServed = 0
    for (const city of this.cities) heatServed += heat.servedHeatMw.get(city.id) ?? 0
    creditHeatSales(this.openLedger, heatServed, heatTariff)
    chargeUnservedHeat(this.openLedger, heat.totalUnservedHeatMw)

    // 9. Close the period if the month turned.
    if (isMonthBoundary(this.tick)) this.closePeriod()
    if (isYearBoundary(this.tick)) this.closeYear()

    // A rolling memory of failure, which several event risk factors read. Decays over a month,
    // so one bad evening does not brand the utility for a year.
    this.recentBlackoutTicks =
      result.totalUnservedMw > 0.01 || heat.totalUnservedHeatMw > 0.01
        ? BLACKOUT_MEMORY_TICKS
        : Math.max(0, this.recentBlackoutTicks - 1)

    const snapshot = this.makeSnapshot(date, result, heat)
    this.lastSystemPrice = snapshot.pricePerMwh
    // What the voters will be judging at the end of the term.
    this.termPriceSum += snapshot.pricePerMwh
    this.termPriceTicks++
    for (const plant of this.plants) {
      const mw = result.generationMw.get(plant.id) ?? 0
      if (mw <= 0) continue
      const fuel = PLANT_TYPES[plant.typeId].fuel
      this.termGenerationByFuel.set(fuel, (this.termGenerationByFuel.get(fuel) ?? 0) + mw)
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
      const type = PLANT_TYPES[plant.typeId]
      // Wear makes failure more likely and maintenance makes it less likely — the same lever,
      // pulled in two directions.
      const rate = (type.forcedOutageRate.value * (1 + (1 - plant.conditionPct) * 2)) / this.state.maintenanceLevel
      // Convert an annual availability figure into an hourly transition probability.
      const failPerHour = rate / 400
      const repairPerHour = 1 / 72
      if (plant.online) {
        if (stream.chance(this.tick, failPerHour, i)) plant.online = false
      } else if (stream.chance(this.tick, repairPerHour, i + 100_000)) {
        plant.online = true
      }
    }
  }

  private advanceLifecycles(): void {
    for (const plant of this.plants) {
      if (plant.phase === LifecyclePhase.Building && this.tick >= plant.phaseEndsTick) {
        plant.phase = LifecyclePhase.Operating
        plant.commissionedTick = this.tick
        plant.conditionPct = 1
        plant.online = true
        plant.capexPaid = this.params.get(plant.id, Param.CapexPerKw) * this.params.get(plant.id, Param.CapacityMw) * 1000
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
      } else if (plant.phase === LifecyclePhase.Decommissioning && this.tick >= plant.phaseEndsTick) {
        const type = PLANT_TYPES[plant.typeId]
        plant.phase = LifecyclePhase.Remediating
        plant.phaseEndsTick = this.tick + Math.round(type.remediationYears.value * TICKS_PER_YEAR)
        // Scrap value comes back only once the machine is actually dismantled.
        creditRecycling(this.openLedger, type.recyclingRecoveryPerKw.value * type.capacityMw.value * 1000)
      } else if (plant.phase === LifecyclePhase.Remediating && this.tick >= plant.phaseEndsTick) {
        plant.phase = LifecyclePhase.Cleared
      }
    }

    // A finished line joins the grid. Until then it exists on the map but carries nothing,
    // which is what makes the construction time mean something.
    if (this.energiseAt.size > 0) {
      for (const [edgeId, tick] of [...this.energiseAt]) {
        if (this.tick < tick) continue
        this.energiseAt.delete(edgeId)
        if (this.network.getEdge(edgeId)) this.network.setEnergised(edgeId, true)
      }
    }
  }

  /** Pay this tick's share of everything under construction or being dismantled. */
  private payInstalments(): void {
    for (let i = this.spending.length - 1; i >= 0; i--) {
      const item = this.spending[i]!
      if (item.kind === 'capex') chargeCapex(this.openLedger, item.perTick)
      else chargeDecommissioning(this.openLedger, item.perTick)
      item.remainingTicks--
      if (item.remainingTicks <= 0) this.spending.splice(i, 1)
    }
  }

  private closePeriod(): void {
    const ticks = this.tick - this.periodStartTick
    chargeFixedCosts(this.openLedger, this.plants, this.params, ticks, this.state.maintenanceLevel)
    if (this.state.insured) chargeInsurance(this.openLedger, this.plants, ticks)
    chargeInterest(this.openLedger, this.finances, ticks, this.state.investorConfidence)

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
    settlePeriod(this.finances, this.openLedger)

    this.finances.trailingRevenue = this.finances.trailingRevenue * (11 / 12) + this.openLedger.revenue
    addLedger(this.yearLedger, this.openLedger)
    this.lastMonthLedger = this.openLedger
    this.openLedger = emptyLedger()
    this.periodStartTick = this.tick
  }

  /**
   * Register everything the government of the day is doing.
   *
   * One call, one source id, so taking office simply replaces the previous government's entire
   * contribution — the same pattern weather and ageing use, and the reason a change of
   * government cannot leave anything of its predecessor behind by accident.
   */
  private applyRegime(): void {
    this.registry.setSource(POLICY_SOURCE, policyModifiers(this.state.policyRegimeId, this.scenario.carbonPricePerTonne))
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

    // Reset the regulated tariff against what the market actually cleared at. Sticky downwards,
    // as real regulated tariffs are, so a mild year does not wipe out the ability to recover a
    // hard one.
    const averagePrice = this.termPriceTicks > 0 ? this.termPriceSum / this.termPriceTicks : 0
    const reset = averagePrice * (1 + ECONOMICS.retailMarginOverWholesale.value)
    this.state.regulatedTariffPerMwh = Math.max(
      ECONOMICS.tariffFloorPerMwh.value,
      // Move most of the way, not all: a regulator reviews rather than tracks.
      this.state.regulatedTariffPerMwh + (reset - this.state.regulatedTariffPerMwh) * 0.6,
    )

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

    this.yearLedger = emptyLedger()
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
    return Math.min(ECONOMICS.valueOfLostLoadPerMwh.value, weighted / weight)
  }

  private makeSnapshot(date: GameDate, result: DispatchResult, heat: HeatResult): TickSnapshot {
    const mixMw: Record<string, number> = {}
    for (const plant of this.plants) {
      const mw = result.generationMw.get(plant.id) ?? 0
      if (mw <= 0) continue
      const cat = PLANT_TYPES[plant.typeId].category
      mixMw[cat] = (mixMw[cat] ?? 0) + mw
    }
    return {
      tick: this.tick,
      date,
      weather: this.weather,
      demandMw: result.totalDemandMw,
      generationMw: result.totalGenerationMw,
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
}
