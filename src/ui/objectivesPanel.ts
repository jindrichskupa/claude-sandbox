/**
 * The objectives panel, and the screen that ends the scenario.
 *
 * Two things this panel has to get right, and they pull in opposite directions.
 *
 * The **verdict** is annual. A continuous objective must not fail because of one bad hour, so
 * the simulation judges once a year and the status shown here is that judgement.
 *
 * The **measurement** must be current. A player watching their unserved-energy allowance drain
 * away needs today's figure, not one up to a year old, or the panel is a report rather than an
 * instrument. So every row re-measures its condition on render and shows that number, while the
 * status chip beside it stays the last considered verdict.
 *
 * The gap between the two is deliberate and visible: a row can read "In progress · not yet"
 * with a live number that has just gone the wrong way, which is exactly the warning a player
 * needs before the year closes on them.
 */

import { formatMoney, formatMw, formatPct, t } from '@i18n/index'
import {
  measure,
  type ObjectiveCondition,
  type ObjectiveContext,
  type ObjectiveDef,
} from '@sim/scenario/objectives'
import type { World } from '@sim/world'

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
 * How a condition's numbers read to a human.
 *
 * Each kind has a unit and a sensible precision, and the two boolean kinds have neither — a
 * plant is retired or it is not, and "1 / 1" would be a worse way of saying so than the status
 * chip already does.
 */
function describe(condition: ObjectiveCondition, value: number, target: number): string | null {
  switch (condition.kind) {
    case 'unservedShareBelow':
      // Three decimals because the limit itself is a tenth of a percent; one decimal would
      // round every interesting value to 0.0%.
      return `${(value * 100).toFixed(3)}% / ${(target * 100).toFixed(3)}%`
    case 'noUnservedHeat':
      return value > 0.01 ? t('ui.coldHours', { mwh: value.toFixed(0) }) : t('ui.noneSoFar')
    case 'capacityAtLeast':
      return `${formatMw(value)} / ${formatMw(target)}`
    case 'carbonIntensityBelow':
      return `${value.toFixed(2)} / ${target.toFixed(2)} t/MWh`
    case 'cashAtLeast':
      return `${formatMoney(value)} / ${formatMoney(target)}`
    case 'lowCarbonShareAtLeast':
      return `${formatPct(value)} / ${formatPct(target)}`
    case 'neverBankrupt':
    case 'plantRetired':
      return null
  }
}

/**
 * Whether the condition has anything to say yet.
 *
 * Both ratios are taken over energy sold, and the lifetime ledger they read only fills at the
 * end of a month. Before the first one closes there is genuinely nothing to divide by, and
 * showing "0.00 t/MWh · on track" would be claiming a clean fleet on the strength of no
 * measurement at all — the one reading a panel like this must never give.
 */
function hasReading(condition: ObjectiveCondition, context: ObjectiveContext): boolean {
  if (condition.kind !== 'unservedShareBelow' && condition.kind !== 'carbonIntensityBelow') return true
  return context.recentYear.energySoldMwh > 0
}

export interface ObjectivesPanelCallbacks {
  onOpen?: () => void
  onSave: () => void
  onLoad: () => void
}

export class ObjectivesPanel {
  private readonly root: HTMLDivElement
  private readonly body: HTMLDivElement
  private readonly toggle: HTMLButtonElement
  private readonly gameOver: HTMLDivElement
  private open = false
  /** So the end screen can be dismissed and the player left to look at what they built. */
  private endDismissed = false

  constructor(
    parent: HTMLElement,
    private readonly world: World,
    private readonly callbacks: ObjectivesPanelCallbacks,
  ) {
    this.toggle = el('button', undefined, t('ui.objectives'))
    this.toggle.id = 'objectives-toggle'
    this.toggle.addEventListener('click', () => this.setOpen(!this.open))
    parent.appendChild(this.toggle)

    this.root = el('div', 'panel')
    this.root.id = 'objectives-panel'
    const header = el('div', 'build-header')
    header.appendChild(el('h3', undefined, t('ui.objectives')))
    const close = el('button', undefined, t('ui.close'))
    close.addEventListener('click', () => this.setOpen(false))
    header.appendChild(close)
    this.root.appendChild(header)

    this.body = el('div')
    this.root.appendChild(this.body)

    parent.appendChild(this.root)

    this.gameOver = el('div', 'panel')
    this.gameOver.id = 'game-over'
    parent.appendChild(this.gameOver)
  }

  setOpen(open: boolean): void {
    this.open = open
    this.root.classList.toggle('visible', open)
    this.toggle.classList.toggle('active', open)
    if (open) {
      this.callbacks.onOpen?.()
      this.render()
    }
  }

  isOpen(): boolean {
    return this.open
  }

  /** Called after a load, since the new world may be back in play. */
  reset(): void {
    this.endDismissed = false
  }

  /**
   * Put the verdict back on screen.
   *
   * Dismissing it used to be a one-way door. The clock stops when a run ends, so a player who
   * closed the panel without choosing to carry on was left with a frozen game, dead speed
   * buttons and nothing anywhere saying why — the single worst thing an interface can do, since
   * it is indistinguishable from a crash. Now anything that would have been a dead click brings
   * the verdict back, and the way to keep playing is on it.
   */
  showVerdict(): void {
    this.endDismissed = false
  }

  render(): void {
    this.renderEndScreen()
    if (!this.open) return

    const world = this.world
    const context = world.objectiveContext()
    const statusById = new Map(world.objectives.map((o) => [o.id, o]))
    this.body.replaceChildren()

    const head = el('div', 'obj-head')
    head.appendChild(el('div', 'obj-scenario', t(world.scenario.nameKey)))
    if (world.freePlay) head.appendChild(el('div', 'obj-clock bad', t('ui.freePlay')))
    const yearsLeft = Math.max(0, world.scenario.endYear - context.year)
    head.appendChild(
      el(
        'div',
        'obj-clock',
        `${t('ui.scenarioEnds', { year: world.scenario.endYear })} · ${t('ui.yearsLeft', { years: yearsLeft })}`,
      ),
    )
    this.body.appendChild(head)

    for (const objective of world.scenario.objectives) {
      this.body.appendChild(this.renderRow(objective, statusById.get(objective.id)?.status ?? 'pending'))
    }
  }

  private renderRow(objective: ObjectiveDef, status: 'pending' | 'met' | 'failed'): HTMLDivElement {
    const context = this.world.objectiveContext()
    const measured = measure(objective.condition, context)
    const measurable = hasReading(objective.condition, context)

    const row = el('div', `obj obj-${status}`)

    const top = el('div', 'obj-top')
    top.appendChild(el('span', 'obj-desc', t(objective.descriptionKey)))
    const chipKey =
      status === 'met' ? 'ui.objectiveMet' : status === 'failed' ? 'ui.objectiveFailed' : 'ui.objectivePending'
    top.appendChild(el('span', `obj-chip obj-chip-${status}`, t(chipKey)))
    row.appendChild(top)

    const meta = el('div', 'obj-meta')
    // Whether the *current* reading would pass, which is the part the annual verdict cannot
    // tell them. Suppressed once the objective is decided, where it would only confuse.
    if (status === 'pending' && measurable) {
      meta.appendChild(
        el(
          'span',
          measured.satisfied ? 'obj-track good' : 'obj-track bad',
          t(measured.satisfied ? 'ui.objectiveOnTrack' : 'ui.objectiveNotYet'),
        ),
      )
    }
    // The warning that the tolerance year has been spent. A player who has had one bad year and
    // does not know it is a player about to lose a run they think is going fine.
    const breaches = this.world.objectives.find((o) => o.id === objective.id)?.breachYears ?? 0
    if (status === 'pending' && breaches > 0) {
      meta.appendChild(el('span', 'obj-track bad', t('ui.objectiveAtRisk')))
    }
    if (!objective.required) meta.appendChild(el('span', 'obj-optional', t('ui.objectiveOptional')))
    const numbers = measurable ? describe(objective.condition, measured.value, measured.target) : t('ui.noReadingYet')
    if (numbers) meta.appendChild(el('span', 'obj-numbers', numbers))
    row.appendChild(meta)

    const progress = this.world.objectives.find((o) => o.id === objective.id)?.progress
    if (numbers !== null && measurable && progress !== undefined) {
      const bar = el('div', 'bar')
      const fill = el('div')
      fill.style.width = `${Math.max(0, Math.min(1, progress)) * 100}%`
      fill.style.background = status === 'failed' ? '#e2483d' : measured.satisfied ? '#5fc27e' : '#e8b23a'
      bar.appendChild(fill)
      row.appendChild(bar)
    }

    return row
  }

  /**
   * The end of the run.
   *
   * Shown as a panel over the map rather than a modal that swallows input, because a player who
   * has just lost a thirty-year run is entitled to look at what they built before being asked to
   * do anything. The only thing it insists on is being seen once.
   */
  private renderEndScreen(): void {
    const outcome = this.world.outcome
    // Bankruptcy counts as an ending here even though the verdict itself is only pronounced when
    // the year closes. It has to: the clock stops the hour the money runs out, and waiting until
    // January to say why left a player watching a frozen game through a summer that never came —
    // which is exactly the silence this panel exists to break.
    if ((outcome === 'playing' && !this.world.finances.bankrupt) || this.endDismissed) {
      this.gameOver.classList.remove('visible')
      return
    }
    if (this.gameOver.classList.contains('visible')) return

    this.gameOver.classList.add('visible')
    this.gameOver.replaceChildren()

    this.gameOver.appendChild(
      el('h2', outcome === 'won' ? 'good' : 'bad', t(outcome === 'won' ? 'ui.scenarioWon' : 'ui.scenarioLost')),
    )

    // Why it ended, in the same words the panel has been using all along.
    const required = this.world.scenario.objectives.filter((o) => o.required)
    const statusById = new Map(this.world.objectives.map((o) => [o.id, o]))
    for (const objective of required) {
      const status = statusById.get(objective.id)?.status ?? 'pending'
      const row = el('div', 'obj-summary')
      row.appendChild(el('span', `obj-chip obj-chip-${status}`, t(status === 'met' ? 'ui.objectiveMet' : status === 'failed' ? 'ui.objectiveFailed' : 'ui.objectivePending')))
      row.appendChild(el('span', undefined, t(objective.descriptionKey)))
      this.gameOver.appendChild(row)
    }
    if (this.world.finances.bankrupt) {
      this.gameOver.appendChild(el('div', 'obj-cause', t('ui.lostToBankruptcy')))
    }

    const actions = el('div', 'obj-saves')

    // Carrying on after the verdict. Offered for every ending except bankruptcy, because a
    // player running a deliberate strategy — all nuclear, all renewables, no replacement at all —
    // has most of their answer in the years *after* the brief fails, and stopping the clock
    // takes it away from them. What it does not do is reopen the verdict.
    if (!this.world.finances.bankrupt) {
      const carryOn = el('button', undefined, t('ui.keepPlaying'))
      carryOn.id = 'keep-playing'
      carryOn.title = t('ui.keepPlayingNote')
      carryOn.addEventListener('click', () => {
        this.world.freePlay = true
        this.endDismissed = true
        this.gameOver.classList.remove('visible')
      })
      actions.appendChild(carryOn)
    }

    const dismiss = el('button', undefined, t('ui.close'))
    dismiss.id = 'dismiss-verdict'
    dismiss.addEventListener('click', () => {
      this.endDismissed = true
      this.gameOver.classList.remove('visible')
    })
    actions.appendChild(dismiss)
    const load = el('button', undefined, t('ui.load'))
    load.addEventListener('click', () => this.callbacks.onLoad())
    actions.appendChild(load)
    this.gameOver.appendChild(actions)
  }
}
