/**
 * The whole run, on four charts.
 *
 * Every other chart in this game shows the last ten days. That is the right window for *operating*
 * a system — the load curve, the clearing price, what is running this afternoon — and it is the
 * wrong window for every decision the player actually makes, all of which are about decades.
 *
 * A player thirty years in had no way to see the shape of what they did: whether emissions fell or
 * merely stopped rising, whether the fleet got cleaner or just smaller, whether the tariff drifted
 * upwards while they were looking somewhere else, or which decade the reliability went wrong in.
 * Without that a run ends knowing whether it was won and almost nothing about why — which is a
 * particularly bad thing to be missing from a game whose whole subject is long-lived decisions.
 *
 * ## What is on each chart, and why those four
 *
 * **Emissions, with carbon intensity over the top.** The two are not the same story and putting
 * them on one chart is the point: emissions falling while intensity stays flat means the player
 * sold less power, not that they cleaned anything up.
 *
 * **The mix, as shares.** A fleet that halved its output and kept its proportions has done
 * something very different from one that decarbonised, and an absolute stack makes those look
 * identical.
 *
 * **Reliability.** The one objective a run is most often lost on, and the one whose failure is
 * invisible hour to hour — a tenth of a percent is four hours a year.
 *
 * **Money and the tariff.** Cash is the number the player watches; the tariff is the number that
 * decides whether households leave. They belong together because raising one raises the other.
 */

import { formatMoney, t } from '@i18n/index'
import type { World } from '@sim/world'
import { turningPoint, type YearRecord } from '@sim/economy/yearbook'
import { drawYearBars, drawYearMix, mixLegend } from './charts'

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

export interface HistoryPanelCallbacks {
  onOpen?: () => void
}

export class HistoryPanel {
  private readonly root: HTMLDivElement
  private readonly body: HTMLDivElement
  private readonly toggle: HTMLButtonElement
  private readonly canvases: HTMLCanvasElement[] = []
  private readonly captions: HTMLDivElement[] = []
  private open = false
  private lastYears = -1

  constructor(
    parent: HTMLElement,
    private readonly world: World,
    private readonly callbacks: HistoryPanelCallbacks,
  ) {
    this.toggle = el('button', undefined, t('ui.history'))
    this.toggle.id = 'history-toggle'
    this.toggle.addEventListener('click', () => this.setOpen(!this.open))
    parent.appendChild(this.toggle)

    this.root = el('div', 'panel')
    this.root.id = 'history-panel'
    const header = el('div', 'build-header')
    header.appendChild(el('h3', undefined, t('ui.history')))
    const close = el('button', undefined, t('ui.close'))
    close.addEventListener('click', () => this.setOpen(false))
    header.appendChild(close)
    this.root.appendChild(header)

    this.body = el('div')
    this.root.appendChild(this.body)

    for (const key of ['ui.histEmissions', 'ui.histMix', 'ui.histReliability', 'ui.histMoney']) {
      const block = el('div', 'chart-block')
      block.appendChild(el('h3', undefined, t(key)))
      const canvas = el('canvas')
      canvas.width = 316
      canvas.height = 96
      block.appendChild(canvas)
      const caption = el('div', 'hist-caption')
      block.appendChild(caption)
      // The legend belongs under the chart it explains, not at the foot of the panel where it was:
      // three charts down from the mix, below the fold, describing bands the reader has stopped
      // looking at.
      if (key === 'ui.histMix') block.appendChild(mixLegend(t))
      this.body.appendChild(block)
      this.canvases.push(canvas)
      this.captions.push(caption)
    }

    parent.appendChild(this.root)
  }

  setOpen(open: boolean): void {
    this.open = open
    this.root.classList.toggle('visible', open)
    this.toggle.classList.toggle('active', open)
    if (open) {
      this.callbacks.onOpen?.()
      this.lastYears = -1
      this.render()
    }
  }

  isOpen(): boolean {
    return this.open
  }

  render(): void {
    if (!this.open) return
    // A year at a time is the only rate at which any of this changes, so the panel redraws a few
    // dozen times over a whole run rather than ten times a second.
    const years = this.world.yearbook
    if (years.length === this.lastYears) return
    this.lastYears = years.length

    if (years.length === 0) {
      for (const caption of this.captions) caption.textContent = t('ui.histNothingYet')
      return
    }

    drawYearBars(
      this.canvases[0]!,
      years,
      {
        of: (y) => y.co2Tonnes / 1e6,
        colour: '#c86a3a',
        label: (max) => t('ui.histMtCo2', { n: max.toFixed(1) }),
      },
      { of: (y) => y.carbonIntensity, colour: '#e2483d' },
    )
    this.captions[0]!.textContent = this.describe(years, (y) => y.carbonIntensity, 'ui.histIntensity', (v) =>
      `${v.toFixed(2)} t/MWh`,
    )

    drawYearMix(this.canvases[1]!, years)
    this.captions[1]!.textContent = t('ui.histMixCaption')

    drawYearBars(this.canvases[2]!, years, {
      of: (y) => y.unservedShare * 100,
      colour: '#e2483d',
      label: (max) => `${max.toFixed(2)}%`,
    })
    this.captions[2]!.textContent = this.describe(years, (y) => y.unservedShare * 100, 'ui.histUnserved', (v) =>
      `${v.toFixed(3)}%`,
    )

    drawYearBars(
      this.canvases[3]!,
      years,
      {
        of: (y) => Math.max(0, y.cash) / 1e6,
        colour: '#5fc27e',
        label: (max) => formatMoney(max * 1e6),
      },
      { of: (y) => y.tariffPerMwh, colour: '#e0c04a' },
    )
    this.captions[3]!.textContent = this.describe(years, (y) => y.tariffPerMwh, 'ui.histTariff', (v) =>
      `€${v.toFixed(0)}/MWh`,
    )
  }

  /**
   * A sentence under the chart: where the series started, where it is now, and where it turned.
   *
   * The turning point is the part worth having. A shape tells the player *that* something changed;
   * naming the year tells them where to go looking for what they did, and the news archive is
   * indexed by year. Omitted when the series only ever went one way, because a turning point on a
   * monotone series is noise dressed as insight.
   */
  private describe(
    years: YearRecord[],
    of: (y: YearRecord) => number,
    key: string,
    format: (value: number) => string,
  ): string {
    const first = of(years[0]!)
    const last = of(years[years.length - 1]!)
    const turned = turningPoint(years, of)
    const base = t(key, { from: format(first), to: format(last) })
    return turned === null ? base : `${base} · ${t('ui.histTurned', { year: turned })}`
  }
}
