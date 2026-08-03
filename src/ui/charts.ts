/**
 * Charts.
 *
 * Hand-rolled on a 2D canvas rather than pulled from a library. The requirements here are
 * narrow — a few hundred points, redrawn once a tick, in a fixed style — and a charting
 * library would be far more code than the two functions below.
 */

import type { TickSnapshot } from '@sim/world'

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

const CATEGORY_COLOURS: Record<string, string> = {
  nuclear: '#b455c8',
  hydro: '#3f9fd0',
  thermal: '#c86a3a',
  wind: '#63c8a8',
  solar: '#e0c04a',
  storage: '#9aa3b0',
}

/** Draw order, bottom to top. Baseload at the bottom reads the way a dispatch stack should. */
const STACK_ORDER = ['nuclear', 'hydro', 'thermal', 'wind', 'solar', 'storage']

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
    for (const c of STACK_ORDER) total += s.mixMw[c] ?? 0
    max = Math.max(max, total)
  }
  max = Math.max(1, max * 1.05)

  const x = (i: number) => (i / (history.length - 1)) * w
  const running = new Array<number>(history.length).fill(0)

  for (const category of STACK_ORDER) {
    ctx.fillStyle = CATEGORY_COLOURS[category] ?? '#888'
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
