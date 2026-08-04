/**
 * Every scenario the game knows, by id.
 *
 * A save records only the scenario it belongs to, because everything the scenario defines — the
 * map seed, the climate, the opening fleet, the objectives — is content rather than state and
 * would be both large and wrong to duplicate into every save file. Wrong because a save that
 * carried its own copy of the scenario would silently keep playing an old version of it after
 * the content was corrected.
 */

import { FIRST_REGION, type ScenarioContent } from './firstRegion'

export const SCENARIOS: Record<string, ScenarioContent> = {
  [FIRST_REGION.id]: FIRST_REGION,
}

export const SCENARIO_LIST: ScenarioContent[] = Object.values(SCENARIOS)

export function scenarioById(id: string): ScenarioContent | undefined {
  return SCENARIOS[id]
}
