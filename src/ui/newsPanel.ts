/**
 * The newspaper: what just happened, what is coming, and everything that happened before.
 *
 * Three things, and they are deliberately in one place rather than three.
 *
 * **The card.** Something important happens and a card slides in over the map naming it. That is
 * the Transport Tycoon shape and it is the right one: the interruption is the information. It is
 * clickable, so "Millbrook has come into service" takes you to Millbrook. It expires on its own,
 * because a notification that has to be dismissed is a chore.
 *
 * **The archive.** Every card also goes in a list, because the thing about a notification is that
 * it arrives while you are looking somewhere else. A player who fast-forwarded through 2009 should
 * be able to find out what happened in 2009, and at the end of a run the archive is the story of
 * how it went — which is most of what a post-mortem needs.
 *
 * **What is coming.** The half a log cannot give you. A station eleven months from service, an
 * election in two years, a forewarned storm, a machine whose design life runs out inside the time
 * it would take to replace it. Dates and risks are shown differently on purpose: a date is
 * something to plan against and a probability is something to insure against, and rendering them
 * identically would teach the player to trust neither.
 */

import { formatShortDate, t } from '@i18n/index'
import type { World } from '@sim/world'
import { NewsImportance, NEWS_CATEGORIES, type NewsCategory, type NewsItem, type UpcomingItem } from '@sim/news/news'
import { MONTHS_PER_YEAR, TICKS_PER_YEAR, tickToDate } from '@sim/core/time'

const TICKS_PER_MONTH = TICKS_PER_YEAR / MONTHS_PER_YEAR

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

/**
 * A headline, with its parameters already translated where they are themselves keys.
 *
 * Content refers to itself by key — a plant type is `plant.ccgt`, a government is
 * `policy.renewablesPush` — so a headline that interpolated them raw would read "Millbrook
 * (plant.ccgt) has come into service". Translating any parameter that looks like a key is a small
 * piece of cleverness that removes a large class of ugly bugs, and the cost of getting it wrong
 * is a string that was going to be shown untranslated anyway.
 *
 * `key#index` is the other half of that convention. A node the player built has no literal name,
 * only a key and a serial — "220 kV substation 4" — and the simulation has no business knowing
 * what language the interface is in, so it hands over the pair and this expands it. See
 * `World.displayName`.
 */
export function headline(item: { titleKey: string; params?: Record<string, string | number> }): string {
  const params: Record<string, string | number> = {}
  for (const [key, value] of Object.entries(item.params ?? {})) {
    if (typeof value !== 'string') {
      params[key] = value
    } else if (value.includes('#')) {
      const [nameKey, index] = value.split('#')
      params[key] = `${t(nameKey!)} ${index}`
    } else if (/^[a-z]+\.[A-Za-z0-9_.]+$/.test(value)) {
      params[key] = t(value)
    } else {
      params[key] = value
    }
  }
  return t(item.titleKey, params)
}

/** How far away something is, in the coarsest unit that is still honest. */
function when(ticks: number): string {
  // Negative is not "now": an inherited station eight years past its design life is a different
  // fact from one due this afternoon, and it is the more urgent of the two.
  if (ticks < -24) return t('ui.overdue', { years: Math.max(1, Math.round(-ticks / TICKS_PER_YEAR)) })
  if (ticks <= 0) return t('ui.now')
  if (ticks < 48) return t('ui.inHours', { hours: Math.round(ticks) })
  if (ticks < TICKS_PER_MONTH * 2) return t('ui.inDays', { days: Math.round(ticks / 24) })
  if (ticks < TICKS_PER_YEAR * 2) return t('ui.inMonths', { months: Math.round(ticks / TICKS_PER_MONTH) })
  return t('ui.inYears', { years: Math.round(ticks / TICKS_PER_YEAR) })
}

export interface NewsPanelCallbacks {
  onOpen?: () => void
  /** Take the player to what an item is about. */
  onGoTo?: (subjectId: string, kind: NewsItem['subjectKind']) => void
}

type Tab = 'latest' | 'coming'

export class NewsPanel {
  private readonly root: HTMLDivElement
  private readonly body: HTMLDivElement
  private readonly tabs: HTMLDivElement
  private readonly toggle: HTMLButtonElement
  private readonly badge: HTMLSpanElement
  private readonly toasts: HTMLDivElement
  private open = false
  private tab: Tab = 'latest'
  private filter: NewsCategory | 'all' = 'all'
  private lastSignature: string | null = null
  /** Items filed since the panel was last opened, for the badge on the toggle. */
  private unread = 0
  private readonly live: Array<{ node: HTMLElement; until: number }> = []

  constructor(
    parent: HTMLElement,
    private readonly world: World,
    private readonly callbacks: NewsPanelCallbacks,
  ) {
    this.toggle = el('button', undefined, t('ui.news'))
    this.toggle.id = 'news-toggle'
    this.badge = el('span', 'news-badge')
    this.toggle.appendChild(this.badge)
    this.toggle.addEventListener('click', () => this.setOpen(!this.open))
    parent.appendChild(this.toggle)

    this.root = el('div', 'panel')
    this.root.id = 'news-panel'
    const header = el('div', 'build-header')
    header.appendChild(el('h3', undefined, t('ui.news')))
    const close = el('button', undefined, t('ui.close'))
    close.addEventListener('click', () => this.setOpen(false))
    header.appendChild(close)
    this.root.appendChild(header)

    this.tabs = el('div', 'acct-tabs')
    for (const [tab, key] of [
      ['latest', 'ui.newsLatest'],
      ['coming', 'ui.newsComing'],
    ] as const) {
      const button = el('button', undefined, t(key))
      button.addEventListener('click', () => {
        this.tab = tab
        this.lastSignature = null
        this.render()
      })
      this.tabs.appendChild(button)
    }
    this.root.appendChild(this.tabs)

    this.body = el('div')
    this.root.appendChild(this.body)
    parent.appendChild(this.root)

    // The cards live outside the panel, because their whole job is to be seen when the panel is
    // shut. Pointer events pass through the container so a card cannot swallow a click on the map.
    this.toasts = el('div')
    this.toasts.id = 'news-toasts'
    parent.appendChild(this.toasts)
  }

  setOpen(open: boolean): void {
    this.open = open
    this.root.classList.toggle('visible', open)
    this.toggle.classList.toggle('active', open)
    if (open) {
      this.unread = 0
      this.callbacks.onOpen?.()
      this.lastSignature = null
      this.render()
    }
    this.renderBadge()
  }

  isOpen(): boolean {
    return this.open
  }

  /**
   * Take everything filed since the last frame and raise cards for the important ones.
   *
   * Called by the game loop rather than by `render`, because it must happen whether or not the
   * panel is open and exactly once per item — a card raised twice is a bug the player sees.
   */
  collect(items: NewsItem[]): void {
    for (const item of items) {
      if (!this.open) this.unread++
      if (item.importance >= NewsImportance.Major) this.raise(item)
    }
    this.renderBadge()
  }

  /** Retire cards whose time is up. Cheap enough to call every frame. */
  tickToasts(nowMs: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const card = this.live[i]!
      if (nowMs < card.until) continue
      card.node.remove()
      this.live.splice(i, 1)
    }
  }

  /**
   * How long a card stays up.
   *
   * Eight seconds, which is long enough to read a headline and glance back at what you were
   * doing, and short enough that a busy decade does not become a wall of cards. Three at a time
   * at most, oldest evicted — the alternative is a stack that grows off the screen during a
   * fast-forward and hides the map it is reporting on.
   */
  private raise(item: NewsItem): void {
    const card = el('div', `news-toast news-${item.category}`)
    card.appendChild(el('div', 'news-toast-when', formatShortDate(tickToDate(item.tick, this.world.scenario.startYear))))
    card.appendChild(el('div', 'news-toast-title', headline(item)))
    if (item.subjectId && this.callbacks.onGoTo) {
      card.classList.add('news-clickable')
      card.addEventListener('click', () => {
        this.callbacks.onGoTo?.(item.subjectId!, item.subjectKind)
        card.remove()
        const i = this.live.findIndex((c) => c.node === card)
        if (i >= 0) this.live.splice(i, 1)
      })
    }
    this.toasts.appendChild(card)
    this.live.push({ node: card, until: performance.now() + 8000 })
    while (this.live.length > 3) {
      const oldest = this.live.shift()!
      oldest.node.remove()
    }
  }

  private renderBadge(): void {
    this.badge.textContent = this.unread > 0 ? String(Math.min(99, this.unread)) : ''
    this.badge.classList.toggle('visible', this.unread > 0)
  }

  render(): void {
    if (!this.open) return

    // The archive only changes when something is filed, and the forecast only when the clock
    // moves — so the signature is the newest item plus the hour, and a paused game rebuilds
    // this never.
    const newest = this.world.news.recent(1)[0]
    const signature = `${this.tab}|${this.filter}|${newest?.tick ?? -1}|${newest?.titleKey ?? ''}|${
      this.tab === 'coming' ? Math.floor(this.world.tick / 24) : 0
    }`
    if (signature === this.lastSignature) return
    this.lastSignature = signature

    for (let i = 0; i < this.tabs.children.length; i++) {
      this.tabs.children[i]!.classList.toggle('active', (i === 0 ? 'latest' : 'coming') === this.tab)
    }

    this.body.replaceChildren()
    if (this.tab === 'coming') {
      this.renderUpcoming()
      return
    }
    this.renderArchive()
  }

  private renderArchive(): void {
    // A filter rather than a search box. The categories are few and fixed, and "show me only the
    // grid" is the question a player actually asks when they are trying to remember when a
    // corridor went in.
    const chips = el('div', 'news-filters')
    for (const category of ['all', ...NEWS_CATEGORIES] as const) {
      const chip = el('button', 'news-chip', t(category === 'all' ? 'ui.newsAll' : `news.category.${category}`))
      chip.classList.toggle('active', this.filter === category)
      chip.addEventListener('click', () => {
        this.filter = category as NewsCategory | 'all'
        this.lastSignature = null
        this.render()
      })
      chips.appendChild(chip)
    }
    this.body.appendChild(chips)

    const items = this.world.news.recent(60, this.filter === 'all' ? undefined : this.filter)
    if (items.length === 0) {
      this.body.appendChild(el('div', 'event-empty', t('ui.newsNone')))
      return
    }
    for (const item of items) this.body.appendChild(this.itemRow(item))
  }

  private itemRow(item: NewsItem): HTMLDivElement {
    const row = el('div', `news-row news-${item.category}`)
    if (item.importance >= NewsImportance.Major) row.classList.add('news-major')
    const head = el('div', 'news-head')
    head.appendChild(el('span', 'news-when', formatShortDate(tickToDate(item.tick, this.world.scenario.startYear))))
    head.appendChild(el('span', 'news-cat', t(`news.category.${item.category}`)))
    row.appendChild(head)
    row.appendChild(el('div', 'news-title', headline(item)))
    if (item.subjectId && this.callbacks.onGoTo) {
      row.classList.add('news-clickable')
      row.addEventListener('click', () => this.callbacks.onGoTo?.(item.subjectId!, item.subjectKind))
    }
    return row
  }

  private renderUpcoming(): void {
    const items = this.world.upcoming()
    if (items.length === 0) {
      this.body.appendChild(el('div', 'event-empty', t('ui.newsNothingComing')))
      return
    }
    for (const item of items) this.body.appendChild(this.upcomingRow(item))
  }

  private upcomingRow(item: UpcomingItem): HTMLDivElement {
    const row = el('div', `news-row news-${item.category}`)
    const head = el('div', 'news-head')
    // A date on the left where there is one, a probability where there is not. Never both, and
    // never one dressed as the other.
    head.appendChild(
      el(
        'span',
        item.whenTicks !== undefined && item.whenTicks >= 0 ? 'news-when' : 'news-chance',
        item.whenTicks !== undefined
          ? when(item.whenTicks)
          : t('ui.chanceThisYear', { pct: Math.round((item.chance ?? 0) * 100) }),
      ),
    )
    head.appendChild(el('span', 'news-cat', t(`news.category.${item.category}`)))
    row.appendChild(head)
    row.appendChild(el('div', 'news-title', headline(item)))
    if (item.subjectId && this.callbacks.onGoTo) {
      row.classList.add('news-clickable')
      row.addEventListener('click', () => this.callbacks.onGoTo?.(item.subjectId!, item.subjectKind))
    }
    return row
  }
}
