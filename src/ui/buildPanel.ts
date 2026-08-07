/**
 * The build panel.
 *
 * Two things it must get right. First, the price shown here has to be the price charged —
 * both come from `quotePlant`/`quoteLine`, so they cannot drift apart. Second, when an option
 * is unavailable it says *why* rather than simply going grey: "not until 2015" and "you
 * cannot afford it" are very different pieces of news, and a disabled button tells the player
 * neither.
 */

import { formatMoney, formatMw, formatMwth, t } from '@i18n/index'
import { PLANT_TYPES, PLANT_TYPE_IDS, type PlantTypeId } from '@content/plantTypes'
import { lineLossMw, LINE_TYPES, VOLTAGE_LEVELS, type VoltageLevel } from '@content/lineTypes'
import { HEAT_PIPE_TYPES, PIPE_SIZES, type PipeSize } from '@content/heatPipeTypes'
import type { World } from '@sim/world'
import { quotePlant, quoteTargetFor } from '@sim/build/commands'
import { Param } from '@sim/params/types'
import { realCapexFactor } from '@sim/tech/costs'
import { MONTHS_PER_YEAR, TICKS_PER_YEAR } from '@sim/core/time'

const TICKS_PER_MONTH = TICKS_PER_YEAR / MONTHS_PER_YEAR

export type BuildSelection =
  | { kind: 'plant'; typeId: PlantTypeId }
  | { kind: 'line'; kv: VoltageLevel; circuits: number }
  | { kind: 'pipe'; dn: PipeSize; pipes: number }
  | { kind: 'substation'; kv: VoltageLevel }
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

/**
 * The three things a player builds, as sections they choose between.
 *
 * One long scroll before this, and the substations were below eleven kinds of power station and
 * three voltages of line — so a player looking for the thing that lets two corridors meet found
 * a list of turbines and concluded it did not exist. Which it had, for a week.
 *
 * Lines and substations are one section rather than two, because they are one decision: a
 * corridor that needs a junction needs a substation at the junction, and the two were never
 * going to be looked for in different places.
 */
const SECTIONS = [
  { id: 'plants' as const, key: 'ui.plants' },
  { id: 'network' as const, key: 'ui.network' },
  { id: 'heat' as const, key: 'ui.heat' },
]

type SectionId = (typeof SECTIONS)[number]['id']

export class BuildPanel {
  private readonly root: HTMLDivElement
  private readonly list: HTMLDivElement
  private readonly tabs: HTMLDivElement
  private readonly toggle: HTMLButtonElement
  private selection: BuildSelection = null
  private section: SectionId = 'plants'
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

    this.tabs = el('div', 'acct-tabs')
    for (const section of SECTIONS) {
      const button = el('button', undefined, t(section.key))
      button.addEventListener('click', () => {
        this.section = section.id
        this.lastSignature = null
        this.render()
      })
      this.tabs.appendChild(button)
    }
    this.root.appendChild(this.tabs)

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

  /**
   * What the panel would currently show, as a short string.
   *
   * Everything on these rows moves slowly: prices reset annually, cash settles monthly, the
   * government changes at elections. Yet `render` was called ten times a second, and each call
   * rebuilt twenty rows, each of which ran a full `quotePlant` — including `legalProbe`, which
   * searches the map for a site the technology will accept. That is a map scan per technology,
   * two hundred times a second, to redraw text that changes a few times a game year.
   */
  private signature(): string {
    const w = this.world
    const d = w.date
    return [
      d.year,
      d.month,
      // Bucketed, because affordability is the only thing cash changes here and it is a
      // threshold rather than a number on display.
      Math.round(w.finances.cash / 1e6),
      w.state.policyRegimeId,
      this.section,
      this.selection ? JSON.stringify(this.selection) : '',
    ].join('|')
  }

  private lastSignature: string | null = null

  /** Redraw, but only when something the panel shows has actually changed. */
  render(): void {
    if (!this.open) return
    const signature = this.signature()
    if (signature === this.lastSignature) return
    this.lastSignature = signature
    this.list.replaceChildren()
    for (let i = 0; i < this.tabs.children.length; i++) {
      this.tabs.children[i]!.classList.toggle('active', SECTIONS[i]!.id === this.section)
    }

    if (this.section === 'plants') {
      for (const typeId of PLANT_TYPE_IDS) this.list.appendChild(this.plantRow(typeId))
      return
    }

    if (this.section === 'network') {
      this.list.appendChild(el('div', 'build-group-title', t('ui.lines')))
      for (const kv of VOLTAGE_LEVELS) this.list.appendChild(this.lineRow(kv))
      this.list.appendChild(el('div', 'build-group-title', t('ui.substations')))
      for (const kv of VOLTAGE_LEVELS) this.list.appendChild(this.substationRow(kv))
      return
    }

    this.list.appendChild(el('div', 'build-group-title', t('ui.heatMains')))
    for (const dn of PIPE_SIZES) this.list.appendChild(this.pipeRow(dn))
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

    // Heat-only plant is rated in thermal megawatts, and saying so matters: a hundred thermal
    // megawatts of boiler and a hundred electrical megawatts of gas turbine differ by a factor
    // of six in price, and a unit label is the only thing that stops that reading as a bargain.
    const rating = type.heatOnly ? formatMwth(capacity) : formatMw(capacity)
    const heatSide = type.chp ? ` + ${formatMwth(type.chp.heatCapacityMwth.value)}` : ''
    main.appendChild(
      el('div', 'build-meta', `${rating}${heatSide} · ${formatMoney(capex)} · ${months} ${t('ui.months')}`),
    )

    const year = this.world.date.year

    // Where this technology's cost is going, in real terms, over the next decade.
    //
    // Shown because a capital decision in this game is a thirty-year commitment and the price on
    // the row above is only today's. A player who cannot see that photovoltaics are falling by
    // the year while a reactor building is getting dearer is being asked to make the central
    // decision of the game blind — and *that* is the information the whole milestone exists to
    // produce. Real terms, not nominal: nominal would show inflation carrying everything upward
    // together, which is true and tells nobody anything.
    const s = type.capexPerKw
    const trend = realCapexFactor(typeId, year + 10, s.sourceYear) / realCapexFactor(typeId, year, s.sourceYear) - 1
    if (Math.abs(trend) > 0.01) {
      const arrow = trend < 0 ? '↓' : '↑'
      const line = el('div', `build-trend ${trend < 0 ? 'good' : 'bad'}`)
      line.textContent = `${arrow} ${Math.abs(trend * 100).toFixed(0)}% ${t('ui.perDecadeReal')}`
      main.appendChild(line)
    }

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

  /**
   * A switching station on its own, which is the piece that was missing.
   *
   * Without it a line could only join nodes the scenario had already placed, so the player could
   * wire up what they were given and nothing else — no junction, no way to split a long corridor,
   * no hub of their own.
   */
  private substationRow(kv: VoltageLevel): HTMLDivElement {
    const type = LINE_TYPES[kv]
    const row = el('div', 'build-row')
    const selected = this.selection?.kind === 'substation' && this.selection.kv === kv
    row.classList.toggle('selected', selected)

    const swatch = el('span', 'build-swatch')
    swatch.style.background = '#7fd4ff'
    row.appendChild(swatch)

    const main = el('div', 'build-main')
    main.appendChild(el('div', 'build-name', t('ui.substationAt', { kv })))
    main.appendChild(
      el(
        'div',
        'build-meta',
        `${formatMoney(type.substationCapex.value)} · ${type.substationBuildMonths.value} ${t('ui.months')}`,
      ),
    )
    // What the price actually buys, which used to be nothing at all: three voltages, three prices,
    // and the same dot on the map with anything allowed to hang off it. The busbar rating is the
    // number that decides between them, so it belongs next to the price rather than three clicks
    // away in the station's own panel.
    main.appendChild(
      el(
        'div',
        'build-meta',
        `${t('ui.stationBays', { kv })} ${type.substationBays.value} · ${formatMoney(
          type.substationFixedOpexPerYear.value,
        )}/${t('ui.year')}`,
      ),
    )
    main.appendChild(el('div', 'build-note', t('ui.substationNote')))
    row.appendChild(main)

    row.addEventListener('click', () => {
      this.select(selected ? null : { kind: 'substation', kv })
    })
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
    // What this voltage is *for*. A layman has no way to know that the answer is a trade of
    // capital against losses, and the game never said so: the build menu listed three voltages
    // and left the player to guess. The rule of thumb here is the real one — losses fall with
    // the square of the voltage, so distance is what decides, and the number beside it is what
    // this level would actually lose carrying half its rating a hundred kilometres.
    const lossAtHalfLoad = lineLossMw(type.capacityMw.value / 2, type.resistanceOhmPerKm.value, 100, kv)
    main.appendChild(
      el('div', 'build-note', `${t(`line.use.${kv}`)} · ${t('ui.lossPer100km', { mw: lossAtHalfLoad.toFixed(0) })}`),
    )

    row.appendChild(main)

    row.addEventListener('click', () => {
      this.select(selected ? null : { kind: 'line', kv, circuits: 1 })
    })
    return row
  }

  /**
   * A heat main. The cost per kilometre is the headline here rather than the capacity, because
   * that is the number that decides the answer: at one to two million euros a kilometre plus a
   * standing heat loss for the life of the pipe, the question is never which size to use but
   * whether the plant should be somewhere nearer instead.
   */
  private pipeRow(dn: PipeSize): HTMLDivElement {
    const type = HEAT_PIPE_TYPES[dn]
    const row = el('div', 'build-row')
    const selected = this.selection?.kind === 'pipe' && this.selection.dn === dn
    row.classList.toggle('selected', selected)

    const swatch = el('span', 'build-swatch')
    swatch.style.background = '#e8802a'
    swatch.style.height = dn === 700 ? '5px' : dn === 400 ? '4px' : '3px'
    row.appendChild(swatch)

    const main = el('div', 'build-main')
    main.appendChild(el('div', 'build-name', t(type.nameKey)))
    main.appendChild(
      el(
        'div',
        'build-meta',
        `${formatMwth(type.capacityMwth.value)} · ${formatMoney(type.capexPerKm.value)}/km · ${t('ui.lossPerKm', {
          mw: type.standingLossMwPerKm.value.toFixed(2),
        })}`,
      ),
    )
    row.appendChild(main)

    row.addEventListener('click', () => {
      this.select(selected ? null : { kind: 'pipe', dn, pipes: 1 })
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
  heat: '#e8802a',
}
