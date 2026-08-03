/**
 * Fuels.
 *
 * Prices and emission factors are per MWh of *thermal* energy in the fuel. A plant's
 * electrical cost and emissions follow from its efficiency, which is where the real
 * trade-off lives: a cheap fuel burnt at 38% efficiency can easily lose to an expensive
 * fuel burnt at 60%.
 */

import { sourced, type Sourced } from './schema'

export type FuelId = 'coal' | 'lignite' | 'gas' | 'uranium' | 'biomass' | 'none'

export interface FuelDef {
  id: FuelId
  nameKey: string
  /** Cost of the fuel per MWh of thermal energy. */
  pricePerMwhThermal: Sourced<number>
  /** Combustion CO2 per MWh of thermal energy. */
  co2PerMwhThermal: Sourced<number>
  /**
   * How exposed this fuel is to supply disruption, 0..1. Used later by the geopolitics
   * layer; stored now so the field exists in saves from the first version.
   */
  supplyRisk: Sourced<number>
}

export const FUELS: Record<FuelId, FuelDef> = {
  coal: {
    id: 'coal',
    nameKey: 'fuel.coal',
    pricePerMwhThermal: sourced(12, 'EUR/MWh_th', 'iea-weo', 2023, 'Hard coal; very volatile, 6-25 in the last decade'),
    co2PerMwhThermal: sourced(0.34, 't/MWh_th', 'ipcc-ar5-a3', 2014, 'Hard coal combustion'),
    supplyRisk: sourced(0.4, 'fraction', 'game-design', 2024, 'Seaborne, many suppliers'),
  },
  lignite: {
    id: 'lignite',
    nameKey: 'fuel.lignite',
    pricePerMwhThermal: sourced(6, 'EUR/MWh_th', 'iea-weo', 2023, 'Mine-mouth; cheap but not transportable'),
    co2PerMwhThermal: sourced(0.4, 't/MWh_th', 'ipcc-ar5-a3', 2014, 'Lignite combustion'),
    supplyRisk: sourced(0.1, 'fraction', 'game-design', 2024, 'Domestic, tied to its own mine'),
  },
  gas: {
    id: 'gas',
    nameKey: 'fuel.gas',
    pricePerMwhThermal: sourced(30, 'EUR/MWh_th', 'iea-weo', 2023, 'Extremely volatile: 10-300 in 2020-2022'),
    co2PerMwhThermal: sourced(0.2, 't/MWh_th', 'ipcc-ar5-a3', 2014, 'Natural gas combustion'),
    supplyRisk: sourced(0.8, 'fraction', 'game-design', 2024, 'Pipeline-dependent, concentrated suppliers'),
  },
  uranium: {
    id: 'uranium',
    nameKey: 'fuel.uranium',
    pricePerMwhThermal: sourced(3.5, 'EUR/MWh_th', 'iea-projected-costs', 2020, 'Fuel cost only; small share of nuclear cost'),
    co2PerMwhThermal: sourced(0, 't/MWh_th', 'ipcc-ar5-a3', 2014, 'No combustion CO2'),
    supplyRisk: sourced(0.3, 'fraction', 'game-design', 2024, 'Stockpileable for years, which is the point'),
  },
  biomass: {
    id: 'biomass',
    nameKey: 'fuel.biomass',
    pricePerMwhThermal: sourced(25, 'EUR/MWh_th', 'iea-weo', 2023, 'Wood chips/pellets, highly local'),
    co2PerMwhThermal: sourced(0, 't/MWh_th', 'ipcc-ar5-a3', 2014, 'Counted as biogenic under standard accounting'),
    supplyRisk: sourced(0.5, 'fraction', 'game-design', 2024, 'Bulky, short supply radius'),
  },
  none: {
    id: 'none',
    nameKey: 'fuel.none',
    pricePerMwhThermal: sourced(0, 'EUR/MWh_th', 'game-design', 2024),
    co2PerMwhThermal: sourced(0, 't/MWh_th', 'game-design', 2024),
    supplyRisk: sourced(0, 'fraction', 'game-design', 2024),
  },
}
