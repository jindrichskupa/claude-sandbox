/**
 * The world: everything the simulation knows, and the tick that advances it.
 *
 * `WorldState` deliberately holds the policy, opinion, carbon-price, fuel-index and
 * technology fields even though the early milestones barely move them. They are the single
 * place later systems write to, and having them in the save format from the start is what
 * keeps those systems additive.
 */

import { ECONOMICS } from '@content/economics'
import { FUELS } from '@content/fuels'
import { LINE_TYPES } from '@content/lineTypes'
import { PLANT_TYPES } from '@content/plantTypes'
import { RandomSource } from './core/rng'
import { isMonthBoundary, isYearBoundary, TICKS_PER_YEAR, tickToDate, type GameDate } from './core/time'
import { Network, PLAYER, type NodeId } from './grid/network'
import { IslandCache } from './grid/islands'
import { advanceCondition, agingModifiers, AGE_SOURCE } from './assets/aging'
import { isDispatchable, LifecyclePhase, type CityAsset, type PlantAsset } from './assets/types'
import { ModifierRegistry } from './params/ModifierRegistry'
import { Params } from './params/Params'
import { Param } from './params/types'
import { dispatch, type DispatchResult } from './dispatch/dispatch'
import { WeatherModel, type ClimateDef, type Weather } from './weather/weather'
import { weatherModifiers, WEATHER_SOURCE } from './weather/effects'
import { generateTerrain, windSiteFactor, type TerrainMap } from './map/terrain'
import { planStorage, settleStorage, isStorage, FORECAST_WINDOW_HOURS, type StoragePlan } from './dispatch/storage'
import { forecastResidualLoad, type ForecastHour } from './dispatch/forecast'
import {
  addLedger,
  chargeCapex,
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
  carbonPricePerTonne: number
  /** Multiplier on all fuel prices. Moved later by markets and geopolitics. */
  fuelPriceIndex: number
  /** Technology level per plant type, 1 = as at scenario start. */
  techLevel: Record<string, number>
  /** Cumulative MW of each technology deployed, which is what drives learning curves. */
  cumulativeDeployedMw: Record<string, number>
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
  carbonPricePerTonne: number
  objectives: ScenarioObjective[]
  /** Guaranteed price per MWh by technology, paid outside the market. */
  feedInTariffs: Partial<Record<string, number>>
}

const HISTORY_LENGTH = TICKS_PER_YEAR
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

  lastDispatch: DispatchResult | null = null
  lastStoragePlans: Map<string, StoragePlan> = new Map()
  /** Residual load for the coming hours, current hour first. Drives storage and the UI. */
  lastForecast: ForecastHour[] = []

  /** Recent prices, feeding the storage arbitrage policy. */
  private readonly priceWindow: number[] = []
  private serial = 0
  private readonly spending: ScheduledSpend[] = []
  private readonly energiseAt = new Map<string, number>()

  constructor(readonly scenario: ScenarioDef) {
    this.rng = new RandomSource(scenario.seed)
    this.terrain = generateTerrain(scenario.seed, scenario.mapWidth, scenario.mapHeight)
    this.weatherModel = new WeatherModel(this.rng, scenario.climate)
    this.electricIslands = new IslandCache(this.network, 'electric')

    this.state = {
      policyRegimeId: 'baseline',
      publicOpinion: 0.5,
      carbonPricePerTonne: scenario.carbonPricePerTonne,
      fuelPriceIndex: 1,
      techLevel: {},
      cumulativeDeployedMw: {},
    }

    this.finances = {
      cash: scenario.startingCash,
      debt: scenario.startingDebt,
      trailingRevenue: 0,
      bankrupt: false,
    }

    this.params = new Params(this.registry, (targetId, param) => this.baseValue(targetId, param))
    this.weather = this.weatherModel.generate(0, 0)
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
          return FUELS[type.fuel].pricePerMwhThermal.value * this.state.fuelPriceIndex
        case Param.FeedInTariffPerMwh:
          return this.scenario.feedInTariffs[plant.typeId] ?? 0
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
    if (edge && param === Param.LineCapacityMw) {
      if (edge.kv === 110 || edge.kv === 220 || edge.kv === 400) {
        return LINE_TYPES[edge.kv].capacityMw.value * edge.circuits
      }
      return 0
    }

    if (targetId === 'world') {
      if (param === Param.CarbonPricePerTonne) return this.state.carbonPricePerTonne
      if (param === Param.TariffPerMwh) return this.scenario.tariffPerMwh
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
    }

    // 3. Forced outages. A state transition, not a modifier: the unit is out, not derated.
    this.rollOutages()

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

    // 6. Dispatch.
    const result = dispatch({
      network: this.network,
      islands: this.electricIslands.get(),
      plants: this.plants,
      cities: this.cities,
      params: this.params,
      carbonPrice: this.state.carbonPricePerTonne,
      storagePlans,
    })
    this.lastDispatch = result

    // 7. Money and wear from what actually ran.
    const tariff = this.params.getOr('world', Param.TariffPerMwh, this.scenario.tariffPerMwh)
    for (const plant of this.plants) {
      const mw = result.generationMw.get(plant.id) ?? 0
      if (isStorage(plant)) {
        settleStorage(plant, storagePlans.get(plant.id), mw)
        // Only the discharge burns variable cost; charging is bought energy, not fuel.
        chargeGeneration(this.openLedger, plant, Math.max(0, mw), this.params, this.state.carbonPricePerTonne)
        continue
      }
      if (mw > 0 && plant.outputMw <= 0) plant.cumulativeStarts++
      plant.outputMw = mw
      chargeGeneration(this.openLedger, plant, mw, this.params, this.state.carbonPricePerTonne)
      advanceCondition(plant, this.tick, mw > 0)
    }

    let served = 0
    for (const city of this.cities) {
      const s = result.servedMw.get(city.id) ?? 0
      const u = result.unservedMw.get(city.id) ?? 0
      served += s
      if (u > 0.01) {
        city.unservedTicksRecent++
        city.satisfaction = Math.max(0, city.satisfaction - 0.02)
      } else {
        city.satisfaction = Math.min(1, city.satisfaction + 0.0005)
      }
    }
    creditSales(this.openLedger, served, tariff)
    chargeUnserved(this.openLedger, result.totalUnservedMw)

    // 8. Close the period if the month turned.
    if (isMonthBoundary(this.tick)) this.closePeriod()
    if (isYearBoundary(this.tick)) this.closeYear()

    const snapshot = this.makeSnapshot(date, result)
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
      // Wear makes failure more likely, which is what gives maintenance a purpose.
      const rate = type.forcedOutageRate.value * (1 + (1 - plant.conditionPct) * 2)
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
    chargeFixedCosts(this.openLedger, this.plants, this.params, ticks)
    chargeInterest(this.openLedger, this.finances, ticks)
    settlePeriod(this.finances, this.openLedger)

    this.finances.trailingRevenue = this.finances.trailingRevenue * (11 / 12) + this.openLedger.revenue
    addLedger(this.yearLedger, this.openLedger)
    this.lastMonthLedger = this.openLedger
    this.openLedger = emptyLedger()
    this.periodStartTick = this.tick
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
    this.yearLedger = emptyLedger()
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

  private makeSnapshot(date: GameDate, result: DispatchResult): TickSnapshot {
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
