import type { BonusPoolRuleSet, MatchType } from '@/lib/types'

export interface DefaultMatchType {
  id: string
  name: string
  defaultRuleSetIds: BonusPoolRuleSet[]
}

export const DEFAULT_MATCH_TYPE_ID = 'singles'
export const DEFAULT_BATTLE_ROYAL_MATCH_TYPE_ID = 'battle-royal'

export const DEFAULT_MATCH_TYPES: DefaultMatchType[] = [
  {
    id: 'singles',
    name: 'Singles Match',
    defaultRuleSetIds: [],
  },
  {
    id: 'tag-team',
    name: 'Tag Team Match',
    defaultRuleSetIds: [],
  },
  {
    id: 'triple-threat',
    name: 'Triple Threat',
    defaultRuleSetIds: [],
  },
  {
    id: 'fatal-four-way',
    name: 'Fatal Four Way',
    defaultRuleSetIds: [],
  },
  {
    id: 'ladder',
    name: 'Ladder Match',
    defaultRuleSetIds: [],
  },
  {
    id: 'cage',
    name: 'Cage Match',
    defaultRuleSetIds: [],
  },
  {
    id: 'gauntlet',
    name: 'Gauntlet Match',
    defaultRuleSetIds: [],
  },
  {
    id: 'battle-royal',
    name: 'Timed Entry Match',
    defaultRuleSetIds: ['timed-entry'],
  },
]

const MATCH_TYPES_BY_ID = new Map(
  DEFAULT_MATCH_TYPES.map((matchType) => [matchType.id, matchType]),
)

export function normalizeMatchTypeId(value: unknown, isBattleRoyal: boolean): string {
  if (typeof value !== 'string') {
    return isBattleRoyal ? DEFAULT_BATTLE_ROYAL_MATCH_TYPE_ID : DEFAULT_MATCH_TYPE_ID
  }

  const trimmed = value.trim()
  if (!trimmed) {
    return isBattleRoyal ? DEFAULT_BATTLE_ROYAL_MATCH_TYPE_ID : DEFAULT_MATCH_TYPE_ID
  }

  if (trimmed === 'standard') {
    return DEFAULT_MATCH_TYPE_ID
  }

  if (trimmed === 'battleRoyal') {
    return DEFAULT_BATTLE_ROYAL_MATCH_TYPE_ID
  }

  return trimmed
}

export function getDefaultMatchType(typeId: string): DefaultMatchType | undefined {
  return MATCH_TYPES_BY_ID.get(typeId)
}

export function getMatchTypeName(
  typeId: string,
  matchTypes?: MatchType[] | null,
): string {
  const configuredMatchType = matchTypes?.find((matchType) => matchType.id === typeId)
  if (configuredMatchType) {
    return configuredMatchType.name
  }

  return getDefaultMatchType(typeId)?.name ?? typeId
}
