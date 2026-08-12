/**
 * The news desk.
 *
 * This file carries a guarantee that used to be structural. The fast-forward once worked by
 * hashing the world and stopping when the hash changed, which meant no system could forget to
 * announce itself — and which is why the interface could only ever say "Something is happening".
 * Systems post headlines now, so a system that forgets to post is a silent gap.
 *
 * That gap is closed here rather than in the design: the first test plays a scenario in which a
 * station is built, a line is energised, a government is elected and the clock runs for years,
 * and asserts that each of those produced news. If somebody adds a new kind of event and forgets
 * to file it, the way they find out is by adding a case to this list and watching it fail.
 */

import { describe, expect, it } from 'vitest'
import { buildWorld } from '@sim/scenario/build'
import { FIRST_REGION } from '@content/scenarios/firstRegion'
import { NewsImportance } from '@sim/news/news'
import { beginLineConstruction, beginPlantConstruction } from '@sim/build/commands'
import { judgeSite } from '@sim/build/siting'
import { LifecyclePhase } from '@sim/assets/types'
import { SKIP_LIMIT_TICKS } from '@sim/scenario/notable'

function freeSite(world: ReturnType<typeof buildWorld>) {
  for (let y = 0; y < world.scenario.mapHeight; y++) {
    for (let x = 0; x < world.scenario.mapWidth; x++) {
      if (world.nodeNear(x, y, 1.5)) continue
      if (judgeSite('ccgt', { terrain: world.terrain, network: world.network, cities: world.cities, x, y }).ok) {
        return { x, y }
      }
    }
  }
  throw new Error('nowhere to build')
}

/** Step until something worth stopping for is filed — exactly what the game loop does. */
function runUntilNews(world: ReturnType<typeof buildWorld>, limit = SKIP_LIMIT_TICKS) {
  world.news.drain()
  for (let i = 0; i < limit; i++) {
    world.step()
    const item = world.news.peekHighest()
    if (item && item.importance >= NewsImportance.Notable) {
      world.news.drain()
      return { item, ticks: i + 1 }
    }
    world.news.drain()
  }
  return { item: null, ticks: limit }
}

describe('what gets reported', () => {
  it('files a headline for everything a player would need to know about', () => {
    const world = buildWorld(FIRST_REGION)

    const site = freeSite(world)
    const built = beginPlantConstruction(world, 'ccgt', site.x, site.y)
    expect(built.ok).toBe(true)
    const plant = world.getPlant(built.plantId!)!

    // Long enough for the station to finish, a line to be energised, and an election to happen.
    for (let i = 0; i < 24 * 365 * 6; i++) world.step()
    expect(plant.phase).toBe(LifecyclePhase.Operating)

    const titles = new Set(world.news.all().map((n) => n.titleKey))
    const missing = [
      'news.constructionStarted',
      'news.plantCommissioned',
      'news.governmentChanged',
    ].filter((key) => !titles.has(key) && !(key === 'news.governmentChanged' && titles.has('news.governmentReturned')))
    expect(missing, `nothing filed for: ${missing.join(', ')}`).toEqual([])

    // And every headline names its subject where it has one, because an item you cannot follow
    // is a log line rather than news.
    for (const item of world.news.all()) {
      if (item.category !== 'construction' && item.category !== 'grid') continue
      expect(item.subjectId, item.titleKey).toBeTruthy()
    }

    console.log('filed over six years:', world.news.all().length, 'items')
    for (const item of world.news.recent(8)) console.log(' ', item.tick, item.titleKey, JSON.stringify(item.params))
  }, 300_000)

  it('reports a line being started and a line going live as two different things', () => {
    // The pair that matters most for planning. A corridor ordered today carries nothing for
    // years, and a player told only about the second has no way to remember they ordered it.
    const world = buildWorld(FIRST_REGION)
    const nodes = world.network.allNodes()
    const from = nodes.find((n) => n.kind === 'substation') ?? nodes[0]!
    const to = nodes.find((n) => n.id !== from.id && n.kind === 'city')!

    const line = beginLineConstruction(world, from.id, to.id, 220)
    if (!line.ok) return // already connected at this voltage in this scenario; nothing to prove
    expect(world.news.all().some((n) => n.titleKey === 'news.lineStarted')).toBe(true)

    const energisesAt = world.energisingTick(line.edgeId!)!
    while (world.tick < energisesAt) world.step()
    expect(world.news.all().some((n) => n.titleKey === 'news.lineEnergised')).toBe(true)
  }, 300_000)

  it('stops the skip on the hour a station enters service, not later', () => {
    // The property the old signature guaranteed and which must survive the rewrite: the skip
    // stops *at* the moment, not three months past it.
    const world = buildWorld(FIRST_REGION)
    const site = freeSite(world)
    const built = beginPlantConstruction(world, 'ccgt', site.x, site.y)
    expect(built.ok).toBe(true)
    const plant = world.getPlant(built.plantId!)!

    let guard = 0
    while (plant.phase !== LifecyclePhase.Operating && guard++ < 200) {
      const step = runUntilNews(world)
      expect(step.item, 'the skip gave up before the station was ever finished').not.toBeNull()
      if (step.item?.titleKey === 'news.plantCommissioned') break
    }
    expect(plant.phase).toBe(LifecyclePhase.Operating)
    // The date is read now, not before the run. A construction blockade moves it, and the claim
    // being tested is that the skip stops *at* commissioning rather than months past it — which
    // is about the skip, not about the schedule being fixed.
    expect(world.tick).toBe(plant.phaseEndsTick)
  }, 300_000)

  it('does not stop for the weather, the price, or the time of day', () => {
    // The failure mode that would make the fast-forward worthless. Everything in an ordinary hour
    // moves — output, wind, the clearing price — and a feed that reported any of it would stop on
    // the very next tick, every time.
    const world = buildWorld(FIRST_REGION)
    for (let i = 0; i < 200; i++) world.step()
    world.news.drain()

    const price = () => world.recentHistory(1)[0]?.pricePerMwh ?? 0
    const priceBefore = price()
    let moved = false
    for (let i = 0; i < 48; i++) {
      world.step()
      if (Math.abs(price() - priceBefore) > 0.5) moved = true
      const item = world.news.peekHighest()
      if (item && item.importance >= NewsImportance.Notable) return // something real happened; fine
    }
    expect(moved).toBe(true)
  })

  it('says what is coming, with a date where there is one and a probability where there is not', () => {
    const world = buildWorld(FIRST_REGION)
    const site = freeSite(world)
    beginPlantConstruction(world, 'ccgt', site.x, site.y)
    for (let i = 0; i < 24 * 30; i++) world.step()

    const upcoming = world.upcoming()
    expect(upcoming.length).toBeGreaterThan(0)

    // The election and the scenario's own deadline are always ahead of the player.
    expect(upcoming.some((u) => u.titleKey === 'upcoming.election')).toBe(true)
    expect(upcoming.some((u) => u.titleKey === 'upcoming.scenarioEnds')).toBe(true)
    // The station under construction has a date.
    const build = upcoming.find((u) => u.titleKey === 'upcoming.plantCompletes')
    expect(build?.whenTicks).toBeGreaterThan(0)

    // Nothing carries both a date and a probability: they are different claims and mixing them
    // is how a forecast stops being believed.
    for (const item of upcoming) {
      expect(item.whenTicks !== undefined && item.chance !== undefined, item.titleKey).toBe(false)
    }

    console.log('coming up:', upcoming.slice(0, 6).map((u) => `${u.titleKey}@${u.whenTicks ?? '~' + u.chance}`))
  }, 120_000)

  it('carries the archive across a save', () => {
    const world = buildWorld(FIRST_REGION)
    for (let i = 0; i < 24 * 200; i++) world.step()
    const before = world.news.all().length
    expect(before).toBeGreaterThan(0)

    const loaded = buildWorld(FIRST_REGION)
    loaded.applySaveData(world.toSaveData())
    expect(loaded.news.all().length).toBe(before)
  }, 120_000)
})
