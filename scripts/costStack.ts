/** Where a passive utility's money goes, per MWh, year by year. A diagnostic, not a test. */
import { buildWorld } from '../src/sim/scenario/build'
import { FIRST_REGION } from '../src/content/scenarios/firstRegion'
import { TICKS_PER_YEAR, isYearBoundary } from '../src/sim/core/time'

const w = buildWorld(FIRST_REGION)
const p = (x: number, mwh: number) => (mwh > 0 ? (x / mwh).toFixed(1).padStart(6) : '     -')
console.log('year | rev/MWh   fuel carbon varOpx fixOpx  inter  unsrv | tariff  CO2 EUR/t | net/MWh | government')
for (let i = 0; i < TICKS_PER_YEAR * 16; i++) {
  // Read the annual ledger on the last tick before it is closed and reset.
  if (isYearBoundary(w.tick + 1)) {
    const l = w.yearLedger
    const mwh = l.energySoldMwh
    const net =
      l.revenue + l.heatRevenue - l.fuelCost - l.carbonCost - l.varOpex - l.fixedOpex -
      l.interest - l.unservedPenalty - l.rooftopPurchases
    console.log(
      w.date.year, '|',
      p(l.revenue + l.heatRevenue, mwh),
      p(l.fuelCost, mwh), p(l.carbonCost, mwh), p(l.varOpex, mwh), p(l.fixedOpex, mwh),
      p(l.interest, mwh), p(l.unservedPenalty, mwh),
      '|', w.state.regulatedTariffPerMwh.toFixed(0).padStart(4),
      w.state.carbonPricePerTonne.toFixed(0).padStart(9),
      '|', p(net, mwh),
      '|', w.state.policyRegimeId,
    )
  }
  w.step()
}
