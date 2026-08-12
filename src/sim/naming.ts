/**
 * What the player calls the things they own.
 *
 * Everything on the map already had a name; none of them were the player's. A scenario asset
 * carries a place name written by the author, an asset the player built carries a technology key
 * and a serial — "Gas turbine 4" — and the inspector, worse, showed neither and printed the raw
 * id. Three units on the same site read `built_4`, `built_7`, `built_9`, which is a database
 * talking to itself.
 *
 * A name is display only. Nothing in the simulation dispatches, prices or ages by it, so the only
 * things that can go wrong here are presentational — and one of them is real, which is why this
 * is a module rather than a string assignment.
 */

/**
 * Long enough for "Blackridge Extension II", short enough that it cannot wreck a panel.
 *
 * The inspector column is fixed width and a name is a heading in it; a name of unbounded length
 * would either overflow or force an ellipsis so early that the limit might as well have been
 * here, where the player is told about it while typing.
 */
export const MAX_NAME_LENGTH = 40

/**
 * A name as the player typed it, made safe to store.
 *
 * The hash is the part that matters. `key#index` is the convention by which the model hands a
 * translatable name to the interface — `plant.ccgt#4` becomes "Gas turbine 4" or "Paroplynový
 * blok 4" — and `headline()` expands anything containing a hash. A player who called their
 * station "Unit #3" would have handed the expander a name to translate and got back nonsense.
 * Stripping the character is a smaller price than teaching every display path where a string
 * came from, and it is invisible: nobody types a hash into a name and then misses it.
 *
 * Whitespace is collapsed for the same reason a trim is: a name that differs from another only
 * by a double space is not a distinction the player meant to make.
 *
 * Returns undefined for an empty name, which is how a name is cleared: an asset with none falls
 * back to whatever it was called before the player renamed it, rather than to its id.
 */
export function sanitiseName(raw: string): string | undefined {
  const cleaned = raw.replace(/#/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH)
  return cleaned.length > 0 ? cleaned : undefined
}
