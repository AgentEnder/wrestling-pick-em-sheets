export interface BonusQuestion {
  id: string
  question: string
  points: number | null // null means use sheet default
  answerType: "write-in" | "multiple-choice"
  options: string[] // only used when answerType is "multiple-choice"
}

export interface StandardMatch {
  id: string
  type: "standard"
  title: string // e.g. "WWE Championship Match"
  description: string // optional flavor text / stipulation details
  participants: string[]
  bonusQuestions: BonusQuestion[]
  points: number | null // null means use sheet default
}

export interface BattleRoyalMatch {
  id: string
  type: "battleRoyal"
  title: string
  description: string
  announcedParticipants: string[]
  surpriseSlots: number
  bonusQuestions: BonusQuestion[]
  points: number | null // null means use sheet default
}

export type Match = StandardMatch | BattleRoyalMatch

export interface PickEmSheet {
  eventName: string
  eventDate: string
  eventTagline: string
  defaultPoints: number
  tiebreakerLabel: string
  matches: Match[]
}
