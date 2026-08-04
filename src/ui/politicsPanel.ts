/**
 * The politics panel.
 *
 * Its job is to make the government legible, and there is one thing it must get right for the
 * whole milestone to work: the player has to be able to see *why* the last election went the way
 * it did. A change of government that arrives as a surprise is indistinguishable from the game
 * cheating, and since a change of government can tear up every support contract the player owns,
 * that distinction matters more here than anywhere else in the interface.
 *
 * So the panel shows the salience — what the electorate is angry about — beside the vote shares,
 * and every one of those four bars is something the player's own system produced.
 */

import { formatMoney, formatPct, t } from '@i18n/index'
import { POLICY_REGIMES, REGIMES_BY_ID } from '@content/policies'
import { PLANT_TYPES } from '@content/plantTypes'
import { FUELS, type FuelId } from '@content/fuels'
import type { World } from '@sim/world'
import { Param } from '@sim/params/types'
import { isContractActive } from '@sim/policy/contracts'
import { TICKS_PER_YEAR } from '@sim/core/time'
import { effectiveInterestRate } from '@sim/economy/economy'

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

export interface PoliticsPanelCallbacks {
  onOpen?: () => void
}

export class PoliticsPanel {
  private readonly root: HTMLDivElement
  private readonly body: HTMLDivElement
  private readonly toggle: HTMLButtonElement
  private open = false

  constructor(
    parent: HTMLElement,
    private readonly world: World,
    private readonly callbacks: PoliticsPanelCallbacks = {},
  ) {
    this.toggle = el('button', undefined, t('ui.politics'))
    this.toggle.id = 'politics-toggle'
    this.toggle.addEventListener('click', () => this.setOpen(!this.open))
    parent.appendChild(this.toggle)

    this.root = el('div', 'panel')
    this.root.id = 'politics-panel'
    const header = el('div', 'build-header')
    header.appendChild(el('h3', undefined, t('ui.politics')))
    const close = el('button', undefined, t('ui.close'))
    close.addEventListener('click', () => this.setOpen(false))
    header.appendChild(close)
    this.root.appendChild(header)

    this.body = el('div')
    this.root.appendChild(this.body)
    parent.appendChild(this.root)
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

  render(): void {
    if (!this.open) return
    const world = this.world
    const state = world.state
    const regime = REGIMES_BY_ID.get(state.policyRegimeId)
    this.body.replaceChildren()
    if (!regime) return

    // --- Who is in office, and what they are doing ---
    const gov = el('div', 'pol-block')
    gov.appendChild(el('div', 'pol-name', t(regime.nameKey)))
    gov.appendChild(el('div', 'pol-desc', t(regime.descriptionKey)))

    const yearsLeft = Math.max(0, (state.nextElectionTick - world.tick) / TICKS_PER_YEAR)
    gov.appendChild(this.kv(t('ui.nextElection', { years: yearsLeft.toFixed(1) }), ''))
    gov.appendChild(
      this.kv(t('ui.carbonPrice'), `€${world.params.getOr('world', Param.CarbonPricePerTonne, 0).toFixed(0)}/t`),
    )
    gov.appendChild(
      this.kv(t('ui.corporateTax'), formatPct(world.params.getOr('world', Param.CorporateTaxRate, 0))),
    )
    if (!regime.levers.honoursContracts) {
      gov.appendChild(el('div', 'pol-warning', t('ui.doesNotHonourContracts')))
    }
    if (regime.levers.bans.length > 0) {
      const banned = regime.levers.bans.map((b) => t(PLANT_TYPES[b].nameKey)).join(', ')
      gov.appendChild(this.kv(t('ui.banned'), banned))
    }
    this.body.appendChild(gov)

    // --- The cost of the country's word ---
    const trust = el('div', 'pol-block')
    // Public opinion belongs here rather than in the top bar: on its own it is a number, but
    // beside the government it re-elects or throws out it is a forecast.
    const opinion = state.publicOpinion
    const opinionRow = this.kv(t('ui.opinion'), formatPct(opinion))
    // `classList.add('')` throws, so the middle case adds nothing rather than an empty token.
    if (opinion < 0.35) opinionRow.classList.add('bad')
    else if (opinion > 0.6) opinionRow.classList.add('good')
    trust.appendChild(opinionRow)
    trust.appendChild(el('div', 'pol-heading', t('ui.investorConfidence')))
    const bar = el('div', 'bar')
    const fill = el('div')
    fill.style.width = `${state.investorConfidence * 100}%`
    fill.style.background = state.investorConfidence > 0.8 ? '#5fc27e' : state.investorConfidence > 0.55 ? '#e8b23a' : '#e2483d'
    bar.appendChild(fill)
    trust.appendChild(bar)
    // The number that makes a torn-up contract cost something, so it is shown next to the cause.
    trust.appendChild(
      this.kv(t('ui.borrowingRate'), formatPct(effectiveInterestRate(state.investorConfidence))),
    )
    this.body.appendChild(trust)

    // --- Why the last election went the way it did ---
    if (Object.keys(state.polls).length > 0) {
      const polls = el('div', 'pol-block')
      polls.appendChild(el('div', 'pol-heading', t('ui.polls')))
      const ranked = POLICY_REGIMES.filter((r) => state.polls[r.id] !== undefined).sort(
        (a, b) => (state.polls[b.id] ?? 0) - (state.polls[a.id] ?? 0),
      )
      for (const runner of ranked) {
        const share = state.polls[runner.id] ?? 0
        const row = el('div', 'pol-poll')
        row.appendChild(el('span', 'pol-poll-name', t(runner.nameKey)))
        const track = el('div', 'pol-poll-bar')
        const value = el('div')
        value.style.width = `${share * 100}%`
        if (runner.id === state.policyRegimeId) value.classList.add('winner')
        track.appendChild(value)
        row.appendChild(track)
        row.appendChild(el('span', 'pol-poll-share', formatPct(share)))
        polls.appendChild(row)
      }
      this.body.appendChild(polls)
    }

    // --- Fuel, which is where geopolitics actually lands ---
    const fuels = el('div', 'pol-block')
    fuels.appendChild(el('div', 'pol-heading', t('ui.fuelPrices')))
    for (const fuelId of Object.keys(FUELS) as FuelId[]) {
      const fuel = FUELS[fuelId]
      if (fuel.pricePerMwhThermal.value <= 0) continue
      const index = state.fuelPriceIndex[fuelId] ?? 1
      const price = fuel.pricePerMwhThermal.value * index
      const row = this.kv(t(fuel.nameKey), `€${price.toFixed(1)}/MWh`)
      // Coloured by how far it has moved, so an ordinary month reads as ordinary.
      if (index > 1.25) row.classList.add('bad')
      else if (index < 0.85) row.classList.add('good')
      fuels.appendChild(row)
    }
    this.body.appendChild(fuels)

    // --- Contracts: what was promised, and whether it survived ---
    const contracts = el('div', 'pol-block')
    contracts.appendChild(el('div', 'pol-heading', t('ui.contracts')))
    if (state.contracts.length === 0) {
      contracts.appendChild(el('div', 'pol-desc', t('ui.contractsNone')))
    } else {
      for (const contract of state.contracts.slice(-8)) {
        const startYear = world.scenario.startYear + Math.floor(contract.startsTick / TICKS_PER_YEAR)
        const endYear = world.scenario.startYear + Math.floor(contract.expiresTick / TICKS_PER_YEAR)
        const row = el('div', 'pol-contract')
        row.appendChild(el('span', 'pol-contract-name', contract.plantId.replace(/^p_/, '')))
        let status: string
        if (contract.revokedTick !== undefined) {
          const revokedYear = world.scenario.startYear + Math.floor(contract.revokedTick / TICKS_PER_YEAR)
          status = t('ui.contractRevoked', { year: revokedYear })
          row.classList.add('revoked')
        } else if (isContractActive(contract, world.tick)) {
          status = t('ui.contractActive', { price: formatMoney(contract.pricePerMwh), year: endYear })
        } else if (world.tick < contract.startsTick) {
          status = t('ui.contractPending', { price: formatMoney(contract.pricePerMwh), year: startYear })
        } else {
          status = t('ui.contractExpired', { year: endYear })
        }
        row.appendChild(el('span', 'pol-contract-status', status))
        contracts.appendChild(row)
      }
    }
    this.body.appendChild(contracts)
  }

  private kv(label: string, value: string): HTMLDivElement {
    const row = el('div', 'kv')
    row.appendChild(el('span', 'k', label))
    row.appendChild(el('span', 'v', value))
    return row
  }
}
