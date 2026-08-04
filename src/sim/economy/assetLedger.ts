/**
 * What each machine and each corridor is actually worth.
 *
 * The accounts have always been a single pot: revenue, fuel, carbon, opex and capital all summed
 * across the whole utility. That is enough to say whether the player is solvent and nothing else.
 * A played run of the opening scenario showed cash falling steadily for a decade and gave no way
 * to answer the only question worth asking about it — *which of these assets is losing the
 * money?* The diagnosis got as far as "the corridor, probably", by elimination.
 *
 * ## The firm is not unbundled, so the books are not either
 *
 * There is one company here. It generates, it moves the power, it bills the towns, and there is
 * no market and no counterparty anywhere in the model. That single fact settles a question the
 * first version of this file got wrong.
 *
 * The first version credited each plant at the **nodal price where it injected** — what a
 * merchant generator would earn, which is the right answer in an unbundled industry with a
 * wholesale market. It produced accounts nobody could act on. In hours when load is shed the
 * nodal price is the value of lost load, so a station running through a scarcity hour was
 * credited thousands of euros a megawatt-hour, and over twelve years the inherited gas plant
 * showed an operating margin of eight and a half billion — against a utility whose cash was
 * falling the whole time. Both numbers were right and together they were useless, because they
 * were the books of two different companies.
 *
 * A vertically integrated firm values internal transfers at the price the firm is actually paid.
 * So every plant is credited at the **tariff**, and every corridor is *charged* for the energy it
 * loses, at the same tariff. That makes the arithmetic close exactly:
 *
 *     Σ plants (generated × tariff) − Σ lines (lost × tariff) = served × tariff = the firm's revenue
 *
 * — which is why the ranking in the accounts panel adds up to the electricity gross margin in the
 * monthly ledger rather than to some larger number with an unexplained gap. A transmission line
 * in an integrated utility is a cost centre, and now it reads as one.
 *
 * ## Both bases, side by side
 *
 * That reconciliation is a property of a bundled firm, and it is worth being clear that it is not
 * a law of the industry — it is what happens when the same company owns every side of every
 * transaction. Split the firm up and the equality breaks immediately: the generators are paid the
 * market price where they inject, the carrier keeps the congestion rent, the retailer takes the
 * difference and the risk, and the three no longer sum to one tariff bill.
 *
 * So both valuations are kept, per asset, per hour:
 *
 * - **`revenue`** — what the bundled firm was paid: output at the regulated tariff. This is the
 *   basis that reconciles with the cash on screen, and it is the default view.
 * - **`marketRevenue`** — what the same output was worth at the **nodal price** where it was
 *   injected. This is what the asset would have earned as a merchant in an unbundled market, and
 *   it is the view that shows *who earns when*: a peaker that is worthless at tariff earns its
 *   year in forty scarcity hours, a solar farm gives back money at noon in June, and a corridor
 *   earns congestion rent for being too small.
 *
 * Neither is the truth. The regulated one is the truth about this player's balance; the market
 * one is the truth about where value is actually created in the hour it happens, which is the
 * thing a tariff averages away. Showing both is the only honest option, and it happens to be the
 * one that teaches the most.
 *
 * **Congestion rent** — the flow across a line times the price difference between its two ends —
 * is the market basis for a line, and it is exactly what relieving the constraint would have been
 * worth over the hours it bound. When a corridor is unconstrained the spread is nearly zero and
 * the rent is nothing, which is correct: it is not scarce. When it is full, the rent is the case
 * for a second circuit, priced. It stays out of `operatingMargin`, because in *this* firm nobody
 * pays it, and it is the whole of `marketMargin`, because in an unbundled one somebody would.
 */

/** Everything one asset did over one period. All flows, no stocks. */
export interface AssetLedger {
  /** Electrical energy generated, or carried for a line. */
  energyMwh: number
  /** Heat delivered. A boiler's only product, and half of what a cogeneration unit sells. */
  heatMwh: number
  /** What both products fetched at the tariffs the firm is paid. Lines have none: they sell nothing. */
  revenue: number
  /**
   * The same output valued at the nodal price where it was injected — what a merchant would have
   * earned for it. For a line this is the congestion rent, which is a carrier's whole income.
   */
  marketRevenue: number
  /**
   * What relieving this corridor would have been worth, over the hours it was scarce.
   *
   * Not income in a bundled firm and so not in `operatingMargin` — see the note at the top of
   * this file. It is the argument for a second circuit, priced.
   */
  congestionRent: number
  /**
   * Energy this asset *bought* rather than sold, at the tariff: what a line lost carrying the
   * rest, what a battery drew to charge, what a heat main gave up to the ground.
   */
  energyCost: number
  /** The same purchase at the nodal price of the hour, for the market basis. */
  marketEnergyCost: number
  fuelCost: number
  carbonCost: number
  varOpex: number
  fixedOpex: number
  /** Capital paid in this period: instalments while building, dismantling when retiring. */
  capital: number
  co2Tonnes: number
  /** Energy lost in transmission. Lines only. */
  lossMwh: number
  /** Hours in which this line was at or above its rating. Lines only. */
  congestedHours: number
}

export function emptyAssetLedger(): AssetLedger {
  return {
    energyMwh: 0,
    heatMwh: 0,
    revenue: 0,
    marketRevenue: 0,
    congestionRent: 0,
    energyCost: 0,
    marketEnergyCost: 0,
    fuelCost: 0,
    carbonCost: 0,
    varOpex: 0,
    fixedOpex: 0,
    capital: 0,
    co2Tonnes: 0,
    lossMwh: 0,
    congestedHours: 0,
  }
}

export function addAssetLedger(into: AssetLedger, from: AssetLedger): void {
  into.energyMwh += from.energyMwh
  into.heatMwh += from.heatMwh
  into.revenue += from.revenue
  into.marketRevenue += from.marketRevenue
  into.congestionRent += from.congestionRent
  into.energyCost += from.energyCost
  into.marketEnergyCost += from.marketEnergyCost
  into.fuelCost += from.fuelCost
  into.carbonCost += from.carbonCost
  into.varOpex += from.varOpex
  into.fixedOpex += from.fixedOpex
  into.capital += from.capital
  into.co2Tonnes += from.co2Tonnes
  into.lossMwh += from.lossMwh
  into.congestedHours += from.congestedHours
}

/**
 * Operating margin: what it earned less what it cost to run.
 *
 * Capital is excluded deliberately. A paid-off station with a positive operating margin should go
 * on running even if it will never repay what it originally cost, and a player deciding whether
 * to close something this year needs the number that answers *that* question. `fullMargin` is
 * there for the other question.
 */
/** Costs that do not depend on which price the output is valued at. */
function ownCosts(l: AssetLedger): number {
  return l.fuelCost + l.carbonCost + l.varOpex + l.fixedOpex
}

export function runningCosts(l: AssetLedger): number {
  return ownCosts(l) + l.energyCost
}

export function operatingMargin(l: AssetLedger): number {
  return l.revenue - runningCosts(l)
}

/**
 * The same margin on the market basis: what this asset would have earned selling its output at
 * the nodal price, rather than being paid a tariff by the company that owns it.
 *
 * The two disagree most exactly where the interesting decisions are. A peaker that looks like a
 * standing cost all year is where the market pays its bill in the forty hours the system is
 * short, and a corridor that has no margin at all in the regulated books is where the whole
 * market value of the hour ends up when it is full.
 */
export function marketMargin(l: AssetLedger): number {
  // Energy bought is valued on the same basis as energy sold, or the comparison would be rigged.
  // It is also where the most interesting disagreement lives: a battery at a flat tariff buys and
  // sells at the same price and therefore loses exactly its round-trip efficiency, every cycle,
  // for ever. It is only worth owning at prices that move — which is the market column, and which
  // is why storage arrives in real systems at the same time as a market does.
  return l.marketRevenue - ownCosts(l) - l.marketEnergyCost
}

/** Operating margin less the capital paid in the same period. */
export function fullMargin(l: AssetLedger): number {
  return operatingMargin(l) - l.capital
}

/**
 * Three windows per asset, for the same reason the utility's accounts have three.
 *
 * The month is what the player watches, the year is what a decision is judged on, and the
 * lifetime is what says whether building the thing was ever a good idea.
 */
export interface AssetAccounts {
  open: AssetLedger
  lastMonth: AssetLedger
  year: AssetLedger
  lifetime: AssetLedger
}

/**
 * The windows as a reader asks for them, which is not how they are stored.
 *
 * `year` and `lifetime` hold only *closed* months, because that is what makes the arithmetic of
 * rolling a period over simple. A reader wants the month in progress included — a panel that says
 * a station earned nothing this year because it is the fourth of January is not reporting, it is
 * misleading, and a brand-new game would show a screen of zeros for its first thirty days.
 */
export type LedgerWindow = 'month' | 'year' | 'lifetime'

export function emptyAssetAccounts(): AssetAccounts {
  return {
    open: emptyAssetLedger(),
    lastMonth: emptyAssetLedger(),
    year: emptyAssetLedger(),
    lifetime: emptyAssetLedger(),
  }
}

/**
 * A book of accounts keyed by asset id.
 *
 * A plain map rather than a field on the asset, because lines are not assets in the same sense —
 * a `GridEdge` is a graph edge and giving it an accounting tail would drag the network module
 * into the economy. Keeping the books separate also means an asset that is demolished keeps its
 * history, which is exactly what a post-mortem needs.
 */
export class AssetBooks {
  private readonly books = new Map<string, AssetAccounts>()

  /** The accounts for an id, created empty on first use. */
  for(id: string): AssetAccounts {
    let book = this.books.get(id)
    if (!book) {
      book = emptyAssetAccounts()
      this.books.set(id, book)
    }
    return book
  }

  get(id: string): AssetAccounts | undefined {
    return this.books.get(id)
  }

  /**
   * One window, including the month in progress.
   *
   * 'month' is the month *now*, not the last completed one: a player looking at this month wants
   * what is happening, and the closed month is a report they can already read in the year.
   */
  window(id: string, window: LedgerWindow): AssetLedger {
    const book = this.books.get(id)
    if (!book) return emptyAssetLedger()
    if (window === 'month') return book.open
    const total = emptyAssetLedger()
    addAssetLedger(total, window === 'year' ? book.year : book.lifetime)
    addAssetLedger(total, book.open)
    return total
  }

  ids(): string[] {
    return [...this.books.keys()]
  }

  /** Roll the open period into the month and the year. Called when the month closes. */
  closeMonth(): void {
    for (const book of this.books.values()) {
      book.lastMonth = book.open
      addAssetLedger(book.year, book.open)
      addAssetLedger(book.lifetime, book.open)
      book.open = emptyAssetLedger()
    }
  }

  closeYear(): void {
    for (const book of this.books.values()) book.year = emptyAssetLedger()
  }

  /** Everything, ranked by a chosen measure over a chosen window. Worst first. */
  ranked(
    window: LedgerWindow,
    measure: (l: AssetLedger) => number = operatingMargin,
  ): Array<{ id: string; value: number; ledger: AssetLedger }> {
    const rows = this.ids().map((id) => {
      const ledger = this.window(id, window)
      return { id, value: measure(ledger), ledger }
    })
    rows.sort((a, b) => a.value - b.value)
    return rows
  }

  toJSON(): Array<[string, AssetAccounts]> {
    return [...this.books]
  }

  loadJSON(entries: Array<[string, AssetAccounts]>): void {
    this.books.clear()
    for (const [id, accounts] of entries) this.books.set(id, accounts)
  }
}
