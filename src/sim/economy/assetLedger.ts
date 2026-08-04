/**
 * What each machine and each corridor is actually worth.
 *
 * The accounts have always been a single pot: revenue, fuel, carbon, opex and capital all summed
 * across the whole utility. That is enough to say whether the player is solvent and nothing else.
 * A played run of the opening scenario showed cash falling steadily for a decade and gave no way
 * to answer the only question worth asking about it — *which of these assets is losing the
 * money?* The diagnosis got as far as "the corridor, probably", by elimination.
 *
 * ## How an asset can have revenue at all
 *
 * The utility owns everything and sells to towns at a regulated tariff, so no individual plant
 * has a customer. The standard way a portfolio owner values a unit anyway is to credit it at the
 * **nodal price where it injects** — what its output was worth, at that place, in that hour — and
 * charge it what it cost to produce. That number means something specific and useful: a plant
 * earning less than its own costs at market prices is destroying value, whether or not the
 * utility as a whole is in profit.
 *
 * The same idea gives a line an income for the first time, and it is the one this game most
 * needed. A transmission asset earns **congestion rent**: the flow across it times the difference
 * in price between its two ends. When a corridor is unconstrained that difference is nearly zero
 * and the line earns nothing, which is correct — it is not scarce. When it is full, the price
 * separates, and the rent is exactly what relieving the constraint would be worth. That is the
 * number that turns "should I reinforce this?" from a hunch into arithmetic, and it falls out of
 * the solver's dual variables, which the dispatch has produced since M1 without anyone using them
 * for this.
 *
 * The gap between what the plants earn at nodal prices and what the utility collects in tariff is
 * the retail and network business. It is not lost; it simply is not attributable to a machine.
 */

/** Everything one asset did over one period. All flows, no stocks. */
export interface AssetLedger {
  /** Electrical energy generated, or carried for a line. */
  energyMwh: number
  /** Value of that energy at the nodal price where it was injected — or congestion rent. */
  revenue: number
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
    revenue: 0,
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
  into.revenue += from.revenue
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
export function operatingMargin(l: AssetLedger): number {
  return l.revenue - l.fuelCost - l.carbonCost - l.varOpex - l.fixedOpex
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
    window: keyof AssetAccounts,
    measure: (l: AssetLedger) => number = operatingMargin,
  ): Array<{ id: string; value: number; ledger: AssetLedger }> {
    const rows = this.ids().map((id) => {
      const ledger = this.books.get(id)![window]
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
