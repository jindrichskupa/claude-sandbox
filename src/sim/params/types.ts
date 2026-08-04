/**
 * The parameter system.
 *
 * Ageing, weather, policy, subsidies, technology progress, geopolitics and one-off events
 * all do the same thing: they change a number the simulation is about to use. Rather than
 * scattering special cases through the dispatch and economy code, every such number is a
 * base value passed through an ordered chain of modifiers.
 *
 * Two rules make this work rather than turn into mush:
 *
 *   1. Layer order is declared once, globally, in `LAYER_ORDER`. Never per call site.
 *   2. Modifiers add up *within* a layer and multiply *across* layers. Two 10% wear
 *      penalties make 20%, not 19%; the weather layer then scales whatever survived. Pure
 *      multiplication is the classic trap — six independent -20% penalties quietly leave
 *      you at 26% of the original, which nobody intends and nobody notices.
 *
 * What must NOT go through here (see the design notes): non-linear curves such as a wind
 * turbine's power curve — modify their *inputs* instead; hard constraints such as CHP
 * backpressure or minimum load, which are not scalars; state transitions such as
 * decommissioning, which belong in `lifecyclePhase` rather than an availability of zero;
 * and path-dependent quantities such as learning curves, which are folded into the Tech
 * layer's base value once a month.
 */

/** Every simulation-relevant quantity that external forces are allowed to move. */
export enum Param {
  /** Rated electrical output. */
  CapacityMw,
  /** Fuel-to-electricity conversion efficiency. */
  Efficiency,
  /** Fraction of rated output actually obtainable right now. */
  Availability,
  /** Non-fuel variable cost per MWh. */
  VarOpexPerMwh,
  /** Annual fixed cost per kW. */
  FixedOpexPerKwYear,
  /** Build cost per kW. */
  CapexPerKw,
  /** Construction duration. */
  BuildTimeMonths,
  /** Fraction of capacity the unit can change per hour. */
  RampRatePerHour,
  /** Fuel cost per MWh thermal. */
  FuelPricePerMwhThermal,
  /** Electricity demand at a city. */
  DemandMw,
  /** Heat demand at a city. Present from the start so the heat milestone is additive. */
  HeatDemandMw,
  /** Thermal rating of a transmission line. */
  LineCapacityMw,
  /** Price of a tonne of CO2. */
  CarbonPricePerTonne,
  /** Price the utility receives per MWh sold. */
  TariffPerMwh,
  /**
   * Guaranteed price a plant is paid per MWh regardless of the market, as under a feed-in
   * tariff or a contract for difference. Zero for everything unsubsidised.
   */
  FeedInTariffPerMwh,
  /** Rated heat output of a cogeneration unit, boiler or accumulator. */
  HeatCapacityMwth,
  /** Heat the district network can carry along one main. */
  PipeCapacityMwth,
  /** Price the utility receives per MWh of heat sold. */
  HeatTariffPerMwh,
  /** Tax on profit, set by the government of the day. */
  CorporateTaxRate,
  /** Annual payment per kW of firm capacity, where a capacity market exists. */
  CapacityPaymentPerKwYear,
}

export const PARAM_COUNT = 20

/** Stable display keys, used by the inspector and by tests. */
export const PARAM_KEYS: Record<Param, string> = {
  [Param.CapacityMw]: 'param.capacityMw',
  [Param.Efficiency]: 'param.efficiency',
  [Param.Availability]: 'param.availability',
  [Param.VarOpexPerMwh]: 'param.varOpex',
  [Param.FixedOpexPerKwYear]: 'param.fixedOpex',
  [Param.CapexPerKw]: 'param.capex',
  [Param.BuildTimeMonths]: 'param.buildTime',
  [Param.RampRatePerHour]: 'param.rampRate',
  [Param.FuelPricePerMwhThermal]: 'param.fuelPrice',
  [Param.DemandMw]: 'param.demand',
  [Param.HeatDemandMw]: 'param.heatDemand',
  [Param.LineCapacityMw]: 'param.lineCapacity',
  [Param.CarbonPricePerTonne]: 'param.carbonPrice',
  [Param.TariffPerMwh]: 'param.tariff',
  [Param.FeedInTariffPerMwh]: 'param.feedInTariff',
  [Param.HeatCapacityMwth]: 'param.heatCapacity',
  [Param.PipeCapacityMwth]: 'param.pipeCapacity',
  [Param.HeatTariffPerMwh]: 'param.heatTariff',
  [Param.CorporateTaxRate]: 'param.corporateTax',
  [Param.CapacityPaymentPerKwYear]: 'param.capacityPayment',
}

/**
 * Sane bounds per parameter. Clamping happens once at the end rather than per layer, so a
 * chain that would drive efficiency negative produces a visible floor instead of nonsense
 * propagating into the economy.
 */
export const PARAM_BOUNDS: Record<Param, { min: number; max: number }> = {
  [Param.CapacityMw]: { min: 0, max: Infinity },
  [Param.Efficiency]: { min: 0.01, max: 0.99 },
  [Param.Availability]: { min: 0, max: 1 },
  [Param.VarOpexPerMwh]: { min: 0, max: Infinity },
  [Param.FixedOpexPerKwYear]: { min: 0, max: Infinity },
  [Param.CapexPerKw]: { min: 0, max: Infinity },
  [Param.BuildTimeMonths]: { min: 1, max: Infinity },
  [Param.RampRatePerHour]: { min: 0.001, max: 1 },
  [Param.FuelPricePerMwhThermal]: { min: 0, max: Infinity },
  [Param.DemandMw]: { min: 0, max: Infinity },
  [Param.HeatDemandMw]: { min: 0, max: Infinity },
  [Param.LineCapacityMw]: { min: 0, max: Infinity },
  [Param.CarbonPricePerTonne]: { min: 0, max: Infinity },
  [Param.TariffPerMwh]: { min: 0, max: Infinity },
  [Param.FeedInTariffPerMwh]: { min: 0, max: Infinity },
  [Param.HeatCapacityMwth]: { min: 0, max: Infinity },
  [Param.PipeCapacityMwth]: { min: 0, max: Infinity },
  [Param.HeatTariffPerMwh]: { min: 0, max: Infinity },
  [Param.CorporateTaxRate]: { min: 0, max: 0.9 },
  [Param.CapacityPaymentPerKwYear]: { min: 0, max: Infinity },
}

/**
 * The global layer order. Later layers scale whatever earlier layers produced.
 *
 * The ordering is not arbitrary: technology sets what this class of machine can do, age
 * says how much of that this particular machine still has, weather says what today's
 * conditions allow, and policy, events and geopolitics are then external shocks applied to
 * the physical result.
 */
export enum Layer {
  Tech,
  Age,
  Weather,
  Policy,
  Event,
  Geopolitics,
}

export const LAYER_ORDER: Layer[] = [
  Layer.Tech,
  Layer.Age,
  Layer.Weather,
  Layer.Policy,
  Layer.Event,
  Layer.Geopolitics,
]

export const LAYER_COUNT = 6

export const LAYER_KEYS: Record<Layer, string> = {
  [Layer.Tech]: 'layer.tech',
  [Layer.Age]: 'layer.age',
  [Layer.Weather]: 'layer.weather',
  [Layer.Policy]: 'layer.policy',
  [Layer.Event]: 'layer.event',
  [Layer.Geopolitics]: 'layer.geopolitics',
}

/**
 * How often a layer's contribution can change. The hot path only recomputes the fast tiers
 * and reuses a cached product of the slow ones.
 */
export enum Tier {
  /** Never changes after load. */
  Static,
  /** Technology level; recomputed yearly. */
  Annual,
  /** Ageing, policy regime, fuel index; recomputed monthly. */
  Monthly,
  /** Weather and events; recomputed every tick. */
  Hourly,
}

export const LAYER_TIER: Record<Layer, Tier> = {
  [Layer.Tech]: Tier.Annual,
  [Layer.Age]: Tier.Monthly,
  [Layer.Weather]: Tier.Hourly,
  [Layer.Policy]: Tier.Monthly,
  [Layer.Event]: Tier.Hourly,
  [Layer.Geopolitics]: Tier.Monthly,
}

/**
 * How a modifier combines.
 *
 * `AddFrac` is the normal case and accumulates within its layer: -0.10 means "10% worse".
 * `AddAbs` is for interval-scale quantities where a percentage is meaningless (a temperature
 * offset, an absolute MW derating).
 *
 * `MulFactor` composes multiplicatively *within* the layer, after the additive terms, and exists
 * for forces that are genuinely ratios rather than adjustments. Thirty years of price inflation
 * and a learning curve are the clearest case: at +80% and -60% respectively, adding them would
 * give +20% where the truth is -28%, and the error grows with the span. Where two effects both
 * scale a quantity, they multiply — using `AddFrac` for them is a bug that only shows up once
 * the numbers get large.
 */
export enum Op {
  AddFrac,
  AddAbs,
  MulFactor,
}

/**
 * A single contribution, carrying enough provenance that the UI can explain the result and
 * a player can learn from it. `reasonKey` is an i18n key, never a rendered string.
 */
export interface Modifier {
  layer: Layer
  param: Param
  op: Op
  value: number
  /** Which system registered this, for grouping and debugging. */
  sourceKind: 'age' | 'weather' | 'policy' | 'event' | 'tech' | 'geopolitics' | 'scenario'
  /** Stable id of the specific source, e.g. an event id. */
  sourceId: string
  reasonKey: string
  /** Interpolated into the reason string, e.g. the ambient temperature. */
  reasonParams?: Record<string, string | number>
  /** Absolute tick after which this modifier stops applying. Undefined means permanent. */
  expiresTick?: number
}

/** One step of an explanation, as shown in the inspector. */
export interface ExplainStep {
  layer: Layer
  reasonKey: string
  reasonParams?: Record<string, string | number>
  op: Op
  value: number
  /** Running value after this layer has been applied. */
  runningValue: number
}

export interface Explanation {
  param: Param
  baseValue: number
  steps: ExplainStep[]
  finalValue: number
  clamped: boolean
}
