/**
 * What a utility that does absolutely nothing earns, year by year.
 *
 * The control every other measurement in this project needs. An archetype comparison says which
 * strategy does best; it cannot say whether *any* strategy beats sitting still, and a game where
 * inaction wins is broken however interesting the strategies look beside each other.
 *
 * It is also the probe that found the Czech scenario had no financial pressure at all: a fleet
 * that is thirty years old and needs no capital is funded by the regulator as if it were new, so
 * the tariff climbs from 62 to 157 EUR/MWh while the costs stay those of a paid-off system, and
 * the cash piles up whatever the player does. See the note in `sim/economy/tariff.ts` on the
 * modern-equivalent-asset basis, which is a real regulatory principle with this consequence.
 *
 * Run: npx tsx scripts/doNothing.ts [scenarioId] [years]
 */
import { buildWorld } from '@sim/scenario/build'
import { scenarioById } from '@content/scenarios'
import { TICKS_PER_YEAR } from '@sim/core/time'

const w = buildWorld(scenarioById(process.argv[2] ?? 'czechia-1995')!)
const until = Number(process.argv[3]) || 31
console.log('year  govt                  carbon  tariff  profit    cash     debt   unserved  roofs')
for (let y = 0; y < until; y++) {
  for (let i = 0; i < TICKS_PER_YEAR; i++) w.step()
  const r = w.yearbook[w.yearbook.length - 1]!
  console.log(
    `${r.year}  ${r.regimeId.padEnd(20)}  ${w.state.carbonPricePerTonne.toFixed(0).padStart(5)}  ` +
      `${r.tariffPerMwh.toFixed(1).padStart(5)}  ` +
      `${(Math.round(r.profit / 1e6) + 'm').padStart(7)}  ` +
      `${(Math.round(r.cash / 1e6) + 'm').padStart(7)}  ` +
      `${(Math.round(r.debt / 1e6) + 'm').padStart(6)}  ` +
      `${(r.unservedShare * 100).toFixed(2).padStart(6)}%  ` +
      `${Math.round(r.rooftopMw)}`,
  )
  if (w.finances.bankrupt) { console.log('BANKRUPT'); break }
}
