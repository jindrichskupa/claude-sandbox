/**
 * How far the fast-forward will run before handing control back.
 *
 * ## What used to be here, and why it is gone
 *
 * This file held a *signature*: a rolling hash of everything a player could care about — fleet
 * phases, energised lines, live events, the government, contract count, blackout, objectives,
 * bankruptcy — recomputed after every hour of a skip and compared with the hour before. Stopping
 * when the hash changed meant no system could forget to announce itself, because nothing
 * announced itself at all.
 *
 * That was a good answer to the wrong question. A hash knows *that* something changed and cannot
 * know *what*, so the clock stopped and the interface said "Something is happening" — which is
 * the least useful sentence it could produce, and left the player to go and find whatever it was.
 * The categories it reported ("A line has come into service") were only slightly better: they
 * named a kind of thing rather than the thing.
 *
 * So systems post to `sim/news/news.ts` instead, and the skip stops on the first filed item of at
 * least `Notable` importance and shows its headline. The reason the clock stopped is now a
 * sentence naming a place, and the same record also drives the card that pops up over the map and
 * the archive the player scrolls back through.
 *
 * The risk the signature was designed against — a system that forgets to post — is real, and is
 * now handled by `tests/news.test.ts`, which plays a scenario and asserts that each kind of thing
 * that happens in it produces news. A forgotten announcement is a failing test rather than a
 * silent gap, which is a worse guarantee than "impossible by construction" and a much better
 * interface.
 */

/**
 * A year.
 *
 * Long enough to carry the player over a quiet stretch of a scenario measured in decades, short
 * enough that the clock never disappears for an amount of time they did not agree to — and a year
 * always contains at least an election cycle's worth of budget decisions, so a skip that runs the
 * whole way and finds nothing is itself information.
 */
export const SKIP_LIMIT_TICKS = 8760
