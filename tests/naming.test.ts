/**
 * What things are called.
 *
 * Naming looks like decoration and is not. Two of these tests are for a bug that had been in the
 * game since the scenario was written: the author named the two lignite sets at Blackridge
 * "Blackridge I" and "Blackridge II", the plant had nowhere to put a name, and so both units
 * answered to the site — while the inspector, which read neither, printed the raw id `blackridge1`
 * at the player. Three names existed for that machine and the one on screen was the database's.
 *
 * The rest is the convention that makes a name safe to show: the model hands display names to the
 * interface as `key#index` so a station the player built can be renamed by switching language, and
 * a name the player typed must never be mistaken for one of those.
 */

import { describe, expect, it } from 'vitest'
import { buildWorld } from '@sim/scenario/build'
import { FIRST_REGION } from '@content/scenarios/firstRegion'
import { MAX_NAME_LENGTH, sanitiseName } from '@sim/naming'
import { beginPlantConstruction, beginSubstationConstruction } from '@sim/build/commands'
import { isBuildable } from '@sim/map/terrain'

function world() {
  return buildWorld(FIRST_REGION)
}

/** Somewhere a station may legally go, so the test is about naming and not about siting. */
function freeTile(w: ReturnType<typeof world>): { x: number; y: number } {
  const taken = new Set(w.network.allNodes().map((n) => `${n.x},${n.y}`))
  for (let y = 0; y < FIRST_REGION.mapHeight; y++) {
    for (let x = 0; x < FIRST_REGION.mapWidth; x++) {
      if (!taken.has(`${x},${y}`) && isBuildable(w.terrain, x, y)) return { x, y }
    }
  }
  throw new Error('nowhere to build')
}

describe('the names the scenario wrote', () => {
  it('gives each unit on a shared site its own name', () => {
    const w = world()
    expect(w.plantDisplayName('p_blackridge1')).toBe('Blackridge I')
    expect(w.plantDisplayName('p_blackridge2')).toBe('Blackridge II')
    // And the site itself is still the site, which is what the two of them have in common.
    expect(w.displayName('n_blackridge')).toBe('Blackridge')
  })

  it('never shows an id where a name exists', () => {
    const w = world()
    for (const plant of w.plants) {
      expect(w.plantDisplayName(plant.id), plant.id).not.toContain('_')
      expect(w.plantDisplayName(plant.id), plant.id).not.toBe(plant.id)
    }
  })
})

describe('renaming', () => {
  it('renames a unit without touching the site it stands on', () => {
    const w = world()
    expect(w.renameAsset('p_blackridge1', 'The Old Girl')).toBe('The Old Girl')
    expect(w.plantDisplayName('p_blackridge1')).toBe('The Old Girl')
    expect(w.plantDisplayName('p_blackridge2')).toBe('Blackridge II')
    expect(w.displayName('n_blackridge')).toBe('Blackridge')
  })

  it('renames a station the player built, and the map is told to redraw', () => {
    const w = world()
    const where = freeTile(w)
    const built = beginSubstationConstruction(w, 220, where.x, where.y)
    expect(built.ok).toBe(true)

    // Before: the technology and a serial, composed by the interface.
    expect(w.displayName(built.nodeId!)).toMatch(/^substation\.220#\d+$/)

    const before = w.network.labelEpoch
    expect(w.renameAsset(built.nodeId!, 'Coast Junction')).toBe('Coast Junction')
    expect(w.displayName(built.nodeId!)).toBe('Coast Junction')
    // Labels moved; the graph did not. Putting a rename through the topology counter would throw
    // away the island partition and every dispatch cache to redraw a word.
    expect(w.network.labelEpoch).toBeGreaterThan(before)
  })

  it('does not disturb the graph', () => {
    const w = world()
    const before = w.network.topologyEpoch
    w.renameAsset('n_blackridge', 'Blackridge Works')
    expect(w.network.topologyEpoch).toBe(before)
  })

  it('clears a name back to what the thing was called before', () => {
    const w = world()
    const where = freeTile(w)
    const built = beginPlantConstruction(w, 'ocgt', where.x, where.y)
    expect(built.ok).toBe(true)
    const original = w.plantDisplayName(built.plantId!)

    w.renameAsset(built.plantId!, 'Peaker One')
    expect(w.plantDisplayName(built.plantId!)).toBe('Peaker One')

    expect(w.renameAsset(built.plantId!, '   ')).toBe(original)
    expect(w.plantDisplayName(built.plantId!)).toBe(original)
  })

  it('reports nothing renamed when there is nothing by that id', () => {
    expect(world().renameAsset('p_does_not_exist', 'Ghost')).toBeNull()
  })

  it('survives a save and a load', () => {
    const w = world()
    // Checked rather than fired and forgotten: renaming something that does not exist is a
    // no-op, so an id typed wrong here would leave the assertions below passing on the default.
    expect(w.renameAsset('p_gorge', 'Gorge Old Set')).toBe('Gorge Old Set')
    expect(w.renameAsset('n_northsub', 'Northern Junction')).toBe('Northern Junction')

    const loaded = world()
    loaded.applySaveData(JSON.parse(JSON.stringify(w.toSaveData())))
    expect(loaded.plantDisplayName('p_gorge')).toBe('Gorge Old Set')
    expect(loaded.displayName('n_northsub')).toBe('Northern Junction')
  })
})

describe('a name the player typed', () => {
  it('cannot be mistaken for a key and an index', () => {
    // `key#index` is how the model hands a translatable name over. A hash in a typed name would
    // have been handed to the expander, which would have tried to translate "Unit ".
    expect(sanitiseName('Unit #3')).toBe('Unit 3')
    expect(sanitiseName('#')).toBeUndefined()
  })

  it('collapses the whitespace nobody meant to type', () => {
    expect(sanitiseName('  Coast   Junction  ')).toBe('Coast Junction')
    expect(sanitiseName('')).toBeUndefined()
    expect(sanitiseName('\t\n ')).toBeUndefined()
  })

  it('cannot be long enough to wreck the panel it appears in', () => {
    const long = 'A'.repeat(MAX_NAME_LENGTH * 3)
    expect(sanitiseName(long)?.length).toBe(MAX_NAME_LENGTH)
  })

  it('keeps the punctuation of a real name', () => {
    expect(sanitiseName("St. Mary's Wharf B")).toBe("St. Mary's Wharf B")
    expect(sanitiseName('Elektrárna Černá Hora')).toBe('Elektrárna Černá Hora')
  })
})
