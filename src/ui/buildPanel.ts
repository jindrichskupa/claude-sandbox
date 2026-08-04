/**
 * The build panel.
 *
 * Two things it must get right. First, the price shown here has to be the price charged —
 * both come from `quotePlant`/`quoteLine`, so they cannot drift apart. Second, when an option
 * is unavailable it says *why* rather than simply going grey: "not until 2015" and "you
 * cannot afford it" are very different pieces of news, and a disabled button tells the player
 * neither.
 */

import { formatMoney, formatMw, t } from '@i18n/index'
import { PLANT_TYPES, PLANT_TYPE_IDS, type PlantTypeId } from '@content/plantTypes'
import { LINE_TYPES, VOLTAGE_LEVELS, type VoltageLevel } from '@content/lineTypes'
import type { World } from '@sim/world'
import { quotePlant, quoteTargetFor } from '@sim/build/commands'
import { Param } from '@sim/params/types'
import { MONTHS_PER_YEAR, TICKS_PER_YEAR } from '@sim/core/time'

const TICKS_PER_MONTH = TICKS_PER_YEAR / MONTHS_PER_YEAR

export type BuildSelection =
  | { kind: 'plant'; typeId: PlantTypeId }
  | { kind: 'line'; kv: VoltageLevel; circuits: number }
  | null

export interface BuildPanelCallbacks {
  onSelect: (selection: BuildSelection) => void
  /** Called when the panel opens, so the inspector can get out of its way. */
  onOpen?: () => void
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

export class BuildPanel {
  private readonly root: HTMLDivElement
  private readonly list: HTMLDivElement
  private readonly toggle: HTMLButtonElement
  private selection: BuildSelection = null
  private open = false

  constructor(
    parent: HTMLElement,
    private readonly world: World,
    private readonly callbacks: BuildPanelCallbacks,
  ) {
    this.toggle = el('button', undefined, t('ui.build'))
    this.toggle.id = 'build-toggle'
    this.toggle.addEventListener('click', () => this.setOpen(!this.open))
    parent.appendChild(this.toggle)

    this.root = el('div', 'panel')
    this.root.id = 'build-panel'
    const header = el('div', 'build-header')
    header.appendChild(el('h3', undefined, t('ui.build')))
    const close = el('button', undefined, t('ui.close'))
    close.addEventListener('click', () => this.setOpen(false))
    header.appendChild(close)
    this.root.appendChild(header)

    this.list = el('div', 'build-list')
    this.root.appendChild(this.list)
    parent.appendChild(this.root)
  }

  setOpen(open: boolean): void {
    this.open = open
    this.root.classList.toggle('visible', open)
    this.toggle.classList.toggle('active', open)
    if (!open) {
      this.select(null)
    } else {
      this.callbacks.onOpen?.()
      this.render()
    }
  }

  isOpen(): boolean {
    return this.open
  }

  select(selection: BuildSelection): void {
    this.selection = selection
    this.callbacks.onSelect(selection)
    this.render()
  }

  /** Redraw. Cheap enough to call whenever money or the date changes. */
  render(): void {
    if (!this.open) return
    this.list.replaceChildren()

    this.list.appendChild(el('div', 'build-group-title', t('ui.plants')))
    for (const typeId of PLANT_TYPE_IDS) {
      this.list.appendChild(this.plantRow(typeId))
    }

    this.list.appendChild(el('div', 'build-group-title', t('ui.lines')))
    for (const kv of VOLTAGE_LEVELS) {
      this.list.appendChild(this.lineRow(kv))
    }
  }

  private plantRow(typeId: PlantTypeId): HTMLDivElement {
    const type = PLANT_TYPES[typeId]
    const row = el('div', 'build-row')

    const selected = this.selection?.kind === 'plant' && this.selection.typeId === typeId
    row.classList.toggle('selected', selected)

    const swatch = el('span', 'build-swatch')
    swatch.style.background = CATEGORY_COLOURS[type.category] ?? '#888'
    row.appendChild(swatch)

    const main = el('div', 'build-main')
    main.appendChild(el('div', 'build-name', t(type.nameKey)))

    // Quote against a spot we know is legal, so the row shows the real price rather than a
    // refusal that belongs to wherever the cursor happens to be.
    const probe = this.legalProbe()
    const quote = probe
      ? quotePlant(this.world, typeId, probe.x, probe.y)
      : { ok: false, totalCost: 0, buildTicks: 0, reasonKey: 'build.unsuitableGround' }

    const target = quoteTargetFor(typeId)
    const capacity = this.world.params.get(target, Param.CapacityMw)
    const capex = this.world.params.get(target, Param.CapexPerKw) * capacity * 1000
    const months = Math.round(this.world.params.get(target, Param.BuildTimeMonths))

    main.appendChild(
      el('div', 'build-meta', `${formatMw(capacity)} · ${formatMoney(capex)} · ${months} ${t('ui.months')}`),
    )

    const year = this.world.date.year
    const tooEarly = year < type.availableFromYear.value
    if (tooEarly) {
      main.appendChild(el('div', 'build-blocked', t('build.notYetAvailable', { year: type.availableFromYear.value })))
    } else if (!quote.ok && quote.reasonKey === 'build.cannotAfford') {
      main.appendChild(el('div', 'build-blocked', t('build.cannotAfford')))
    }

    row.appendChild(main)

    const usable = !tooEarly && (quote.ok || quote.reasonKey !== 'build.cannotAfford')
    row.classList.toggle('disabled', !usable)
    if (usable) {
      row.addEventListener('click', () => {
        this.select(selected ? null : { kind: 'plant', typeId })
      })
    }
    return row
  }

  private lineRow(kv: VoltageLevel): HTMLDivElement {
    const type = LINE_TYPES[kv]
    const row = el('div', 'build-row')
    const selected = this.selection?.kind === 'line' && this.selection.kv === kv
    row.classList.toggle('selected', selected)

    const swatch = el('span', 'build-swatch')
    swatch.style.background = '#5fc27e'
    swatch.style.height = kv === 400 ? '5px' : kv === 220 ? '4px' : '3px'
    row.appendChild(swatch)

    const main = el('div', 'build-main')
    main.appendChild(el('div', 'build-name', t(type.nameKey)))
    main.appendChild(
      el(
        'div',
        'build-meta',
        `${formatMw(type.capacityMw.value)} · ${formatMoney(type.capexPerKm.value)}/km · ${t('ui.perSubstation', {
          cost: formatMoney(type.substationCapex.value),
        })}`,
      ),
    )
    row.appendChild(main)

    row.addEventListener('click', () => {
      this.select(selected ? null : { kind: 'line', kv, circuits: 1 })
    })
    return row
  }

  /** A tile that is legal to build on, used only to produce a representative quote. */
  private legalProbe(): { x: number; y: number } | null {
    const terrain = this.world.terrain
    for (let y = 0; y < terrain.height; y += 3) {
      for (let x = 0; x < terrain.width; x += 3) {
        if (this.world.nodeNear(x, y, 1.5)) continue
        const tile = terrain.tiles[y * terrain.width + x]
        // Anything that is not water (0) or mountain (4).
        if (tile !== 0 && tile !== 4) return { x, y }
      }
    }
    return null
  }

  /** Ticks a plant of this type would take to build; used by the UI for progress display. */
  static buildTicksFor(world: World, typeId: PlantTypeId): number {
    return Math.max(1, Math.round(world.params.get(quoteTargetFor(typeId), Param.BuildTimeMonths) * TICKS_PER_MONTH))
  }
}

const CATEGORY_COLOURS: Record<string, string> = {
  thermal: '#c86a3a',
  nuclear: '#b455c8',
  hydro: '#3f9fd0',
  wind: '#63c8a8',
  solar: '#e0c04a',
  storage: '#9aa3b0',
}
