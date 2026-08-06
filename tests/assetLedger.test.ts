/**
 * Per-asset accounts, on both bases.
 *
 * The question this exists to answer is the one a played run could not: *which of these is losing
 * the money?* The utility's books are one pot, so a decade of falling cash said nothing about
 * where it went, and the diagnosis got as far as "the corridor, probably", by elimination.
 *
 * Every asset is valued twice. At the **tariff**, because that is what this vertically integrated
 * firm is actually paid, and at the **nodal price**, because that is what the hour was worth where
 * it happened. The first reconciles with the cash on screen and the second says *when* the money
 * was made — a distinction a flat tariff averages away by design, and the reason a regulated
 * utility can own a peaking plant for thirty years and never find out what it was for.
 *
 * The reconciliation test below is the one that keeps the first of those honest. It is easy to
 * write per-asset accounts that look plausible and add up to nothing in particular; if they do,
 * they are decoration.
 */

import { describe, expect, it } from 'vitest'
import { buildWorld } from '@sim/scenario/build'
import { FIRST_REGION } from '@content/scenarios/firstRegion'
import { marketMargin, operatingMargin } from '@sim/economy/assetLedger'
import { playScenario } from './autoPlayer'

describe('who earns and who loses', () => {
  it('attributes energy, fuel and carbon to the machine that produced them', () => {
    const world = buildWorld(FIRST_REGION)
    for (let i = 0; i < 24 * 40; i++) world.step()

    const rows = world.books.ranked('lifetime')
    expect(rows.length).toBeGreaterThan(0)

    // Every plant that generated has energy, and every one that burns something has a fuel bill.
    for (const plant of world.plants) {
      const book = world.books.get(plant.id)?.lifetime
      if (!book || book.energyMwh <= 0) continue
      expect(book.revenue, plant.id).toBeGreaterThan(0)
      expect(book.marketRevenue, plant.id).toBeGreaterThan(0)
      const burns = plant.typeId !== 'wind' && plant.typeId !== 'solar' && plant.typeId !== 'hydro'
      if (burns) expect(book.fuelCost, plant.id).toBeGreaterThan(0)
    }
  }, 120_000)

  it('adds up to the money the utility actually took', () => {
    // The claim the accounts panel makes in words, checked in numbers. Because producer, carrier
    // and retailer are one company, every internal transfer is valued at the one price the company
    // is paid, and the per-asset revenue must therefore close on the utility's own ledger:
    //
    //     Σ plants (sold at tariff) − Σ lines (energy lost) − Σ stores (energy drawn) = sales
    //
    // It does not close exactly, and the residual is named rather than papered over: the heat
    // network's standing losses and its circulating pumps both consume without being charged to
    // any asset yet. Both are small and both are on the list; the tolerance here is set to catch
    // a *structural* break — a whole revenue stream credited twice, or to nobody — rather than to
    // certify the last euro.
    const world = buildWorld(FIRST_REGION)
    for (let i = 0; i < 24 * 90; i++) world.step()

    let assetRevenue = 0
    let assetEnergyCost = 0
    for (const id of world.books.ids()) {
      const book = world.books.get(id)!.lifetime
      assetRevenue += book.revenue
      assetEnergyCost += book.energyCost
    }
    const attributed = assetRevenue - assetEnergyCost
    const collected = world.lifetimeLedger.revenue + world.lifetimeLedger.heatRevenue

    const residual = Math.abs(attributed - collected) / Math.max(1, collected)
    console.log(
      'attributed', (attributed / 1e6).toFixed(1) + 'm',
      'collected', (collected / 1e6).toFixed(1) + 'm',
      'residual', (residual * 100).toFixed(2) + '%',
    )
    expect(residual).toBeLessThan(0.03)

    // And the cost side closes exactly, because it is the same arithmetic run twice: the per-asset
    // fuel bill uses the same `thermalInputMwh` the utility's ledger does, so any disagreement
    // here would be a plant being charged in one book and not the other.
    let assetFuel = 0
    for (const id of world.books.ids()) assetFuel += world.books.get(id)!.lifetime.fuelCost
    expect(assetFuel).toBeCloseTo(world.lifetimeLedger.fuelCost, -3)
  }, 180_000)

  it('gives a line an income only when it is bridging a price difference', () => {
    // The point of congestion rent: an unconstrained corridor earns nothing, because it is not
    // scarce. A line that earns a great deal is one worth reinforcing, and that is arithmetic
    // rather than a hunch. In this firm the rent is nobody's income, so it belongs to the market
    // basis and not to `revenue` — a line that sells nothing must not appear to.
    const world = buildWorld(FIRST_REGION)
    for (let i = 0; i < 24 * 60; i++) world.step()

    const lines = world.network
      .allEdges()
      .filter((e) => e.commodity === 'electric')
      .map((e) => ({ id: e.id, book: world.books.get(e.id)?.lifetime }))
      .filter((row) => row.book && row.book.energyMwh > 0)

    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) {
      expect(line.book!.revenue, line.id).toBe(0)
      // Rent is never negative: a line is not charged for the privilege of carrying power.
      expect(line.book!.congestionRent, line.id).toBeGreaterThanOrEqual(0)
      expect(line.book!.lossMwh, line.id).toBeGreaterThanOrEqual(0)
      // Carrying power costs energy, so a corridor is a cost centre in the regulated books.
      expect(operatingMargin(line.book!), line.id).toBeLessThanOrEqual(0)
    }
    // And at least one corridor in this scenario is worth something, since the whole premise is
    // that the link between the lignite and the demand was built for a smaller country.
    expect(lines.some((l) => l.book!.congestionRent > 0)).toBe(true)
  }, 120_000)

  it('names the worst asset in a played run, and shows where the tariff hides the value', () => {
    // What the accounts are for. This does not assert *which* asset loses — that is a balance
    // question and naming one here would freeze it — only that the question now has an answer,
    // and that the two valuations genuinely disagree about it. If they never did, the second
    // column would be decoration and the tariff would be costing the player nothing in insight.
    const world = buildWorld(FIRST_REGION)
    playScenario(world, { untilYear: FIRST_REGION.startYear + 12 })

    const byTariff = world.books.ranked('lifetime', operatingMargin)
    const byMarket = world.books.ranked('lifetime', marketMargin)

    console.log('worst five at tariff:')
    for (const row of byTariff.slice(0, 5)) {
      console.log(
        `  ${row.id.padEnd(24)} ${(row.value / 1e6).toFixed(0).padStart(7)}m  ` +
          `market ${(marketMargin(row.ledger) / 1e6).toFixed(0).padStart(7)}m  ` +
          `energy ${Math.round(row.ledger.energyMwh / 1000)}GWh ` +
          `fuel ${(row.ledger.fuelCost / 1e6).toFixed(0)}m carbon ${(row.ledger.carbonCost / 1e6).toFixed(0)}m`,
      )
    }
    console.log('best five at tariff:')
    for (const row of byTariff.slice(-5).reverse()) {
      console.log(
        `  ${row.id.padEnd(24)} ${(row.value / 1e6).toFixed(0).padStart(7)}m  ` +
          `market ${(marketMargin(row.ledger) / 1e6).toFixed(0).padStart(7)}m`,
      )
    }
    console.log('best five at market prices:')
    for (const row of byMarket.slice(-5).reverse()) {
      console.log(
        `  ${row.id.padEnd(24)} ${(row.value / 1e6).toFixed(0).padStart(7)}m  ` +
          `tariff ${(operatingMargin(row.ledger) / 1e6).toFixed(0).padStart(7)}m ` +
          `rent ${(row.ledger.congestionRent / 1e6).toFixed(0)}m`,
      )
    }

    expect(byTariff.length).toBeGreaterThan(0)
    expect(byTariff[0]!.value).toBeLessThanOrEqual(byTariff.at(-1)!.value)

    // The two orderings are not the same ordering. Somewhere in the fleet is an asset the tariff
    // undervalues — which is the whole reason for showing both.
    //
    // Stated over the whole ranking rather than over its top, which is where it used to be
    // asserted. That was fine while the tariff was set from the clearing price and had no
    // particular relationship to what anything cost; now that it is set from the cost of
    // service, the two bases agree about the *best* asset more often than not — which is not a
    // regression but the point of a cost-reflective tariff. Where they still part company is
    // further down, over assets whose value is locational rather than operational.
    expect(byMarket.map((r) => r.id)).not.toEqual(byTariff.map((r) => r.id))
  }, 900_000)
})
