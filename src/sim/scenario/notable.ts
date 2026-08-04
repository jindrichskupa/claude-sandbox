/**
 * Running the clock forward until something worth looking at happens.
 *
 * Most hours in this game are uneventful by design — that is what it means to run a system that
 * works. The interesting parts are separated by months: a station finishes, a government falls,
 * a storm is forecast, a support contract is torn up. At ten times speed a game year takes seven
 * minutes of real time, nearly all of it spent watching a load curve breathe.
 *
 * So rather than only offering a bigger multiplier, the game offers to skip to the next thing
 * that would have made the player look up.
 *
 * ## What counts, and why it is a signature rather than a list of hooks
 *
 * The obvious implementation is for every system to announce itself: the lifecycle code raises
 * "plant commissioned", the director raises "event pending", the election code raises "government
 * changed". That spreads knowledge of this feature across eight files, and every system added
 * later has to remember to join in — which is exactly the kind of thing that gets forgotten and
 * then produces a skip that sails past the very thing the player was waiting for.
 *
 * Instead this takes a *signature* of everything a player could care about and stops when it
 * changes. Adding a new kind of interesting thing means adding one line here, and a system that
 * forgets to announce itself cannot exist, because nothing announces itself at all.
 */

import type { World } from '../world'

/** Why a skip stopped. An i18n key, so the interface can say what it found. */
export type NotableReason =
  | 'notable.construction'
  | 'notable.grid'
  | 'notable.event'
  | 'notable.government'
  | 'notable.contracts'
  | 'notable.blackout'
  | 'notable.objectives'
  | 'notable.bankrupt'
  | 'notable.timeLimit'

/**
 * A compact description of everything that would make a player look up.
 *
 * Deliberately coarse. Prices, output and the weather move every hour and none of them belongs
 * here: a skip that stopped whenever the wind changed would stop immediately, every time, and be
 * worth nothing.
 */
export interface NotableState {
  /** Anything finishing, starting or changing phase in the fleet. */
  fleet: number
  /** Lines energised, and second circuits arriving. */
  grid: number
  /** Events forewarned or in force. */
  events: number
  government: string
  contracts: number
  blackout: boolean
  objectives: number
  bankrupt: boolean
}

/**
 * A rolling hash, because this is computed after *every single hour* of a skip.
 *
 * The first version built strings and joined them, which is the obvious way to write a signature
 * and was measured costing more than the simulation it was watching: the skip ran at 77 hours a
 * second when the raw model does 1450. Allocation in a loop that runs a thousand times a second
 * is the whole difference between a fast-forward that is worth pressing and one that is not.
 */
function hash(h: number, value: number): number {
  return (Math.imul(h, 31) + value) | 0
}

function hashString(h: number, text: string): number {
  for (let i = 0; i < text.length; i++) h = hash(h, text.charCodeAt(i))
  return h
}

export function notableState(world: World): NotableState {
  let fleet = 17
  for (const p of world.plants) fleet = hash(fleet, p.phase)
  fleet = hash(fleet, world.plants.length)

  let grid = 17
  for (const e of world.network.allEdges()) grid = hash(hash(grid, e.energised ? 1 : 0), e.circuits)

  const director = world.director.state
  let events = 17
  for (const p of director.pending) events = hashString(events, p.uid)
  for (const a of director.active) events = hashString(events, a.uid)

  let objectives = 17
  for (const o of world.objectives) objectives = hashString(objectives, o.status)

  return {
    fleet,
    grid,
    events,
    government: world.state.policyRegimeId,
    // Count rather than contents: what matters is that one was granted or torn up.
    contracts: world.state.contracts.filter((c) => c.revokedTick === undefined).length,
    // A megawatt rather than a rounding error. The solver leaves fractional residuals on some
    // hours, and at a hundredth of a megawatt the skip stopped for arithmetic noise.
    blackout: (world.lastDispatch?.totalUnservedMw ?? 0) > BLACKOUT_THRESHOLD_MW,
    objectives,
    bankrupt: world.finances.bankrupt,
  }
}

/**
 * What changed between two states, as the single most newsworthy reason.
 *
 * Ordered by how much it deserves the player's attention rather than by how it is stored:
 * bankruptcy outranks a finished substation, and a government that has fallen outranks a storm
 * warning. Returning one reason rather than all of them is a deliberate simplification — the
 * point is to explain why the clock stopped, not to file a report.
 */
export function notableChange(before: NotableState, after: NotableState): NotableReason | null {
  if (after.bankrupt !== before.bankrupt) return 'notable.bankrupt'
  if (after.objectives !== before.objectives) return 'notable.objectives'
  if (after.government !== before.government) return 'notable.government'
  if (after.contracts !== before.contracts) return 'notable.contracts'
  if (after.events !== before.events) return 'notable.event'
  // Only the rising edge. A shortfall beginning is news; one ending is a relief, and stopping
  // the clock for it would double the interruptions for no information — which in testing meant
  // forty consecutive skips covered less than a fortnight.
  if (after.blackout && !before.blackout) return 'notable.blackout'
  if (after.fleet !== before.fleet) return 'notable.construction'
  if (after.grid !== before.grid) return 'notable.grid'
  return null
}

/**
 * How far a skip will run before giving up and handing control back.
 *
 * A year. Long enough to carry the player over a quiet stretch of a scenario measured in decades,
 * short enough that the clock never disappears for an amount of time they did not agree to — and
 * a year always contains at least an election cycle's worth of budget decisions, so a skip that
 * runs the whole way and finds nothing is itself information.
 */
export const SKIP_LIMIT_TICKS = 8760

/** Below this a "shortfall" is solver residue rather than a town in the dark. */
const BLACKOUT_THRESHOLD_MW = 1
