export interface BonusQuestion {
  id: string
  question: string
  points: number | null // null means use sheet default
}

export interface StandardMatch {
  id: string
  type: "standard"
  title: string // e.g. "WWE Championship Match"
  participants: string[]
  bonusQuestions: BonusQuestion[]
  points: number | null // null means use sheet default
}

export interface BattleRoyalMatch {
  id: string
  type: "battleRoyal"
  title: string
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
  matches: Match[]
}
