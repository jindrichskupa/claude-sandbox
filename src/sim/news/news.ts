/**
 * The news desk: what just happened, what is coming, and what happened before.
 *
 * ## Why this replaces a signature
 *
 * The fast-forward used to work by hashing everything a player could care about and stopping when
 * the hash changed. That was a good decision for what it was solving — no system can forget to
 * announce itself if nothing announces itself at all — and it was the wrong shape for a game.
 * A hash knows *that* something changed and cannot possibly know *what*, so the clock stopped and
 * said "Something is happening", which is the least useful sentence an interface can produce. The
 * player then had to go and find it.
 *
 * So systems announce themselves after all, and the announcement is the feature rather than a
 * side effect of it. Every item carries a headline, a category, an importance, and the thing it
 * is about — so the same record drives the notification that pops up, the archive the player
 * scrolls back through, and the reason the fast-forward stopped. One record, three uses, and the
 * skip's reason is now a sentence naming a place.
 *
 * The risk the signature was designed against is real and is handled by a test rather than by
 * architecture: `tests/news.test.ts` plays a scenario and asserts that each kind of thing that
 * happens in it produces news. A system that forgets to post is a failing test rather than a
 * silent gap.
 *
 * ## Importance, and why three levels rather than a boolean
 *
 * A game like this generates a great deal of true, boring information. A gas turbine tripping in
 * March is worth recording and is not worth stopping the clock for; a government falling is worth
 * interrupting whatever the player was doing. One flag cannot express that, and the failure mode
 * of getting it wrong is not a missing feature but an interface that cries wolf until the player
 * stops reading it.
 *
 *   - `Routine` — filed, searchable, never interrupts. Most things.
 *   - `Notable` — stops a fast-forward. The player asked to be taken to the next thing; this is
 *     the definition of "thing".
 *   - `Major` — pops up as a card over the map. Reserved for what changes the player's plan.
 */

/** What part of the world an item is about. Drives filtering and the colour of its stripe. */
export type NewsCategory =
  | 'construction'
  | 'grid'
  | 'fleet'
  | 'market'
  | 'politics'
  | 'event'
  | 'reliability'
  | 'finance'
  | 'city'
  | 'objective'

export const NEWS_CATEGORIES: NewsCategory[] = [
  'construction',
  'grid',
  'fleet',
  'market',
  'politics',
  'event',
  'reliability',
  'finance',
  'city',
  'objective',
]

export enum NewsImportance {
  Routine = 0,
  Notable = 1,
  Major = 2,
}

/**
 * One thing that happened, at one hour.
 *
 * Text is a key and parameters rather than a sentence, for the same reason everything else in
 * this codebase is: a headline built by concatenation is a headline that cannot be translated.
 * `subjectId` is what makes an item clickable — a plant, a line, a node or a city — and is the
 * difference between a feed that reports and a feed the player can act from.
 */
export interface NewsItem {
  tick: number
  category: NewsCategory
  importance: NewsImportance
  titleKey: string
  params?: Record<string, string | number>
  /** Asset this is about, so the item can take the player there. */
  subjectId?: string
  subjectKind?: 'plant' | 'edge' | 'node' | 'city'
}

/**
 * Something that has not happened yet.
 *
 * Deliberately *computed* rather than stored: everything here is derivable from world state, and
 * a stored forecast is a forecast that can be wrong about the present. `whenTicks` is how far
 * away it is; `chance` is a probability where one is meaningful and absent where it is not, which
 * is a distinction worth keeping — a station completing in eleven months is a date, and a plant
 * of this age suffering a forced outage this year is a risk, and presenting them the same way
 * would teach the player to distrust both.
 */
export interface UpcomingItem {
  category: NewsCategory
  titleKey: string
  params?: Record<string, string | number>
  /** Ticks from now. Negative means overdue, which is itself worth showing. */
  whenTicks?: number
  /** Probability in the coming year, 0..1, where the thing is a risk rather than a date. */
  chance?: number
  subjectId?: string
  subjectKind?: 'plant' | 'edge' | 'node' | 'city'
}

/**
 * How much history is kept.
 *
 * Four hundred items is several game years of a busy run and a few hundred kilobytes in a save.
 * A run of this length generates far more than that, and the old ones are genuinely not worth
 * keeping: a post-mortem wants the turning points, and the turning points are all `Notable` or
 * above. So the buffer drops routine items first and keeps the important ones far longer, which
 * costs one extra array and makes the archive read like a history rather than like a log.
 */
const ROUTINE_CAPACITY = 300
const IMPORTANT_CAPACITY = 300

export class NewsDesk {
  /** Everything, newest last. Two buffers so routine chatter cannot evict the turning points. */
  private routine: NewsItem[] = []
  private important: NewsItem[] = []
  /** Set by `post`, cleared by the caller. What the fast-forward and the toasts read. */
  private pending: NewsItem[] = []

  post(item: NewsItem): void {
    if (item.importance >= NewsImportance.Notable) {
      this.important.push(item)
      if (this.important.length > IMPORTANT_CAPACITY) this.important.shift()
    } else {
      this.routine.push(item)
      if (this.routine.length > ROUTINE_CAPACITY) this.routine.shift()
    }
    this.pending.push(item)
  }

  /** Everything filed, newest first. */
  all(): NewsItem[] {
    return [...this.routine, ...this.important].sort((a, b) => b.tick - a.tick)
  }

  /** The most recent `n`, newest first, optionally filtered by category. */
  recent(n: number, category?: NewsCategory): NewsItem[] {
    const rows = category ? this.all().filter((i) => i.category === category) : this.all()
    return rows.slice(0, n)
  }

  /**
   * Items posted since the last call, and clear them.
   *
   * The caller is the game loop, which decides what to do with them: stop a skip, raise a card,
   * or nothing. Draining rather than peeking is what stops the same item being announced twice
   * when the loop runs several ticks in one frame.
   */
  drain(): NewsItem[] {
    const out = this.pending
    this.pending = []
    return out
  }

  /** The most important thing waiting, without draining. Used to decide whether to stop. */
  peekHighest(): NewsItem | null {
    let best: NewsItem | null = null
    for (const item of this.pending) {
      if (!best || item.importance > best.importance) best = item
    }
    return best
  }

  toJSON(): NewsItem[] {
    return [...this.routine, ...this.important]
  }

  loadJSON(items: NewsItem[]): void {
    this.routine = items.filter((i) => i.importance < NewsImportance.Notable)
    this.important = items.filter((i) => i.importance >= NewsImportance.Notable)
    this.pending = []
  }
}
