/** When a do-nothing run runs out of money, and what killed it. A diagnostic, not a test. */
import { buildWorld } from '../src/sim/scenario/build'
import { FIRST_REGION } from '../src/content/scenarios/firstRegion'
import { TICKS_PER_YEAR } from '../src/sim/core/time'

const w = buildWorld(FIRST_REGION)
const m = (x: number) => `${(x / 1e6).toFixed(0).padStart(6)}m`
let lastYear = -1
for (let i = 0; i < TICKS_PER_YEAR * 31; i++) {
  w.step()
  if (w.finances.bankrupt) {
    console.log(`BANKRUPT at ${w.date.year}-${w.date.month + 1}-${w.date.day + 1}`)
    break
  }
  if (w.date.year !== lastYear) {
    lastYear = w.date.year
    const y = w.yearbook[w.yearbook.length - 1]
    console.log(
      w.date.year,
      'cash', m(w.finances.cash),
      'debt', m(w.finances.debt),
      'profit', y ? m(y.profit) : '     —',
      'tariff', y ? `${y.tariffPerMwh.toFixed(0)}` : '—',
      'unserved', y ? `${(y.unservedShare * 100).toFixed(2)}%` : '—',
      'firm', y ? `${(y.firmCapacityMw / 1000).toFixed(2)} GW` : '—',
      'outcome', w.outcome,
    )
  }
}
