export type BonusQuestionAnswerType = "write-in" | "multiple-choice"
export type BonusQuestionValueType = "string" | "numerical" | "time" | "rosterMember"
export type BonusGradingRule = "exact" | "closest" | "atOrAbove" | "atOrBelow"
export type BonusPoolRuleSet = "timed-entry" | "elimination"

export interface BonusQuestion {
  id: string
  question: string
  points: number | null // null means use sheet default
  answerType: BonusQuestionAnswerType
  options: string[] // only used when answerType is "multiple-choice"
  valueType: BonusQuestionValueType
  gradingRule?: BonusGradingRule
}

export interface BonusQuestionTemplate {
  id: string
  poolId: string
  label: string
  questionTemplate: string
  defaultPoints: number | null
  answerType: BonusQuestionAnswerType
  options: string[]
  valueType: BonusQuestionValueType
  gradingRule?: BonusGradingRule
  defaultSection: "match" | "event"
  sortOrder: number
  isActive: boolean
}

export interface BonusQuestionPool {
  id: string
  name: string
  description: string
  sortOrder: number
  isActive: boolean
  matchTypeIds: string[]
  ruleSetIds: BonusPoolRuleSet[]
  templates: BonusQuestionTemplate[]
}

export interface MatchType {
  id: string
  name: string
  sortOrder: number
  isActive: boolean
  defaultRuleSetIds: BonusPoolRuleSet[]
}

export interface Match {
  id: string
  type: string
  typeLabelOverride: string
  isBattleRoyal: boolean
  isEliminationStyle: boolean
  title: string // e.g. "WWE Championship Match"
  description: string // optional flavor text / stipulation details
  participants: string[]
  surpriseSlots: number
  surpriseEntrantPoints: number | null // null means use sheet default
  bonusQuestions: BonusQuestion[]
  points: number | null // null means use sheet default
}

export interface PickEmSheet {
  eventName: string
  promotionName: string
  eventDate: string
  eventTagline: string
  defaultPoints: number
  tiebreakerLabel: string
  tiebreakerIsTimeBased: boolean
  matches: Match[]
  eventBonusQuestions: BonusQuestion[]
}

export interface Promotion {
  id: string
  name: string
  aliases: string[]
  sortOrder: number
  isActive: boolean
}

export interface PromotionRosterMember {
  id: string
  promotionId: string
  displayName: string
  normalizedName: string
  aliases: string[]
  isActive: boolean
}

export interface LiveKeyAnswer {
  questionId: string
  answer: string
  recordedAt: string | null
  timerId: string | null
}

export interface LiveKeyMatchResult {
  matchId: string
  winnerName: string
  winnerRecordedAt: string | null
  battleRoyalEntryOrder: string[]
  bonusAnswers: LiveKeyAnswer[]
}

export interface LiveKeyTimer {
  id: string
  label: string
  elapsedMs: number
  isRunning: boolean
  startedAt: string | null
}

export interface CardLiveKeyPayload {
  timers: LiveKeyTimer[]
  matchResults: LiveKeyMatchResult[]
  eventBonusAnswers: LiveKeyAnswer[]
  tiebreakerAnswer: string
  tiebreakerRecordedAt: string | null
  tiebreakerTimerId: string | null
}

export interface CardLiveKey {
  userId: string
  cardId: string
  updatedAt: string
  payload: CardLiveKeyPayload
}

export type LiveGameStatus = "lobby" | "live" | "ended"
export type LiveGameMode = "room" | "solo"
export type LiveGameKeyPayload = CardLiveKeyPayload

export interface LiveGameLockState {
  globalLocked: boolean
  matchLocks: Record<string, { locked: boolean; source: "host" | "timer" }>
  matchBonusLocks: Record<string, { locked: boolean; source: "host" | "timer" }>
  eventBonusLocks: Record<string, { locked: boolean; source: "host" | "timer" }>
}

export interface LivePlayerAnswer {
  questionId: string
  answer: string
}

export interface LivePlayerMatchPick {
  matchId: string
  winnerName: string
  battleRoyalEntrants: string[]
  bonusAnswers: LivePlayerAnswer[]
}

export interface LivePlayerPicksPayload {
  matchPicks: LivePlayerMatchPick[]
  eventBonusAnswers: LivePlayerAnswer[]
  tiebreakerAnswer: string
}

export interface LiveGame {
  id: string
  cardId: string
  hostUserId: string
  mode: LiveGameMode
  joinCode: string
  allowLateJoins: boolean
  status: LiveGameStatus
  expiresAt: string
  endedAt: string | null
  createdAt: string
  updatedAt: string
  keyPayload: LiveGameKeyPayload
  lockState: LiveGameLockState
}

export interface LiveGamePlayer {
  id: string
  gameId: string
  authMethod: "guest" | "clerk"
  clerkUserId: string | null
  nickname: string
  picks: LivePlayerPicksPayload
  isSubmitted: boolean
  submittedAt: string | null
  joinedAt: string
  lastSeenAt: string
  updatedAt: string
  browserName: string | null
  browserVersion: string | null
  osName: string | null
  osVersion: string | null
  deviceType: string | null
  deviceVendor: string | null
  deviceModel: string | null
  platform: string | null
  platformVersion: string | null
  architecture: string | null
}

export interface LiveGameLeaderboardEntry {
  rank: number
  nickname: string
  score: number
  breakdown: {
    winnerPoints: number
    bonusPoints: number
    surprisePoints: number
  }
  isSubmitted: boolean
  lastUpdatedAt: string
  lastSeenAt: string
}
