/**
 * Whether a reactor is buildable now that there is a way to finance one.
 *
 * The measurement this answers is `scripts/whyNoReactor.ts`: 724 valid sites, a levelised cost of
 * 55.6 EUR/MWh before fuel, and a capital cost of 3005 million against an opening balance of 400 —
 * so the only window in which the quote passed was 2004 to 2010, and only in a run where the
 * player did nothing else with their money. The control player took that window in 2009 and was
 * bankrupt by 2012.
 *
 * The question is not whether a facility makes a reactor free. It should not, and the numbers
 * below are the check on that: the equity share is still real money, the debt at commissioning is
 * larger than the sum drawn, and the instalments run for twenty-five years afterwards. What it
 * should change is *when* the decision becomes possible at all.
 *
 * Run: npx tsx scripts/canWeAffordAReactor.ts
 */

import { buildWorld } from '@sim/scenario/build'
import { FIRST_REGION } from '@content/scenarios/firstRegion'
import { PLANT_TYPES } from '@content/plantTypes'
import { quotePlant } from '@sim/build/commands'
import { judgeSite } from '@sim/build/siting'
import { formatMoney } from '@i18n/index'

const world = buildWorld(FIRST_REGION)

let site: { x: number; y: number } | null = null
for (let y = 0; y < world.scenario.mapHeight && !site; y++) {
  for (let x = 0; x < world.scenario.mapWidth && !site; x++) {
    if (world.nodeNear(x, y, 1.5)) continue
    const verdict = judgeSite('nuclear', {
      terrain: world.terrain,
      network: world.network,
      cities: world.cities,
      x,
      y,
    })
    if (verdict.ok) site = { x, y }
  }
}
if (!site) throw new Error('nowhere to put a reactor')

console.log('year   cash        from cash            with a facility')
for (let year = 0; year <= FIRST_REGION.endYear - FIRST_REGION.startYear; year += 3) {
  while (world.date.year < FIRST_REGION.startYear + year) world.step()
  const cash = quotePlant(world, 'nuclear', site.x, site.y)
  const financed = quotePlant(world, 'nuclear', site.x, site.y, true)
  const facility = financed.facility
  console.log(
    `${world.date.year}   ${formatMoney(world.finances.cash).padStart(8)}   ` +
      `${(cash.ok ? 'ok' : (cash.reasonKey ?? 'refused')).padEnd(20)} ` +
      `${financed.ok ? `ok, equity ${formatMoney(facility!.equity)}` : (financed.reasonKey ?? 'refused')}`,
  )
}

// And what the facility actually commits the player to, on day one.
//
// Quoted against a fresh world rather than the one the loop above left behind. That world is in
// 2025 with a negative balance, so the quote is refused and there are no terms to print — which
// is correct behaviour and made this section throw until it stopped asking the wrong world.
const opening = buildWorld(FIRST_REGION)
const financed = quotePlant(opening, 'nuclear', site.x, site.y, true)
const f = financed.facility!
console.log('\nterms on a reactor')
console.log(`  capital cost          ${formatMoney(financed.totalCost)}`)
console.log(`  lender advances       ${formatMoney(f.commitment)} (${(f.commitment / financed.totalCost * 100).toFixed(0)}%)`)
console.log(`  your share, in cash   ${formatMoney(f.equity)}`)
console.log(`  rate                  ${(f.ratePerYear * 100).toFixed(2)}%`)
console.log(`  owed on completion    ${formatMoney(f.balanceAtCommissioning)}  <- more than was drawn`)
console.log(`  then                  ${formatMoney(f.monthlyPayment)} a month for ${f.termYears} years`)
console.log(
  `  total repaid          ${formatMoney(f.monthlyPayment * f.termYears * 12)} ` +
    `on ${formatMoney(f.commitment)} drawn`,
)

// The same offer against something small, which should not be on it at all. A gas turbine rather
// than a battery, which does not exist until 2015 and would be refused for the wrong reason.
const small = quotePlant(opening, 'ocgt', site.x, site.y, true)
console.log(
  `\nthe same offer on a gas turbine: ${small.ok ? 'offered' : (small.reasonKey ?? 'refused')} ` +
    `(${formatMoney(PLANT_TYPES.ocgt.capexPerKw.value * PLANT_TYPES.ocgt.capacityMw.value * 1000)})`,
)
