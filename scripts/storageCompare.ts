/**
 * A paired, multi-seed comparison of storage technologies.
 *
 * The first attempt at this compared a single run of each arm and drew a confident conclusion
 * from the difference. That was wrong: unserved energy in this scenario has a standard
 * deviation across seeds roughly equal to its mean, so a single-run difference of a couple of
 * thousand MWh carries no information at all. Every arm here runs the same set of seeds, and
 * the spread is reported alongside the mean so the reader can see whether a difference is
 * real.
 */
import { buildWorld } from '../src/sim/scenario/build'
import { FIRST_REGION } from '../src/content/scenarios/firstRegion'
import { PLANT_TYPES, type PlantTypeId } from '../src/content/plantTypes'
import { TICKS_PER_YEAR } from '../src/sim/core/time'
import { beginLineConstruction, beginPlantConstruction } from '../src/sim/build/commands'
import { LifecyclePhase } from '../src/sim/assets/types'
import { energyCapacityMwh } from '../src/sim/dispatch/storage'
import { judgeSite } from '../src/sim/build/siting'

const SEEDS = [20250803, 20250804, 20250805, 11111, 22222, 33333, 44444, 55555, 66666, 77777, 88888, 99999]
const YEARS = 5

interface Run {
  unservedMwh: number
  marginEur: number
  dischargedMwh: number
  cycles: number
}

function run(seed: number, typeId: PlantTypeId | null): Run {
  const world = buildWorld({ ...FIRST_REGION, startYear: 2020, seed })
  let plantId: string | null = null

  if (typeId) {
    // Siting rules mean a technology cannot go just anywhere: pumped storage needs a head
    // drop the capital's surroundings may not have. Take the best site on the map for this
    // technology, breaking ties toward the load, which is what a player would do.
    const capital = world.network.requireNode('n_rivermouth')
    let site: { x: number; y: number } | null = null
    let bestScore = -Infinity
    for (let y = 0; y < world.scenario.mapHeight; y++) {
      for (let x = 0; x < world.scenario.mapWidth; x++) {
        if (world.nodeNear(x, y, 1.5)) continue
        const verdict = judgeSite(typeId, {
          terrain: world.terrain,
          network: world.network,
          cities: world.cities,
          x,
          y,
        })
        if (!verdict.ok) continue
        const distance = Math.hypot(x - capital.x, y - capital.y)
        const score = verdict.quality - distance * 0.02
        if (score > bestScore) {
          bestScore = score
          site = { x, y }
        }
      }
    }
    if (!site) throw new Error('nowhere to put the store')
    const built = beginPlantConstruction(world, typeId, site.x, site.y)
    if (!built.ok) throw new Error(built.quote.reasonKey)
    plantId = built.plantId!
    beginLineConstruction(world, world.getPlant(plantId)!.nodeId, 'n_rivermouth', 220, 1)
    let guard = 0
    while (world.getPlant(plantId)!.phase !== LifecyclePhase.Operating && guard++ < 200_000) world.step()
  }
  // Settle, so every arm starts from a comparable operating state.
  for (let i = 0; i < 24 * 30; i++) world.step()

  let unservedMwh = 0
  let marginEur = 0
  let dischargedMwh = 0

  for (let i = 0; i < TICKS_PER_YEAR * YEARS; i++) {
    const snap = world.step()
    unservedMwh += snap.unservedMw
    if (!plantId) continue
    const mw = world.lastDispatch!.generationMw.get(plantId) ?? 0
    if (mw > 0.01) {
      dischargedMwh += mw
      marginEur += mw * snap.pricePerMwh
    } else if (mw < -0.01) {
      marginEur += mw * snap.pricePerMwh
    }
  }

  const energy = plantId ? energyCapacityMwh(world.getPlant(plantId)!) : 1
  return { unservedMwh, marginEur, dischargedMwh, cycles: dischargedMwh / Math.max(1, energy) / YEARS }
}

function stats(values: number[]) {
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, values.length - 1))
  return { mean, sd, sem: sd / Math.sqrt(values.length) }
}

const arms: Array<{ label: string; typeId: PlantTypeId | null }> = [
  { label: 'no storage', typeId: null },
  { label: 'battery 50 MW / 2 h', typeId: 'battery' },
  { label: 'pumped 300 MW / 6 h', typeId: 'pumped' },
]

const results = new Map<string, Run[]>()
for (const arm of arms) results.set(arm.label, SEEDS.map((s) => run(s, arm.typeId)))

const base = results.get('no storage')!.map((r) => r.unservedMwh)
console.log(`\n${YEARS} years, ${SEEDS.length} seeds, paired\n`)
console.log('arm                      unserved MWh (mean ± sem)   vs no storage (paired)   cycles/yr   margin €m')

for (const arm of arms) {
  const rs = results.get(arm.label)!
  const u = stats(rs.map((r) => r.unservedMwh))
  const m = stats(rs.map((r) => r.marginEur / 1e6))
  const c = stats(rs.map((r) => r.cycles))

  let delta = ''
  if (arm.typeId) {
    // Paired differences: same seed in both arms, which removes the shared noise.
    const diffs = rs.map((r, i) => r.unservedMwh - base[i]!)
    const d = stats(diffs)
    const significant = Math.abs(d.mean) > 2 * d.sem
    delta = `${d.mean >= 0 ? '+' : ''}${d.mean.toFixed(0)} ± ${d.sem.toFixed(0)}  ${significant ? '(real)' : '(noise)'}`
  }

  console.log(
    `${arm.label.padEnd(24)} ${u.mean.toFixed(0).padStart(8)} ± ${u.sem.toFixed(0).padStart(5)}      ` +
      `${delta.padEnd(24)} ${arm.typeId ? c.mean.toFixed(0).padStart(6) : '     -'}   ${
        arm.typeId ? m.mean.toFixed(2).padStart(7) : '      -'
      }`,
  )
}
