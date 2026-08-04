/**
 * Per-asset accounts.
 *
 * The question this exists to answer is the one a played run could not: *which of these is losing
 * the money?* The utility's books are one pot, so a decade of falling cash said nothing about
 * where it went, and the diagnosis got as far as "the corridor, probably", by elimination.
 */

import { describe, expect, it } from 'vitest'
import { buildWorld } from '@sim/scenario/build'
import { FIRST_REGION } from '@content/scenarios/firstRegion'
import { operatingMargin } from '@sim/economy/assetLedger'
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
      const burns = plant.typeId !== 'wind' && plant.typeId !== 'solar' && plant.typeId !== 'hydro'
      if (burns) expect(book.fuelCost, plant.id).toBeGreaterThan(0)
    }
  }, 120_000)

  it('gives a line an income only when it is bridging a price difference', () => {
    // The point of congestion rent: an unconstrained corridor earns nothing, because it is not
    // scarce. A line that earns a great deal is one worth reinforcing, and that is arithmetic
    // rather than a hunch.
    const world = buildWorld(FIRST_REGION)
    for (let i = 0; i < 24 * 60; i++) world.step()

    const lines = world.network
      .allEdges()
      .filter((e) => e.commodity === 'electric')
      .map((e) => ({ id: e.id, book: world.books.get(e.id)?.lifetime }))
      .filter((row) => row.book && row.book.energyMwh > 0)

    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) {
      // Rent is never negative: a line is not charged for the privilege of carrying power.
      expect(line.book!.revenue, line.id).toBeGreaterThanOrEqual(0)
      expect(line.book!.lossMwh, line.id).toBeGreaterThanOrEqual(0)
    }
    // And at least one corridor in this scenario is worth something, since the whole premise is
    // that the link between the lignite and the demand was built for a smaller country.
    expect(lines.some((l) => l.book!.revenue > 0)).toBe(true)
  }, 120_000)

  it('names the worst asset in a played run', () => {
    // What the accounts are for. This does not assert *which* asset loses — that is a balance
    // question and naming one here would freeze it — only that the question now has an answer.
    const world = buildWorld(FIRST_REGION)
    playScenario(world, { untilYear: FIRST_REGION.startYear + 12 })

    const worst = world.books.ranked('lifetime', operatingMargin).slice(0, 5)
    const best = world.books.ranked('lifetime', operatingMargin).slice(-5).reverse()
    console.log('worst five by operating margin:')
    for (const row of worst) {
      console.log(`  ${row.id.padEnd(24)} ${(row.value / 1e6).toFixed(0).padStart(7)}m  ` +
        `energy ${Math.round(row.ledger.energyMwh / 1000)}GWh fuel ${(row.ledger.fuelCost/1e6).toFixed(0)}m ` +
        `carbon ${(row.ledger.carbonCost/1e6).toFixed(0)}m fixed ${(row.ledger.fixedOpex/1e6).toFixed(0)}m`)
    }
    console.log('best five by operating margin:')
    for (const row of best) {
      console.log(`  ${row.id.padEnd(24)} ${(row.value / 1e6).toFixed(0).padStart(7)}m`)
    }
    expect(worst.length).toBeGreaterThan(0)
    expect(worst[0]!.value).toBeLessThanOrEqual(best[0]!.value)
  }, 900_000)
})
