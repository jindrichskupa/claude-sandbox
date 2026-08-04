/**
 * Support contracts, and the withdrawal of them.
 *
 * A feed-in tariff or a contract for difference is not a property of a technology; it is a
 * promise made to one machine on one date, for a fixed number of years. Modelling it as a
 * per-technology setting — which is what this game did until now — quietly removes the only
 * thing about subsidies that is financially interesting.
 *
 * Two consequences follow from doing it properly, and both are the point of this file.
 *
 * **The promise is made at the investment decision, not at commissioning.** A player commits
 * capital under one government and the station arrives under another, four years and one
 * election later. That gap is the entire risk profile of energy investment, and it is why the
 * contract is granted when construction starts while its term runs from the day the plant
 * enters service.
 *
 * **The promise can be broken.** Three of the six regimes in `content/policies.ts` do not honour
 * their predecessors' contracts, for three different and entirely recognisable reasons: a crisis
 * government reallocating money to keeping the lights on, a consumer-price government abolishing
 * a levy on bills, a treasury that has simply run out of room. None of them is the villain. What
 * they all pay is the cost of capital afterwards — see `investorConfidence` — because a country
 * that has torn up one contract borrows more expensively for the next one. That feedback is what
 * makes withdrawal a real decision by the modelled political system rather than an arbitrary
 * punishment of the player.
 */

import { REGIMES_BY_ID } from '@content/policies'
import type { PlantTypeId } from '@content/plantTypes'
import { TICKS_PER_YEAR } from '../core/time'

export interface SupportContract {
  id: string
  plantId: string
  typeId: PlantTypeId
  /** Guaranteed price per MWh for the term. */
  pricePerMwh: number
  /** When the promise was made — at the investment decision. */
  grantedTick: number
  /** When the plant enters service and the money starts. */
  startsTick: number
  expiresTick: number
  grantedByRegimeId: string
  /** Set when a later government tears it up. */
  revokedTick?: number
}

/** Whether a contract is paying out right now. */
export function isContractActive(contract: SupportContract, tick: number): boolean {
  if (contract.revokedTick !== undefined && tick >= contract.revokedTick) return false
  return tick >= contract.startsTick && tick < contract.expiresTick
}

/**
 * The guaranteed price a plant is receiving this hour, or zero.
 *
 * Note what this does *not* do: it never looks at the plant's technology to decide. Support is
 * whatever was actually promised to this machine, which is the whole distinction between a
 * contract and a policy preference.
 */
export function contractedPriceFor(
  contracts: SupportContract[],
  plantId: string,
  tick: number,
): number {
  for (const contract of contracts) {
    if (contract.plantId === plantId && isContractActive(contract, tick)) return contract.pricePerMwh
  }
  return 0
}

/**
 * Offer a contract for a plant whose construction is starting now, if the government of the day
 * supports that technology. Returns null when there is no offer on the table.
 */
export function offerContract(
  regimeId: string,
  plantId: string,
  typeId: PlantTypeId,
  tick: number,
  commissioningTick: number,
  serial: number,
): SupportContract | null {
  const regime = REGIMES_BY_ID.get(regimeId)
  const offer = regime?.levers.supportOffers[typeId]
  if (!regime || !offer) return null

  const termTicks = Math.round(regime.levers.supportTermYears.value * TICKS_PER_YEAR)
  return {
    id: `c${serial}`,
    plantId,
    typeId,
    pricePerMwh: offer.value,
    grantedTick: tick,
    startsTick: commissioningTick,
    expiresTick: commissioningTick + termTicks,
    grantedByRegimeId: regimeId,
  }
}

/**
 * What is still owed on a contract, in euros, at today's prices.
 *
 * Used to size the confidence shock when one is torn up: cancelling a small contract with a year
 * left is not the same event as cancelling a twenty-year one on its first day, and treating them
 * alike would make the political consequence meaningless.
 */
export function remainingValue(contract: SupportContract, tick: number, expectedLoadFactor = 0.35): number {
  if (contract.revokedTick !== undefined || tick >= contract.expiresTick) return 0
  const remainingTicks = contract.expiresTick - Math.max(tick, contract.startsTick)
  if (remainingTicks <= 0) return 0
  // Deliberately per rated MW rather than per plant: the caller multiplies by capacity, which
  // keeps this function free of any dependency on the asset model.
  return contract.pricePerMwh * remainingTicks * expectedLoadFactor
}

/** Tear up every contract in force. Returns the ones actually revoked. */
export function revokeAll(contracts: SupportContract[], tick: number): SupportContract[] {
  const revoked: SupportContract[] = []
  for (const contract of contracts) {
    if (contract.revokedTick !== undefined) continue
    if (tick >= contract.expiresTick) continue
    contract.revokedTick = tick
    revoked.push(contract)
  }
  return revoked
}

/**
 * How far confidence falls when contracts are torn up.
 *
 * Scaled by how much was destroyed relative to the utility's turnover, because that is what
 * makes a large repudiation different from a token one, and floored so that even a small breach
 * is noticed. Recovery is slow and automatic: trust is cheap to lose and expensive to rebuild,
 * which is the actual asymmetry.
 */
export const CONFIDENCE_FLOOR = 0.35
export const CONFIDENCE_RECOVERY_PER_YEAR = 0.12

export function confidenceAfterBreach(
  confidence: number,
  destroyedValue: number,
  annualRevenue: number,
): number {
  if (destroyedValue <= 0) return confidence
  const share = destroyedValue / Math.max(1, annualRevenue)
  const damage = Math.min(0.45, 0.08 + share * 0.35)
  return Math.max(CONFIDENCE_FLOOR, confidence - damage)
}
