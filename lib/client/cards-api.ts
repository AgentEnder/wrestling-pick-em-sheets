import type { BonusQuestion, Match } from "@/lib/types"

interface ApiErrorBody {
  error?: string
}

interface ApiDataEnvelope<T> {
  data: T
}

export interface CardSummary {
  id: string
  ownerId: string | null
  templateCardId: string | null
  name: string
  isPublic: boolean
  isTemplate: boolean
  createdAt: string
  updatedAt: string
}

export interface ResolvedCard {
  id: string
  ownerId: string | null
  templateCardId: string | null
  isPublic: boolean
  isTemplate: boolean
  name: string
  eventName: string
  promotionName: string
  eventDate: string
  eventTagline: string
  defaultPoints: number
  tiebreakerLabel: string
  tiebreakerIsTimeBased: boolean
  matches: Match[]
  eventBonusQuestions: BonusQuestion[]
  createdAt: string
  updatedAt: string
}

export interface SaveCardInput {
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

async function parseErrorMessage(response: Response): Promise<string> {
  const fallback = `Request failed (${response.status})`

  try {
    const body = (await response.json()) as ApiErrorBody
    if (body.error && body.error.trim()) {
      return body.error
    }
    return fallback
  } catch {
    return fallback
  }
}

async function requestJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init)

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response))
  }

  const body = (await response.json()) as ApiDataEnvelope<T>
  return body.data
}

export function listCards(): Promise<CardSummary[]> {
  return requestJson<CardSummary[]>("/api/cards")
}

export function getCard(cardId: string): Promise<ResolvedCard> {
  return requestJson<ResolvedCard>(`/api/cards/${cardId}`)
}

export function createCardFromTemplate(templateCardId: string): Promise<CardSummary> {
  return requestJson<CardSummary>("/api/cards/from-template", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ templateCardId }),
  })
}

export function createCard(input?: {
  name?: string
  isPublic?: boolean
}): Promise<CardSummary> {
  return requestJson<CardSummary>("/api/cards", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      name: input?.name,
      isPublic: input?.isPublic ?? false,
    }),
  })
}

export async function updateCardOverrides(
  cardId: string,
  input: {
    eventName?: string | null
    promotionName?: string | null
    eventDate?: string | null
    eventTagline?: string | null
    defaultPoints?: number | null
    tiebreakerLabel?: string | null
    tiebreakerIsTimeBased?: boolean | null
  },
): Promise<void> {
  const response = await fetch(`/api/cards/${cardId}/overrides`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(input),
  })

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response))
  }
}

export function saveCardSheet(cardId: string, input: SaveCardInput): Promise<ResolvedCard> {
  return requestJson<ResolvedCard>(`/api/cards/${cardId}`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(input),
  })
}
