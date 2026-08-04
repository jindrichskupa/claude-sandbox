/**
 * The accounts: who earns, who loses, and what it costs to find out.
 *
 * The top bar has always shown one number for the whole utility. It answers "am I solvent?" and
 * nothing else, and in a game whose central decision is *which* machine to keep, that is the
 * wrong question to be the only one on screen. A player watching cash fall for a decade could
 * tell that something was wrong and had no way at all to tell what.
 *
 * So this ranks every asset by margin, worst first, over a window and a valuation the player
 * chooses. Three windows, because they answer three different questions: the month is what is
 * happening now, the year is what a decision should be judged on, and the lifetime is whether
 * building the thing was ever a good idea. A station can be losing money this month and still be
 * the best investment on the map, and the panel should let that be seen rather than hidden.
 *
 * Two valuations, because there is one company here — it generates, it carries, it bills — and
 * the price of an internal transfer is therefore the tariff the company is paid. That basis
 * reconciles with the balance on screen. The other values the same output at the nodal price of
 * the hour, which is what it would have fetched in a market, and which says *when* the money was
 * made — the thing a flat tariff averages away, and the reason a regulated utility can own a
 * peaking plant for thirty years and never find out what it was for. Whichever column is showing,
 * every row carries the other one in small type, because nobody discovers a disagreement they
 * have to remember to click a tab for.
 *
 * Generation and network are separate sections. On the regulated basis a corridor sells nothing
 * and buys the energy it loses, so it can only ever be a cost — a single worst-first list put
 * every line in the country above every power station. The remedies differ too: a losing station
 * is closed or refurbished, a constrained corridor is reinforced, and the congestion rent beside
 * it is what that reinforcement would be worth.
 */

import { formatMoney, t } from '@i18n/index'
import { PLANT_TYPES } from '@content/plantTypes'
import type { World } from '@sim/world'
import {
  marketMargin,
  operatingMargin,
  type AssetLedger,
  type LedgerWindow,
} from '@sim/economy/assetLedger'
import { nodeLabel } from '@render/mapView'

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

const WINDOWS: Array<{ window: LedgerWindow; key: string }> = [
  { window: 'month', key: 'ui.windowMonth' },
  { window: 'year', key: 'ui.windowYear' },
  { window: 'lifetime', key: 'ui.windowLifetime' },
]

/**
 * The two valuations, as a choice the player makes rather than a decision taken for them.
 *
 * Regulated is the default because it is the one that reconciles with their cash. Market is one
 * click away because it is the one that says *when* the money was made, and a tariff averages
 * that away by design — which is the whole reason a regulated utility can own a peaker and never
 * find out what it was for.
 */
const BASES = [
  { basis: 'regulated' as const, key: 'ui.basisRegulated', measure: operatingMargin },
  { basis: 'market' as const, key: 'ui.basisMarket', measure: marketMargin },
]

type Basis = (typeof BASES)[number]['basis']

/**
 * What to call an asset in a list.
 *
 * Ids are what the books are keyed by and they are not what a player recognises. A plant gets its
 * own name and its type; a line gets the two places it joins, which is the only description of a
 * corridor anybody thinks in.
 */
export type AssetGroup = 'generation' | 'network' | 'former'

export function assetLabel(world: World, id: string): { name: string; kind: string; group: AssetGroup } {
  const plant = world.plants.find((p) => p.id === id)
  if (plant) {
    return {
      name: plant.id.replace(/^p_/, ''),
      kind: t(PLANT_TYPES[plant.typeId].nameKey),
      group: 'generation',
    }
  }
  const edge = world.network.getEdge(id)
  if (edge) {
    const from = world.network.getNode(edge.from)
    const to = world.network.getNode(edge.to)
    return {
      name: `${(from && nodeLabel(from)) ?? edge.from} → ${(to && nodeLabel(to)) ?? edge.to}`,
      kind: edge.commodity === 'heat' ? t('ui.heatMains') : `${edge.kv} kV`,
      group: 'network',
    }
  }
  // Demolished, or an owner that never was an asset. Keeping the row rather than dropping it is
  // deliberate: a station the player closed in 2003 is exactly the kind of thing a post-mortem
  // needs to still be able to see.
  return { name: id.replace(/^[pl]_/, ''), kind: t('ui.gone'), group: 'former' }
}

export interface AccountsPanelCallbacks {
  onOpen?: () => void
  /** Show the asset on the map. Plants select their node; lines select themselves. */
  onSelect?: (id: string) => void
}

export class AccountsPanel {
  private readonly root: HTMLDivElement
  private readonly body: HTMLDivElement
  private readonly toggle: HTMLButtonElement
  private readonly tabs: HTMLDivElement
  private readonly bases: HTMLDivElement
  private open = false
  private window: LedgerWindow = 'year'
  private basis: Basis = 'regulated'
  private lastSignature: string | null = null

  constructor(
    parent: HTMLElement,
    private readonly world: World,
    private readonly callbacks: AccountsPanelCallbacks,
  ) {
    this.toggle = el('button', undefined, t('ui.accounts'))
    this.toggle.id = 'accounts-toggle'
    this.toggle.addEventListener('click', () => this.setOpen(!this.open))
    parent.appendChild(this.toggle)

    this.root = el('div', 'panel')
    this.root.id = 'accounts-panel'
    const header = el('div', 'build-header')
    header.appendChild(el('h3', undefined, t('ui.accounts')))
    const close = el('button', undefined, t('ui.close'))
    close.addEventListener('click', () => this.setOpen(false))
    header.appendChild(close)
    this.root.appendChild(header)

    this.tabs = el('div', 'acct-tabs')
    for (const { window, key } of WINDOWS) {
      const button = el('button', undefined, t(key))
      button.addEventListener('click', () => {
        this.window = window
        this.lastSignature = null
        this.render()
      })
      this.tabs.appendChild(button)
    }
    this.root.appendChild(this.tabs)

    this.bases = el('div', 'acct-tabs acct-bases')
    for (const { basis, key } of BASES) {
      const button = el('button', undefined, t(key))
      button.addEventListener('click', () => {
        this.basis = basis
        this.lastSignature = null
        this.render()
      })
      this.bases.appendChild(button)
    }
    this.root.appendChild(this.bases)

    this.body = el('div')
    this.root.appendChild(this.body)
    parent.appendChild(this.root)
  }

  setOpen(open: boolean): void {
    this.open = open
    this.root.classList.toggle('visible', open)
    this.toggle.classList.toggle('active', open)
    if (open) {
      this.callbacks.onOpen?.()
      this.lastSignature = null
      this.render()
    }
  }

  isOpen(): boolean {
    return this.open
  }

  render(): void {
    if (!this.open) return

    // The figures move every hour, so this cannot be cached on content; it can be cached on the
    // clock. A paused game rebuilds this never, and a running one twice a second rather than ten
    // times — which is the whole difference between a panel and a spinning fan.
    const signature = `${this.world.tick}|${this.window}|${this.basis}`
    if (signature === this.lastSignature) return
    this.lastSignature = signature

    for (let i = 0; i < this.tabs.children.length; i++) {
      this.tabs.children[i]!.classList.toggle('active', WINDOWS[i]!.window === this.window)
    }
    for (let i = 0; i < this.bases.children.length; i++) {
      this.bases.children[i]!.classList.toggle('active', BASES[i]!.basis === this.basis)
    }

    this.body.replaceChildren()

    const measure = BASES.find((b) => b.basis === this.basis)!.measure
    const rows = this.world.books.ranked(this.window, measure)
    if (rows.length === 0) {
      this.body.appendChild(el('div', 'event-empty', t('ui.noAccountsYet')))
      return
    }

    // The total, and which total it is. On the regulated basis this is a real reconciliation —
    // every transfer valued at the price the firm is actually paid, so the rows sum to the
    // electricity gross margin in the monthly ledger, and a player who adds them up by hand gets
    // the number they already have. On the market basis it is emphatically not: it is what the
    // same assets would have earned as separate businesses, which is a larger and differently
    // distributed number, and the line under it says so rather than leaving them to wonder.
    const total = rows.reduce((sum, r) => sum + r.value, 0)
    const summary = el('div', 'acct-summary')
    summary.appendChild(el('span', undefined, t(this.basis === 'market' ? 'ui.marketMarginTotal' : 'ui.assetMarginTotal')))
    summary.appendChild(el('b', total >= 0 ? 'good' : 'bad', formatMoney(total)))
    this.body.appendChild(summary)
    this.body.appendChild(
      el('div', 'acct-note', t(this.basis === 'market' ? 'ui.basisMarketNote' : 'ui.basisRegulatedNote')),
    )

    // Split into generation and network before ranking within each.
    //
    // A flat list looked right and read wrong. On the regulated basis a corridor can only ever be
    // a cost — it sells nothing and buys the energy it loses — so worst-first put every line in
    // the country above every power station, and a player opening the panel to ask which plant
    // was losing money got a screen of transmission lines. The two are not competing for the same
    // verdict: "is this station worth running?" and "is this corridor worth reinforcing?" are
    // different questions with different remedies, and they get different sections.
    const groups: Array<{ group: AssetGroup; key: string }> = [
      { group: 'generation', key: 'ui.acctGeneration' },
      { group: 'network', key: 'ui.acctNetwork' },
      { group: 'former', key: 'ui.acctFormer' },
    ]
    for (const { group, key } of groups) {
      const mine = rows.filter((r) => assetLabel(this.world, r.id).group === group)
      if (mine.length === 0) continue
      const subtotal = mine.reduce((sum, r) => sum + r.value, 0)
      const head = el('div', 'acct-group')
      head.appendChild(el('span', undefined, t(key)))
      head.appendChild(el('b', subtotal >= 0 ? 'good' : 'bad', formatMoney(subtotal)))
      this.body.appendChild(head)
      const scale = Math.max(...mine.map((r) => Math.abs(r.value)), 1)
      for (const row of mine) this.body.appendChild(this.renderRow(row.id, row.value, row.ledger, scale))
    }
  }

  /**
   * One asset, as a bar either side of a centre line.
   *
   * A signed bar rather than a column of numbers because the question this panel exists for —
   * *which of these is losing the money?* — is answered by shape faster than by reading, and the
   * ranking is already sorted so the losses are at the top where a bar leftwards is unmissable.
   */
  private renderRow(id: string, value: number, ledger: AssetLedger, scale: number): HTMLDivElement {
    const { name, kind } = assetLabel(this.world, id)
    const row = el('div', `acct-row ${value >= 0 ? 'acct-good' : 'acct-bad'}`)

    const head = el('div', 'acct-head')
    head.appendChild(el('span', 'acct-name', name))
    head.appendChild(el('span', 'acct-value', formatMoney(value)))
    row.appendChild(head)

    // Linear against the largest in the section, deliberately, even though one asset routinely
    // dwarfs the rest and leaves everything below it as a stub. That *is* the finding — a fleet
    // where one station earns thirty times what the next one does is a fleet with one station and
    // some hobbies — and a square-root scale would flatter the small rows into looking comparable.
    // The floor is only so that "small" never renders as "nothing at all".
    const bar = el('div', 'acct-bar')
    const fill = el('div', value >= 0 ? 'acct-fill-pos' : 'acct-fill-neg')
    const share = (Math.abs(value) / scale) * 50
    fill.style.width = `${value === 0 ? 0 : Math.max(0.6, share)}%`
    bar.appendChild(fill)
    row.appendChild(bar)

    const meta = el('div', 'acct-meta')
    meta.appendChild(el('span', undefined, kind))
    if (ledger.energyMwh > 0) {
      meta.appendChild(el('span', undefined, `${(ledger.energyMwh / 1000).toFixed(0)} GWh`))
    }
    // The other basis, always, in smaller type. Seeing that a station is €40m down at the tariff
    // and €200m up at market prices is the entire point of keeping both sets of books, and it is
    // the kind of thing nobody discovers by remembering to click a tab.
    const other =
      this.basis === 'market'
        ? { key: 'ui.basisRegulated', value: operatingMargin(ledger) }
        : { key: 'ui.basisMarket', value: marketMargin(ledger) }
    meta.appendChild(
      el('span', other.value >= 0 ? 'good' : 'bad', `${t(other.key)} ${formatMoney(other.value)}`),
    )
    if (ledger.congestedHours > 0) {
      meta.appendChild(el('span', 'warn', t('ui.congestedHours', { hours: ledger.congestedHours })))
    }
    row.appendChild(meta)

    if (this.callbacks.onSelect) {
      row.classList.add('acct-clickable')
      row.addEventListener('click', () => this.callbacks.onSelect?.(id))
    }
    return row
  }
}

/**
 * The same ledger, laid out for one asset in the inspector.
 *
 * Shared with the panel above so the two can never disagree about what a cost is called. Zero
 * lines are dropped: a wind farm has no fuel bill and no carbon bill, and printing "€0" twice
 * would say nothing while making the block that does carry information harder to read.
 */
export function ledgerBlock(ledger: AssetLedger, titleKey: string): HTMLDivElement {
  const wrap = el('div', 'acct-detail')
  wrap.appendChild(el('div', 'why-title', t(titleKey)))

  const line = (key: string, amount: number, sign: 'pos' | 'neg'): void => {
    if (Math.abs(amount) < 1) return
    const r = el('div', 'why-step')
    r.appendChild(el('span', 'reason', t(key)))
    r.appendChild(el('span', `delta ${sign}`, formatMoney(sign === 'neg' ? -amount : amount)))
    wrap.appendChild(r)
  }

  const total = (key: string, amount: number): void => {
    const r = el('div', 'why-step total')
    r.appendChild(el('span', 'reason', t(key)))
    r.appendChild(el('span', `delta ${amount >= 0 ? 'pos' : 'neg'}`, formatMoney(amount)))
    wrap.appendChild(r)
  }

  // Costs first, because they are the same under either valuation. Only the top line moves.
  line('ui.acctRevenue', ledger.revenue, 'pos')
  line('ui.acctEnergyCost', ledger.energyCost, 'neg')
  line('ui.acctFuel', ledger.fuelCost, 'neg')
  line('ui.acctCarbon', ledger.carbonCost, 'neg')
  line('ui.acctVarOpex', ledger.varOpex, 'neg')
  line('ui.acctFixedOpex', ledger.fixedOpex, 'neg')
  total('ui.acctMargin', operatingMargin(ledger))

  // The same asset as a merchant. Two lines rather than a second table: what its output fetched
  // at the price of the hour, and what that leaves after the identical costs above. For a line
  // the first of those is the congestion rent, which is a carrier's entire income and the priced
  // case for a second circuit.
  if (ledger.marketRevenue > 1 || ledger.congestionRent > 1) {
    line(ledger.congestionRent > 1 ? 'ui.acctRent' : 'ui.acctMarketRevenue', ledger.marketRevenue, 'pos')
    if (Math.abs(ledger.marketEnergyCost - ledger.energyCost) > 1) {
      line('ui.acctEnergyCostMarket', ledger.marketEnergyCost, 'neg')
    }
    total('ui.acctMarketMargin', marketMargin(ledger))
  }

  // Capital is below the line on purpose. It is not part of "should this go on running?", which
  // is what the margin above answers, but it is very much part of "was this worth building?" —
  // and a player looking at a station still paying for itself deserves to see both.
  if (ledger.capital > 1) {
    const capital = el('div', 'why-step')
    capital.appendChild(el('span', 'reason', t('ui.acctCapital')))
    capital.appendChild(el('span', 'delta neg', formatMoney(-ledger.capital)))
    wrap.appendChild(capital)
  }
  return wrap
}
