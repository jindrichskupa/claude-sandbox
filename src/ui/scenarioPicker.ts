/**
 * Which grid you are taking over.
 *
 * A panel rather than a menu screen, over a map that is already drawn, because the scenarios
 * differ in ways a paragraph cannot carry and the map behind the panel is half the answer. It is
 * the first thing shown on a new run and the last thing between the player and the brief.
 *
 * The facts on each card are read off the scenario's own content rather than written into prose
 * beside it. A description can drift from the fleet it describes over a few edits; a count of what
 * is actually in the file cannot. It is the same discipline the opening brief follows, for the
 * same reason — and the cheap version of it, since a card must not cost a built world to draw.
 */

import { t } from '@i18n/index'
import { formatMw } from '@i18n/index'
import { PLANT_TYPES } from '@content/plantTypes'
import { SCENARIO_LIST } from '@content/scenarios'
import type { ScenarioContent } from '@content/scenarios/firstRegion'

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

/** What a scenario looks like from the outside, without building it. */
function shapeOf(scenario: ScenarioContent): {
  years: number
  cities: number
  inheritedMw: number
  demandMw: number
  oldestYears: number
} {
  let inheritedMw = 0
  let oldestYears = 0
  for (const plant of scenario.plants) {
    const type = PLANT_TYPES[plant.typeId]
    if (!type.heatOnly) inheritedMw += type.capacityMw.value
    oldestYears = Math.max(oldestYears, plant.ageYears)
  }
  let demandMw = 0
  for (const city of scenario.cities) demandMw += city.baseDemandMw
  return {
    years: scenario.endYear - scenario.startYear,
    cities: scenario.cities.length,
    inheritedMw,
    demandMw,
    oldestYears,
  }
}

export interface ScenarioPickerCallbacks {
  onPick: (scenarioId: string) => void
}

export class ScenarioPicker {
  private readonly root: HTMLDivElement

  constructor(
    parent: HTMLElement,
    private readonly callbacks: ScenarioPickerCallbacks,
  ) {
    this.root = el('div', 'panel')
    this.root.id = 'scenario-picker'
    parent.appendChild(this.root)
    this.render()
  }

  private render(): void {
    this.root.replaceChildren()
    this.root.appendChild(el('h2', undefined, t('ui.chooseScenario')))
    this.root.appendChild(el('div', 'subtitle', t('ui.chooseScenarioNote')))

    for (const scenario of SCENARIO_LIST) {
      const shape = shapeOf(scenario)
      const card = el('div', 'scenario-card')
      card.dataset.scenario = scenario.id

      card.appendChild(el('div', 'scenario-name', t(scenario.nameKey)))
      card.appendChild(
        el('div', 'scenario-span', `${scenario.startYear} – ${scenario.endYear} · ${shape.years} ${t('ui.years')}`),
      )
      card.appendChild(el('div', 'scenario-desc', t(scenario.descriptionKey)))

      // The four numbers that decide what kind of problem this is: how much is already standing,
      // how much has to be served, how tired the fleet is, and how many places depend on it.
      const facts = el('div', 'scenario-facts')
      facts.appendChild(el('span', undefined, t('ui.scenarioFleet', { mw: formatMw(shape.inheritedMw) })))
      facts.appendChild(el('span', undefined, t('ui.scenarioDemand', { mw: formatMw(shape.demandMw) })))
      facts.appendChild(el('span', undefined, t('ui.scenarioOldest', { years: Math.round(shape.oldestYears) })))
      facts.appendChild(el('span', undefined, t('ui.scenarioTowns', { n: shape.cities })))
      card.appendChild(facts)

      card.addEventListener('click', () => this.callbacks.onPick(scenario.id))
      this.root.appendChild(card)
    }
  }

  setOpen(open: boolean): void {
    this.root.classList.toggle('visible', open)
  }
}
