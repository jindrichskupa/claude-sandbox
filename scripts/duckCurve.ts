/**
 * Does the price shape follow the generation mix, or is it an artefact?
 *
 * The claim under test: with a lot of photovoltaics on the system, the cheap hours should
 * move from the small hours to the middle of the day, and the floor should be able to go
 * *below* zero once must-take renewables are paid a guaranteed tariff regardless of the
 * market price.
 */

import { buildWorld } from '../src/sim/scenario/build'
import { FIRST_REGION } from '../src/content/scenarios/firstRegion'
import { TICKS_PER_YEAR } from '../src/sim/core/time'
import { beginLineConstruction, beginPlantConstruction } from '../src/sim/build/commands'
import { LifecyclePhase } from '../src/sim/assets/types'

function hourlyShape(solarFarms: number, label: string, solarTariff = 0) {
  const world = buildWorld({
    ...FIRST_REGION,
    startYear: 2020,
    feedInTariffs: solarTariff > 0 ? { solar: solarTariff } : {},
  })

  // Scatter solar around the map and wire each farm to the nearest big substation.
  const sites = [
    { x: 14, y: 20 },
    { x: 17, y: 23 },
    { x: 22, y: 8 },
    { x: 25, y: 11 },
    { x: 10, y: 18 },
    { x: 30, y: 14 },
    { x: 6, y: 20 },
    { x: 33, y: 17 },
  ]
  let placed = 0
  for (const site of sites) {
    if (placed >= solarFarms) break
    for (let k = 0; k < 6 && placed < solarFarms; k++) {
      const spot = { x: site.x + (k % 3) * 2, y: site.y + Math.floor(k / 3) * 2 }
      const built = beginPlantConstruction(world, 'solar', spot.x, spot.y)
      if (!built.ok) continue
      const plant = world.getPlant(built.plantId!)!
      beginLineConstruction(world, plant.nodeId, 'n_central', 110, 1)
      placed++
    }
  }

  // Skip construction entirely.
  let guard = 0
  while (world.plants.some((p) => p.phase === LifecyclePhase.Building) && guard++ < 60_000) world.step()
  for (let i = 0; i < 24 * 30; i++) world.step()

  const byHour = Array.from({ length: 24 }, () => ({ price: 0, n: 0, solar: 0, demand: 0 }))
  let minPrice = Infinity
  let maxPrice = -Infinity

  for (let i = 0; i < TICKS_PER_YEAR; i++) {
    const snap = world.step()
    const slot = byHour[snap.date.hour]!
    slot.price += snap.pricePerMwh
    slot.solar += snap.mixMw.solar ?? 0
    slot.demand += snap.demandMw
    slot.n++
    if (snap.unservedMw <= 0.01) {
      minPrice = Math.min(minPrice, snap.pricePerMwh)
      maxPrice = Math.max(maxPrice, snap.pricePerMwh)
    }
  }

  console.log(`\n=== ${label} (${placed} solar farms, ${placed * 50} MW) ===`)
  console.log('hour   price   solar MW   demand MW')
  for (let h = 0; h < 24; h += 2) {
    const s = byHour[h]!
    console.log(
      `  ${String(h).padStart(2, '0')}  €${(s.price / s.n).toFixed(2).padStart(7)}  ${(s.solar / s.n)
        .toFixed(0)
        .padStart(8)}  ${(s.demand / s.n).toFixed(0).padStart(9)}`,
    )
  }

  const cheapest = byHour.reduce((a, b, i) => (b.price / b.n < byHour[a]!.price / byHour[a]!.n ? i : a), 0)
  const dearest = byHour.reduce((a, b, i) => (b.price / b.n > byHour[a]!.price / byHour[a]!.n ? i : a), 0)
  console.log(`cheapest hour: ${cheapest}:00     dearest hour: ${dearest}:00`)
  console.log(`price range (excluding shortage hours): €${minPrice.toFixed(2)} .. €${maxPrice.toFixed(2)}`)
}

hourlyShape(0, 'no solar')
hourlyShape(24, 'solar-heavy, no subsidy')
hourlyShape(24, 'solar-heavy, guaranteed 80/MWh', 80)
