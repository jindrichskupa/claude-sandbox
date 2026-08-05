/**
 * Saving and loading a game.
 *
 * The rule that makes this small is: **save what is authoritative, rebuild what is derived.**
 * The map, the weather model, the island decomposition, the parameter cache and every chart are
 * all functions of things that are saved, so none of them appears in the file. What remains is
 * the state that genuinely could not be recomputed.
 *
 * The largest single reason this is a hundred lines rather than a thousand is a decision taken
 * in the first milestone for a different reason. All randomness comes from *stateless* named
 * streams sampled as a pure function of `(seed, streamName, tick, key)`, so there is no
 * generator state anywhere in the simulation to capture — and, more importantly, no risk of a
 * saved game diverging from a live one because some generator was one draw ahead. A save
 * resumes bit-identically because the randomness never depended on when it was asked.
 *
 * The one thing that must be saved despite looking derived is the modifier registry. Weather
 * re-registers itself within an hour and ageing and policy within a month, but an event's
 * effects carry an expiry tick and belong to an event already in force; recomputing them would
 * mean replaying the event, which is exactly what a save is supposed to avoid.
 */

import type { GridEdge, GridNode } from '../grid/network'
import type { CityAsset, PlantAsset } from '../assets/types'
import type { Entry } from '../params/ModifierRegistry'
import type { PeriodLedger, Finances } from '../economy/economy'
import type { AssetAccounts } from '../economy/assetLedger'
import type { NewsItem } from '../news/news'
import type { DirectorState } from '../events/director'
import type { Weather } from '../weather/weather'
import type { WorldState } from '../world'
import type { ObjectiveProgress, ScenarioOutcome } from './objectives'

/**
 * Bumped whenever the shape below changes incompatibly.
 *
 * A save from an older version is refused rather than half-loaded. Silently accepting one and
 * filling the gaps with defaults produces a game that looks fine and behaves subtly wrongly,
 * which is worse than a clear refusal — especially in a game where a run is measured in hours.
 */
export const SAVE_VERSION = 7

export interface ScheduledSpendData {
  ownerId: string
  perTick: number
  remainingTicks: number
  kind: 'capex' | 'decommissioning'
}

/** Everything that cannot be recomputed from the scenario and the tick. */
export interface SaveData {
  tick: number
  weather: Weather
  nodes: GridNode[]
  edges: GridEdge[]
  plants: PlantAsset[]
  cities: CityAsset[]
  state: WorldState
  finances: Finances
  openLedger: PeriodLedger
  lastMonthLedger: PeriodLedger
  yearLedger: PeriodLedger
  lifetimeLedger: PeriodLedger
  periodStartTick: number
  serial: number
  spending: ScheduledSpendData[]
  energiseAt: Array<[string, number]>
  recentBlackoutTicks: number
  lastSystemPrice: number
  priceWindow: number[]
  termPriceSum: number
  termPriceTicks: number
  /** The regulator's window: prices in the hours the system actually served. */
  tariffPriceSum: number
  tariffVolumeMwh: number
  termGenerationByFuel: Array<[string, number]>
  director: DirectorState
  objectives: ObjectiveProgress[]
  outcome: ScenarioOutcome
  /**
   * Per-asset accounts. Genuinely irrecoverable: they are the accumulated history of every hour
   * the run has played, and nothing short of replaying the run would rebuild them. Dropping them
   * would leave a loaded game looking healthy while every machine on the map claimed to have
   * done nothing since it was built.
   */
  books: Array<[string, AssetAccounts]>
  /**
   * The archive. Saved for the same reason the accounts are: it is the record of the run and
   * nothing short of replaying it would rebuild it — and it is the raw material of any
   * post-mortem worth reading.
   */
  news: NewsItem[]
  modifiers: Array<{ sourceId: string; entries: Entry[] }>
}

export interface SaveFile {
  version: number
  scenarioId: string
  /** When it was written, for the load menu. Supplied by the caller, never by the simulation. */
  savedAt: string
  data: SaveData
}

export class SaveError extends Error {}

/** Wrap a world's state in a versioned envelope. */
export function makeSaveFile(scenarioId: string, data: SaveData, savedAt: string): SaveFile {
  return { version: SAVE_VERSION, scenarioId, savedAt, data }
}

/**
 * Check an untrusted blob really is a save this build can load.
 *
 * Deliberately strict about the version and only structural about the rest: a file from a
 * future build, or one that is not a save at all, must fail here rather than three ticks into a
 * game with a missing field.
 */
export function parseSaveFile(text: string): SaveFile {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new SaveError('That is not a saved game.')
  }
  if (typeof raw !== 'object' || raw === null) throw new SaveError('That is not a saved game.')

  const file = raw as Partial<SaveFile>
  if (file.version !== SAVE_VERSION) {
    throw new SaveError(`Saved by a different version of the game (${String(file.version)}).`)
  }
  if (typeof file.scenarioId !== 'string' || typeof file.data !== 'object' || file.data === null) {
    throw new SaveError('That save is missing the scenario it belongs to.')
  }
  const data = file.data as Partial<SaveData>
  if (typeof data.tick !== 'number' || !Array.isArray(data.plants) || !Array.isArray(data.nodes)) {
    throw new SaveError('That save is incomplete.')
  }
  return file as SaveFile
}

/**
 * Deliberately *not* versioned alongside `SAVE_VERSION`.
 *
 * One slot, always the same key, so a version bump lands the player on a clear "saved by a
 * different version of the game" rather than on a silent empty slot that looks like their save
 * was never written. Being told a save cannot be read is annoying; being shown no save at all
 * when you know you wrote one is alarming.
 */
export const SAVE_STORAGE_KEY = 'powergrid-tycoon.save.v1'

/**
 * Browser-side persistence.
 *
 * Kept behind functions that tolerate storage being unavailable — private browsing, a full
 * quota, an embedded webview — because a game that throws on start-up because it could not read
 * a save it never wrote would be a poor trade for the convenience.
 */
export function writeLocalSave(file: SaveFile): boolean {
  try {
    globalThis.localStorage?.setItem(SAVE_STORAGE_KEY, JSON.stringify(file))
    return true
  } catch {
    return false
  }
}

export function readLocalSave(): SaveFile | null {
  try {
    const text = globalThis.localStorage?.getItem(SAVE_STORAGE_KEY)
    if (!text) return null
    return parseSaveFile(text)
  } catch {
    return null
  }
}

export function clearLocalSave(): void {
  try {
    globalThis.localStorage?.removeItem(SAVE_STORAGE_KEY)
  } catch {
    // Nothing to do: the save is gone either way from the player's point of view.
  }
}
