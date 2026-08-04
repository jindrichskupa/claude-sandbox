/**
 * The HTML overlay: headline numbers, charts, and the inspector.
 *
 * All of this is plain DOM rather than in-canvas drawing. An energy tycoon is half
 * dashboard, and HTML gives text layout, scrolling and accessibility for nothing.
 *
 * Every visible string goes through `t()`. There are no exceptions, which is the only way
 * a localisation layer stays honest.
 */

import { formatDate, formatMoney, formatMw, formatPct, t } from '@i18n/index'
import { PLANT_TYPES } from '@content/plantTypes'
import { LINE_TYPES } from '@content/lineTypes'
import type { World } from '@sim/world'
import { LIFECYCLE_KEYS, LifecyclePhase, isDispatchable } from '@sim/assets/types'
import { ageYears } from '@sim/assets/aging'
import { Layer, LAYER_KEYS, Op, Param, PARAM_KEYS, type Explanation } from '@sim/params/types'
import { drawLoadCurve, drawMix, drawPrice } from './charts'
import { nodeLabel } from '@render/mapView'
import { quoteRefurbishment, refurbishmentGains } from '@sim/build/commands'
import { BuildPanel, type BuildSelection } from './buildPanel'
import { cycleLifeUsed, energyCapacityMwh, isStorage, ratedEnergyMwh } from '@sim/dispatch/storage'
import { MONTHS_PER_YEAR, TICKS_PER_YEAR } from '@sim/core/time'

const TICKS_PER_MONTH = TICKS_PER_YEAR / MONTHS_PER_YEAR

export type Speed = 0 | 1 | 3 | 10

export interface HudCallbacks {
  onSetSpeed: (speed: Speed) => void
  onSelectBuild: (selection: BuildSelection) => void
  onRetire: (plantId: string) => void
  onMothball: (plantId: string, mothball: boolean) => void
  onRefurbish: (plantId: string) => void
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

function stat(label: string): { root: HTMLDivElement; value: HTMLDivElement } {
  const root = el('div', 'stat')
  root.appendChild(el('div', 'stat-label', label))
  const value = el('div', 'stat-value', '—')
  root.appendChild(value)
  return { root, value }
}

export class Hud {
  private readonly stats: Record<string, HTMLDivElement> = {}
  private readonly clock: HTMLDivElement
  private readonly speedButtons = new Map<Speed, HTMLButtonElement>()
  private readonly inspector: HTMLDivElement
  private readonly banner: HTMLDivElement
  private readonly loadCanvas: HTMLCanvasElement
  private readonly mixCanvas: HTMLCanvasElement
  private readonly priceCanvas: HTMLCanvasElement
  readonly buildPanel: BuildPanel

  private selectedNodeId: string | null = null
  private readonly hint: HTMLDivElement

  constructor(
    private readonly root: HTMLElement,
    private readonly world: World,
    private readonly callbacks: HudCallbacks,
  ) {
    // --- Top bar ---
    const topbar = el('div', 'panel')
    topbar.id = 'topbar'

    for (const [key, label] of [
      ['cash', 'ui.cash'],
      ['demand', 'ui.demand'],
      ['generation', 'ui.generation'],
      ['losses', 'ui.losses'],
      ['price', 'ui.price'],
      ['temperature', 'ui.temperature'],
      ['monthProfit', 'ui.monthProfit'],
      ['opinion', 'ui.opinion'],
    ] as const) {
      const s = stat(t(label))
      this.stats[key] = s.value
      topbar.appendChild(s.root)
    }

    topbar.appendChild(el('div', 'spacer'))
    this.clock = el('div')
    this.clock.id = 'clock'
    topbar.appendChild(this.clock)

    const speeds = el('div', 'speed-controls')
    for (const speed of [0, 1, 3, 10] as Speed[]) {
      const button = el('button', undefined, speed === 0 ? t('ui.pause') : `${speed}×`)
      button.addEventListener('click', () => this.callbacks.onSetSpeed(speed))
      speeds.appendChild(button)
      this.speedButtons.set(speed, button)
    }
    topbar.appendChild(speeds)
    root.appendChild(topbar)

    // --- Charts ---
    const charts = el('div', 'panel')
    charts.id = 'charts'
    const makeChart = (titleKey: string): HTMLCanvasElement => {
      const block = el('div', 'chart-block')
      block.appendChild(el('h3', undefined, t(titleKey)))
      const canvas = el('canvas')
      canvas.width = 276
      canvas.height = 88
      block.appendChild(canvas)
      charts.appendChild(block)
      return canvas
    }
    this.loadCanvas = makeChart('ui.loadCurve')
    this.priceCanvas = makeChart('ui.price')
    this.mixCanvas = makeChart('ui.mix')

    const legend = el('div', 'legend')
    for (const [category, colour] of [
      ['nuclear', '#b455c8'],
      ['hydro', '#3f9fd0'],
      ['thermal', '#c86a3a'],
      ['wind', '#63c8a8'],
      ['solar', '#e0c04a'],
      ['storage', '#9aa3b0'],
    ] as const) {
      const span = el('span', undefined, t(`category.${category}`))
      span.style.color = colour
      legend.appendChild(span)
    }
    charts.appendChild(legend)
    root.appendChild(charts)

    // --- Inspector ---
    this.inspector = el('div', 'panel')
    this.inspector.id = 'inspector'
    root.appendChild(this.inspector)

    // --- Blackout banner ---
    this.banner = el('div', 'panel')
    this.banner.id = 'banner'
    root.appendChild(this.banner)

    // --- Line legend ---
    const lineLegend = el('div', 'panel')
    lineLegend.id = 'legend-lines'
    lineLegend.appendChild(el('b', undefined, t('ui.lines')))
    for (const [colour, label] of [
      ['#5c7a8a', '0%'],
      ['#5fc27e', '50%'],
      ['#e8b23a', '90%'],
      ['#e2483d', t('ui.overloaded')],
    ] as const) {
      const row = el('div')
      const swatch = el('span', 'swatch')
      swatch.style.background = colour
      row.appendChild(swatch)
      row.appendChild(document.createTextNode(label))
      lineLegend.appendChild(row)
    }
    root.appendChild(lineLegend)

    // --- Build panel and its hint line ---
    this.buildPanel = new BuildPanel(root, world, {
      onSelect: (s) => this.callbacks.onSelectBuild(s),
      onOpen: () => {
        this.selectedNodeId = null
        this.renderInspector()
      },
    })

    this.hint = el('div', 'panel')
    this.hint.id = 'hint'
    root.appendChild(this.hint)
  }

  /** Show the one-line instruction that goes with the current placement mode. */
  setHint(text: string | null): void {
    this.hint.textContent = text ?? ''
    this.hint.classList.toggle('visible', text !== null)
  }

  setSpeed(speed: Speed): void {
    for (const [value, button] of this.speedButtons) {
      button.classList.toggle('active', value === speed)
    }
  }

  selectNode(nodeId: string | null): void {
    // The inspector and the build panel occupy the same corner, so they take turns rather
    // than stacking on top of one another.
    if (nodeId) this.buildPanel.setOpen(false)
    this.selectedNodeId = nodeId
    this.renderInspector()
  }

  /** Refresh everything. Called once per simulation tick, not once per frame. */
  update(): void {
    const world = this.world
    const snap = world.recentHistory(1)[0]
    const dispatch = world.lastDispatch

    this.clock.textContent = formatDate(world.date)

    this.stats.cash!.textContent = formatMoney(world.finances.cash)
    this.stats.cash!.className = `stat-value ${world.finances.cash < 0 ? 'bad' : ''}`

    if (snap && dispatch) {
      this.stats.demand!.textContent = formatMw(snap.demandMw)
      this.stats.generation!.textContent = formatMw(snap.generationMw)
      this.stats.losses!.textContent = `${formatMw(snap.lossMw)} (${formatPct(
        snap.demandMw > 0 ? snap.lossMw / snap.demandMw : 0,
      )})`
      this.stats.price!.textContent = `€${snap.pricePerMwh.toFixed(0)}`
      this.stats.price!.className = `stat-value ${snap.pricePerMwh > 200 ? 'warn' : ''}`
      this.stats.temperature!.textContent = `${snap.weather.tempC.toFixed(1)}°C`

      const unserved = snap.unservedMw
      this.banner.classList.toggle('visible', unserved > 0.01)
      if (unserved > 0.01) {
        this.banner.textContent = `${t('ui.blackout')}: ${formatMw(unserved)}`
      }
    }

    const profit = world.lastMonthProfit()
    this.stats.monthProfit!.textContent = formatMoney(profit)
    this.stats.monthProfit!.className = `stat-value ${profit >= 0 ? 'good' : 'bad'}`

    const opinion = world.state.publicOpinion
    this.stats.opinion!.textContent = formatPct(opinion)
    this.stats.opinion!.className = `stat-value ${opinion < 0.3 ? 'bad' : opinion > 0.6 ? 'good' : 'warn'}`

    this.buildPanel.render()

    const history = world.recentHistory(240)
    if (history.length > 1) {
      drawLoadCurve(this.loadCanvas, history)
      drawPrice(this.priceCanvas, history)
      drawMix(this.mixCanvas, history)
    }

    this.renderInspector()
  }

  /**
   * The inspector, including the modifier chain. This is the panel that turns the parameter
   * pipeline from an implementation detail into something the player can learn from.
   */
  private renderInspector(): void {
    const nodeId = this.selectedNodeId
    if (!nodeId) {
      this.inspector.classList.remove('visible')
      return
    }
    const node = this.world.network.getNode(nodeId)
    if (!node) {
      this.inspector.classList.remove('visible')
      return
    }

    this.inspector.classList.add('visible')
    this.inspector.replaceChildren()

    const close = el('button', 'close-btn', t('ui.close'))
    close.addEventListener('click', () => this.selectNode(null))
    this.inspector.appendChild(close)

    this.inspector.appendChild(el('h2', undefined, nodeLabel(node) ?? node.id))
    const dispatch = this.world.lastDispatch

    const city = this.world.cities.find((c) => c.nodeId === nodeId)
    const plants = this.world.plants.filter((p) => p.nodeId === nodeId)
    const lines = this.world.network.edgesOf(nodeId)

    this.inspector.appendChild(
      el('div', 'subtitle', city ? t('ui.cities') : plants.length ? t('ui.plants') : t('ui.lines')),
    )

    if (city) {
      const served = dispatch?.servedMw.get(city.id) ?? 0
      const unserved = dispatch?.unservedMw.get(city.id) ?? 0
      const block = el('div', 'asset')
      block.appendChild(this.kv(t('ui.demand'), formatMw(served + unserved)))
      if (unserved > 0.01) block.appendChild(this.kv(t('ui.unserved'), formatMw(unserved)))
      const price = dispatch?.nodalPrice.get(nodeId) ?? 0
      block.appendChild(this.kv(t('ui.price'), `€${price.toFixed(1)}/MWh`))
      block.appendChild(this.explainBlock(this.world.params.explain(city.id, Param.DemandMw), 'MW'))
      this.inspector.appendChild(block)
    }

    for (const plant of plants) {
      const type = PLANT_TYPES[plant.typeId]
      const block = el('div', 'asset')

      const head = el('div', 'asset-head')
      head.appendChild(el('span', 'asset-name', plant.id.replace(/^p_/, '')))
      head.appendChild(el('span', 'asset-type', t(type.nameKey)))
      block.appendChild(head)

      const capacity = this.world.params.get(plant.id, Param.CapacityMw)
      const output = plant.outputMw

      const bar = el('div', 'bar')
      const fill = el('div')
      fill.style.width = `${Math.min(100, (output / Math.max(1, capacity)) * 100)}%`
      fill.style.background = output > 0 ? '#5fc27e' : '#6b7683'
      bar.appendChild(fill)
      block.appendChild(bar)

      block.appendChild(this.kv(t('ui.output'), `${formatMw(output)} / ${formatMw(capacity)}`))
      block.appendChild(
        this.kv(t('ui.age'), `${ageYears(plant, this.world.tick).toFixed(0)} ${t('ui.years')} / ${type.designLifeYears.value}`),
      )
      block.appendChild(this.kv(t('ui.condition'), formatPct(plant.conditionPct)))
      if (plant.refurbishments > 0) {
        block.appendChild(
          this.kv(t('ui.refurbished'), t('ui.refurbishedTimes', { times: plant.refurbishments })),
        )
      }

      // A unit can be nominally "operating" and still not be generating, because it has
      // tripped. Saying "Operating" in that case would be true and useless.
      if (!plant.online && plant.phase === LifecyclePhase.Operating) {
        block.appendChild(this.kv('', t('ui.forcedOutage')))
      } else if (!isDispatchable(plant)) {
        block.appendChild(this.kv('', t(LIFECYCLE_KEYS[plant.phase])))
      }

      // Anything with a countdown gets a progress bar, because "under construction" without
      // a date is not information the player can plan around.
      if (
        plant.phase === LifecyclePhase.Building ||
        plant.phase === LifecyclePhase.Decommissioning ||
        plant.phase === LifecyclePhase.Refurbishing
      ) {
        const remaining = Math.max(0, plant.phaseEndsTick - this.world.tick)
        const months = Math.ceil(remaining / TICKS_PER_MONTH)
        block.appendChild(this.kv(t('ui.buildProgress'), t('ui.completesIn', { months })))
      }

      if (isStorage(plant)) {
        const capacityMwh = energyCapacityMwh(plant)
        const socBar = el('div', 'bar')
        const socFill = el('div')
        socFill.style.width = `${Math.min(100, (plant.storageMwh / Math.max(1, capacityMwh)) * 100)}%`
        socFill.style.background = '#7fd4ff'
        socBar.appendChild(socFill)
        block.appendChild(socBar)
        block.appendChild(
          this.kv(t('ui.storage'), `${plant.storageMwh.toFixed(0)} / ${capacityMwh.toFixed(0)} MWh`),
        )

        // Where a store's life is measured in cycles, that is the number that matters, and
        // the faded capacity is the visible consequence of having spent them.
        const used = cycleLifeUsed(plant)
        if (used !== null) {
          block.appendChild(this.kv(t('ui.cycleLife'), `${formatPct(used)} ${t('ui.used')}`))
          const rated = ratedEnergyMwh(plant)
          if (capacityMwh < rated - 0.5) {
            block.appendChild(this.kv(t('ui.capacityFade'), `${formatPct(1 - capacityMwh / rated)}`))
          }
        }
        const plan = this.world.lastStoragePlans.get(plant.id)
        if (plan && plan.mode !== 'idle') {
          block.appendChild(this.kv('', t(plan.mode === 'charging' ? 'ui.charging' : 'ui.discharging')))
        }
      }

      // Two chains worth showing: why the output is limited, and why the fuel bill is what it is.
      block.appendChild(this.explainBlock(this.world.params.explain(plant.id, Param.Availability), '', true))
      block.appendChild(this.explainBlock(this.world.params.explain(plant.id, Param.Efficiency), '', true))

      block.appendChild(this.plantActions(plant))
      this.inspector.appendChild(block)
    }

    if (!city && plants.length === 0 && lines.length > 0) {
      for (const edgeId of lines) {
        const edge = this.world.network.requireEdge(edgeId)
        if (edge.kv === 0) continue
        const capacity = LINE_TYPES[edge.kv].capacityMw.value * edge.circuits
        const flow = Math.abs(dispatch?.lineFlowMw.get(edgeId) ?? 0)
        const block = el('div', 'asset')
        block.appendChild(el('div', 'asset-name', `${edge.kv} kV → ${edge.from === nodeId ? edge.to : edge.from}`))
        const bar = el('div', 'bar')
        const fill = el('div')
        const loading = flow / capacity
        fill.style.width = `${Math.min(100, loading * 100)}%`
        fill.style.background = loading > 0.9 ? '#e2483d' : loading > 0.5 ? '#e8b23a' : '#5fc27e'
        bar.appendChild(fill)
        block.appendChild(bar)
        block.appendChild(this.kv(t('ui.output'), `${formatMw(flow)} / ${formatMw(capacity)}`))
        block.appendChild(this.kv(t('ui.losses'), formatMw(dispatch?.lineLossMw.get(edgeId) ?? 0)))
        this.inspector.appendChild(block)
      }
    }
  }

  /** Retire and mothball, offered only where they actually apply. */
  private plantActions(plant: { id: string; phase: LifecyclePhase }): HTMLDivElement {
    const row = el('div', 'asset-actions')

    // Refurbishment is offered only where it is actually available, and with what it would
    // buy, because "overhaul" without a number is not a decision the player can make.
    const refurbQuote = quoteRefurbishment(this.world, plant.id)
    if (refurbQuote.ok) {
      const gains = refurbishmentGains(this.world, plant.id)
      const refurbish = el('button', undefined, t('ui.refurbish'))
      if (gains) {
        refurbish.title = t('ui.refurbishGains', {
          years: gains.lifeYears.toFixed(0),
          cost: formatMoney(refurbQuote.totalCost),
          months: Math.round(refurbQuote.buildTicks / TICKS_PER_MONTH),
        })
      }
      refurbish.addEventListener('click', () => this.callbacks.onRefurbish(plant.id))
      row.appendChild(refurbish)
    }

    if (plant.phase === LifecyclePhase.Operating) {
      const mothball = el('button', undefined, t('ui.mothball'))
      mothball.addEventListener('click', () => this.callbacks.onMothball(plant.id, true))
      row.appendChild(mothball)
      const retire = el('button', 'danger', t('ui.retire'))
      retire.addEventListener('click', () => this.callbacks.onRetire(plant.id))
      row.appendChild(retire)
    } else if (plant.phase === LifecyclePhase.Mothballed) {
      const back = el('button', undefined, t('ui.reactivate'))
      back.addEventListener('click', () => this.callbacks.onMothball(plant.id, false))
      row.appendChild(back)
      const retire = el('button', 'danger', t('ui.retire'))
      retire.addEventListener('click', () => this.callbacks.onRetire(plant.id))
      row.appendChild(retire)
    }
    return row
  }

  private kv(label: string, value: string): HTMLDivElement {
    const row = el('div', 'kv')
    row.appendChild(el('span', undefined, label))
    const b = el('b', undefined, value)
    row.appendChild(b)
    return row
  }

  /**
   * Render one modifier chain. This is the "why is this number what it is" answer: base
   * value, each contribution with its reason, and the effective result.
   */
  private explainBlock(explanation: Explanation, unit: string, asPercent = false): HTMLDivElement {
    const wrap = el('div', 'why')
    const fmt = (v: number) => (asPercent ? formatPct(v) : `${v.toFixed(1)}${unit ? ` ${unit}` : ''}`)

    wrap.appendChild(el('div', 'why-title', `${t(PARAM_KEYS[explanation.param])} — ${t('ui.why')}`))

    const baseRow = el('div', 'why-step')
    baseRow.appendChild(el('span', 'reason', t('ui.base')))
    baseRow.appendChild(el('span', 'delta', fmt(explanation.baseValue)))
    wrap.appendChild(baseRow)

    for (const step of explanation.steps) {
      const row = el('div', 'why-step')
      const reason = `${t(LAYER_KEYS[step.layer as Layer])}: ${t(step.reasonKey, step.reasonParams)}`
      row.appendChild(el('span', 'reason', reason))

      let delta: string
      let sign: 'pos' | 'neg' | '' = ''
      if (step.op === Op.AddFrac) {
        delta = `${step.value >= 0 ? '+' : ''}${(step.value * 100).toFixed(1)}%`
        sign = step.value >= 0 ? 'pos' : 'neg'
      } else if (step.op === Op.AddAbs) {
        delta = `${step.value >= 0 ? '+' : ''}${step.value.toFixed(1)}`
        sign = step.value >= 0 ? 'pos' : 'neg'
      } else {
        delta = `×${step.value.toFixed(2)}`
        sign = step.value >= 1 ? 'pos' : 'neg'
      }
      row.appendChild(el('span', `delta ${sign}`, delta))
      wrap.appendChild(row)
    }

    const total = el('div', 'why-step total')
    total.appendChild(el('span', 'reason', t('ui.final')))
    total.appendChild(el('span', 'delta', fmt(explanation.finalValue)))
    wrap.appendChild(total)

    return wrap
  }

  /** Remove everything. Used when restarting a scenario. */
  destroy(): void {
    this.root.replaceChildren()
  }
}
