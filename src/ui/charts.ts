/**
 * Charts.
 *
 * Hand-rolled on a 2D canvas rather than pulled from a library. The requirements here are
 * narrow — a few hundred points, redrawn once a tick, in a fixed style — and a charting
 * library would be far more code than the two functions below.
 */

import { MIX_BANDS } from '@content/plantTypes'
import type { TickSnapshot } from '@sim/world'
import type { YearRecord } from '@sim/economy/yearbook'

export interface ChartTheme {
  background: string
  grid: string
  text: string
  font: string
}

export const THEME: ChartTheme = {
  background: 'rgba(255,255,255,0.02)',
  grid: 'rgba(255,255,255,0.08)',
  text: 'rgba(226,234,242,0.75)',
  font: '10px system-ui, sans-serif',
}

/**
 * One colour per band of the mix.
 *
 * The thermal fuels are separated rather than sharing one brown, because they are the whole of the
 * decision the opening scenario is about: lignite, hard coal and gas have very different carbon and
 * very different marginal cost, and a single band could not tell the player whether the lignite had
 * come off or merely been turned down. They keep a warm family so the stack still reads as "burning
 * something", and darken with carbon intensity — lignite is the darkest thing on the chart, which
 * is the one association worth encoding.
 */
const BAND_COLOURS: Record<string, string> = {
  nuclear: '#b455c8',
  lignite: '#6b3a24',
  coal: '#8f4a28',
  biomass: '#7f8f3a',
  gas: '#d98a3c',
  hydro: '#3f9fd0',
  wind: '#63c8a8',
  solar: '#e0c04a',
  storage: '#9aa3b0',
}

function setup(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = THEME.background
  ctx.fillRect(0, 0, w, h)
}

function drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number, rows = 3): void {
  ctx.strokeStyle = THEME.grid
  ctx.lineWidth = 1
  for (let i = 1; i < rows; i++) {
    const y = Math.round((h * i) / rows) + 0.5
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(w, y)
    ctx.stroke()
  }
}

/**
 * Demand against generation, with unserved energy marked. The gap between the two lines is
 * the losses, which is the clearest way to show a quantity that is otherwise invisible.
 */
export function drawLoadCurve(canvas: HTMLCanvasElement, history: TickSnapshot[]): void {
  const ctx = canvas.getContext('2d')
  if (!ctx || history.length < 2) return
  const w = canvas.width
  const h = canvas.height
  setup(ctx, w, h)
  drawGrid(ctx, w, h)

  let max = 0
  for (const s of history) max = Math.max(max, s.demandMw, s.generationMw)
  max = Math.max(1, max * 1.25)

  const x = (i: number) => (i / (history.length - 1)) * w
  const y = (v: number) => h - (v / max) * h

  // Unserved energy as red columns behind everything else.
  ctx.fillStyle = 'rgba(226,72,61,0.55)'
  for (let i = 0; i < history.length; i++) {
    const s = history[i]!
    if (s.unservedMw <= 0.01) continue
    const bw = Math.max(1, w / history.length)
    ctx.fillRect(x(i) - bw / 2, 0, bw, h)
  }

  const line = (get: (s: TickSnapshot) => number, colour: string, width: number) => {
    ctx.strokeStyle = colour
    ctx.lineWidth = width
    ctx.beginPath()
    history.forEach((s, i) => (i === 0 ? ctx.moveTo(x(i), y(get(s))) : ctx.lineTo(x(i), y(get(s)))))
    ctx.stroke()
  }

  line((s) => s.generationMw, '#e8b23a', 1.5)
  line((s) => s.demandMw, '#7fd4ff', 1.8)

  ctx.fillStyle = THEME.text
  ctx.font = THEME.font
  ctx.fillText(`${Math.round(max)} MW`, 4, 11)
}

/** Stacked generation mix over time. */
export function drawMix(canvas: HTMLCanvasElement, history: TickSnapshot[]): void {
  const ctx = canvas.getContext('2d')
  if (!ctx || history.length < 2) return
  const w = canvas.width
  const h = canvas.height
  setup(ctx, w, h)

  let max = 0
  for (const s of history) {
    let total = 0
    for (const c of MIX_BANDS) total += s.mixMw[c] ?? 0
    max = Math.max(max, total)
  }
  max = Math.max(1, max * 1.05)

  const x = (i: number) => (i / (history.length - 1)) * w
  const running = new Array<number>(history.length).fill(0)

  for (const category of MIX_BANDS) {
    ctx.fillStyle = BAND_COLOURS[category] ?? '#888'
    ctx.beginPath()
    // Up along the top of this band...
    for (let i = 0; i < history.length; i++) {
      const v = running[i]! + (history[i]!.mixMw[category] ?? 0)
      const py = h - (v / max) * h
      if (i === 0) ctx.moveTo(x(i), py)
      else ctx.lineTo(x(i), py)
    }
    // ...and back along the bottom.
    for (let i = history.length - 1; i >= 0; i--) {
      ctx.lineTo(x(i), h - (running[i]! / max) * h)
    }
    ctx.closePath()
    ctx.fill()

    for (let i = 0; i < history.length; i++) {
      running[i] = running[i]! + (history[i]!.mixMw[category] ?? 0)
    }
  }

  ctx.fillStyle = THEME.text
  ctx.font = THEME.font
  ctx.fillText(`${Math.round(max)} MW`, 4, 11)
}

/** Electricity price, on a log-ish scale so a scarcity spike does not flatten everything else. */
export function drawPrice(canvas: HTMLCanvasElement, history: TickSnapshot[]): void {
  const ctx = canvas.getContext('2d')
  if (!ctx || history.length < 2) return
  const w = canvas.width
  const h = canvas.height
  setup(ctx, w, h)
  drawGrid(ctx, w, h)

  const squash = (v: number) => Math.log10(1 + Math.max(0, v))
  let max = 0
  for (const s of history) max = Math.max(max, squash(s.pricePerMwh))
  // Generous headroom so a normal price does not sit against the top edge.
  max = Math.max(squash(200), max * 1.25)

  const x = (i: number) => (i / (history.length - 1)) * w
  const y = (v: number) => h - (squash(v) / max) * h

  ctx.strokeStyle = '#63c8a8'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  history.forEach((s, i) => (i === 0 ? ctx.moveTo(x(i), y(s.pricePerMwh)) : ctx.lineTo(x(i), y(s.pricePerMwh))))
  ctx.stroke()

  const last = history[history.length - 1]!
  ctx.fillStyle = THEME.text
  ctx.font = THEME.font
  ctx.fillText(`€${last.pricePerMwh.toFixed(0)}/MWh`, 4, h - 4)
}

// ---------------------------------------------------------------------------
// The long run
// ---------------------------------------------------------------------------
//
// Everything above draws hours. These draw *years*, and the difference is not
// only the axis. A ten-day chart is an instrument you read while operating; a
// thirty-year chart is an argument about a strategy, and the things that make
// it readable are different — the bars are discrete because a year is, the
// axis is labelled because "which decade" is the question being asked, and a
// second series is overlaid rather than given its own panel because the whole
// point is the relationship between the two.

/** Labels down the left and along the bottom, in the space a small chart can spare. */
function drawYearAxis(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  years: YearRecord[],
  topLabel: string,
): void {
  ctx.fillStyle = THEME.text
  ctx.font = THEME.font
  ctx.fillText(topLabel, 4, 11)
  if (years.length === 0) return
  const first = String(years[0]!.year)
  const last = String(years[years.length - 1]!.year)
  ctx.fillText(first, 2, h - 2)
  ctx.fillText(last, w - ctx.measureText(last).width - 2, h - 2)
}

/**
 * One bar per year, with an optional line over the top on its own scale.
 *
 * The overlay is the reason this exists rather than two charts. Emissions falling while carbon
 * *intensity* stays flat is a different story from both falling, and it is a story you can only
 * see if the two are drawn on the same years.
 */
export function drawYearBars(
  canvas: HTMLCanvasElement,
  years: YearRecord[],
  bar: { of: (y: YearRecord) => number; colour: string; label: (max: number) => string },
  line?: { of: (y: YearRecord) => number; colour: string },
): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const w = canvas.width
  const h = canvas.height
  setup(ctx, w, h)
  if (years.length === 0) return
  drawGrid(ctx, w, h)

  const pad = 12
  const plot = h - pad
  const max = Math.max(1e-9, ...years.map(bar.of)) * 1.1
  const slot = w / years.length
  const width = Math.max(1, slot - 1)

  ctx.fillStyle = bar.colour
  for (let i = 0; i < years.length; i++) {
    const value = Math.max(0, bar.of(years[i]!))
    const barHeight = (value / max) * (plot - 2)
    ctx.fillRect(i * slot, plot - barHeight, width, barHeight)
  }

  if (line) {
    const lineMax = Math.max(1e-9, ...years.map(line.of)) * 1.1
    ctx.strokeStyle = line.colour
    ctx.lineWidth = 1.5
    ctx.beginPath()
    for (let i = 0; i < years.length; i++) {
      const py = plot - (Math.max(0, line.of(years[i]!)) / lineMax) * (plot - 2)
      const px = i * slot + width / 2
      if (i === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }
    ctx.stroke()
  }

  drawYearAxis(ctx, w, h, years, bar.label(max / 1.1))
}

/**
 * The generation mix, year by year, as a share of each year's total.
 *
 * Shares rather than absolute energy, deliberately. A fleet that halves its output and keeps the
 * same proportions has done something very different from one that decarbonised, and an absolute
 * stack makes the two look identical while a share stack makes them look nothing alike. The
 * absolute figure is one chart up, where the emissions are.
 */
export function drawYearMix(canvas: HTMLCanvasElement, years: YearRecord[]): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const w = canvas.width
  const h = canvas.height
  setup(ctx, w, h)
  if (years.length === 0) return

  const pad = 12
  const plot = h - pad
  const slot = w / years.length
  const width = Math.max(1, slot - 1)

  for (let i = 0; i < years.length; i++) {
    const year = years[i]!
    let total = 0
    for (const c of MIX_BANDS) total += year.mixMwh[c] ?? 0
    if (total <= 0) continue

    let y = plot
    for (const category of MIX_BANDS) {
      const share = (year.mixMwh[category] ?? 0) / total
      if (share <= 0) continue
      const band = share * (plot - 2)
      ctx.fillStyle = BAND_COLOURS[category] ?? '#888'
      ctx.fillRect(i * slot, y - band, width, band)
      y -= band
    }
  }

  drawYearAxis(ctx, w, h, years, '100%')
}

/**
 * The mix legend, built from the same table the chart draws from.
 *
 * Two panels show a mix chart and both used to carry their own hand-copied list of colours, which
 * is how a legend ends up describing a chart that has moved on without it — as this one had the
 * moment the thermal band was split by fuel. Now there is one source, and a band that is added
 * appears in both legends or in neither.
 */
export function mixLegend(t: (key: string) => string): HTMLDivElement {
  const legend = document.createElement('div')
  legend.className = 'legend'
  for (const band of MIX_BANDS) {
    const span = document.createElement('span')
    span.textContent = t(`category.${band}`)
    span.style.color = BAND_COLOURS[band] ?? '#888'
    legend.appendChild(span)
  }
  return legend
}
