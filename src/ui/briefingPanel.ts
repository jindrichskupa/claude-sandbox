/**
 * The first thing a player sees, and the standing line that follows it.
 *
 * Two parts of the same job. The brief says what was inherited, once, at the start. The concern
 * line says what is about to go wrong, continuously, for the rest of the run. Both read their
 * content from `sim/scenario/briefing.ts`, which measures the world rather than quoting authored
 * prose about it — so neither can drift out of step with the numbers it describes.
 *
 * The brief is a panel over the map rather than a modal, and the clock is paused behind it. That
 * combination is deliberate: a modal would say "answer me", which is wrong for something the
 * player may want to read while looking at the map, and a running clock would mean the first
 * thing the game does is take a decision away while they are still reading.
 */

import { t } from '@i18n/index'
import type { World } from '@sim/world'
import { nextConcern, openingBrief, type Concern } from '@sim/scenario/briefing'
import { expandName } from './newsPanel'

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

export interface BriefingPanelCallbacks {
  /** Called when the player closes the brief, so the loop can start the clock. */
  onBegin: () => void
  /** Take the player to whatever the concern is about. */
  onGoTo: (subjectId: string, kind: 'node' | 'plant' | 'edge') => void
}

export class BriefingPanel {
  private readonly root: HTMLDivElement
  private readonly concernLine: HTMLDivElement
  private shown = false
  private lastConcern = ''

  constructor(
    parent: HTMLElement,
    private readonly world: World,
    private readonly callbacks: BriefingPanelCallbacks,
  ) {
    this.root = el('div', 'panel')
    this.root.id = 'briefing'
    parent.appendChild(this.root)

    this.concernLine = el('div', 'panel')
    this.concernLine.id = 'concern'
    this.concernLine.addEventListener('click', () => {
      const concern = nextConcern(this.world)
      if (concern?.subjectId && concern.subjectKind) {
        this.callbacks.onGoTo(concern.subjectId, concern.subjectKind)
      }
    })
    parent.appendChild(this.concernLine)
  }

  /**
   * Show the brief, once per run.
   *
   * Once, because a briefing that reappears is an interruption. It can be reopened deliberately
   * from the objectives panel, which is where a player looking for "what was I asked to do again"
   * would go anyway.
   */
  open(): void {
    this.shown = true
    this.root.classList.add('visible')
    this.root.replaceChildren()
    this.root.appendChild(el('h2', undefined, t('brief.title')))
    const lines = el('div', 'brief-lines')
    this.root.appendChild(lines)
    for (const line of openingBrief(this.world)) {
      // Parameters that are themselves translation keys are expanded first, by the same rule the
      // news feed uses. The timeline's headlines arrive that way: `sim/` never imports the
      // dictionary, so a brief line about 1995 knowing what happens in 2022 has to name the key
      // and let the interface read it.
      const params: Record<string, string | number> = {}
      for (const [key, value] of Object.entries(line.params ?? {})) {
        params[key] = typeof value === 'string' ? expandName(value) : value
      }
      lines.appendChild(el('div', 'brief-line', t(line.key, params)))
    }
    const actions = el('div', 'obj-saves')
    const begin = el('button', undefined, t('brief.begin'))
    begin.id = 'brief-begin'
    begin.addEventListener('click', () => this.close())
    actions.appendChild(begin)
    this.root.appendChild(actions)
  }

  close(): void {
    this.root.classList.remove('visible')
    this.callbacks.onBegin()
  }

  isOpen(): boolean {
    return this.root.classList.contains('visible')
  }

  /** Whether the brief has been shown at all, so a load does not re-open it. */
  hasBeenShown(): boolean {
    return this.shown
  }

  markShown(): void {
    this.shown = true
  }

  /**
   * The standing line, redrawn only when what it says changes.
   *
   * Rebuilding it every frame would make the text unselectable and the panel flicker; comparing
   * the rendered string is cheaper than either and is exactly the right test, since the string is
   * the entire content.
   */
  render(): void {
    const concern = nextConcern(this.world)
    const text = concern ? t(concern.key, concern.params) : ''
    if (text === this.lastConcern) return
    this.lastConcern = text

    this.concernLine.classList.toggle('visible', text !== '')
    if (!text) return
    this.concernLine.replaceChildren()
    this.concernLine.appendChild(el('b', undefined, t('concern.title')))
    this.concernLine.appendChild(el('span', undefined, text))
    this.concernLine.classList.toggle('clickable', Boolean(concern?.subjectId))
  }

  /** The concern as the rest of the interface would state it, for a test to read. */
  current(): Concern | null {
    return nextConcern(this.world)
  }

  destroy(): void {
    this.root.remove()
    this.concernLine.remove()
  }
}
