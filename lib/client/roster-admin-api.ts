import type { Promotion, PromotionRosterMember } from '@/lib/types'

interface ApiErrorBody {
  error?: string
}

interface ApiDataEnvelope<T> {
  data: T
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

async function requestNoContent(input: RequestInfo | URL, init?: RequestInit): Promise<void> {
  const response = await fetch(input, init)
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response))
  }
}

export function listAdminPromotions(): Promise<Promotion[]> {
  return requestJson<Promotion[]>('/api/admin/promotions')
}

export function createAdminPromotion(input: {
  name: string
  aliases?: string[]
  sortOrder?: number
  isActive?: boolean
}): Promise<Promotion> {
  return requestJson<Promotion>('/api/admin/promotions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(input),
  })
}

export function updateAdminPromotion(
  promotionId: string,
  input: {
    name?: string
    aliases?: string[]
    sortOrder?: number
    isActive?: boolean
  },
): Promise<void> {
  return requestNoContent(`/api/admin/promotions/${promotionId}`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(input),
  })
}

export function deleteAdminPromotion(promotionId: string): Promise<void> {
  return requestNoContent(`/api/admin/promotions/${promotionId}`, {
    method: 'DELETE',
  })
}

export function listAdminPromotionRosterMembers(
  promotionId: string,
): Promise<PromotionRosterMember[]> {
  return requestJson<PromotionRosterMember[]>(`/api/admin/promotions/${promotionId}/roster-members`)
}

export function createAdminPromotionRosterMember(
  promotionId: string,
  input: {
    displayName: string
    aliases?: string[]
    isActive?: boolean
  },
): Promise<PromotionRosterMember> {
  return requestJson<PromotionRosterMember>(`/api/admin/promotions/${promotionId}/roster-members`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(input),
  })
}

export function updateAdminPromotionRosterMember(
  promotionId: string,
  memberId: string,
  input: {
    displayName?: string
    aliases?: string[]
    isActive?: boolean
  },
): Promise<void> {
  return requestNoContent(`/api/admin/promotions/${promotionId}/roster-members/${memberId}`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(input),
  })
}

export function deleteAdminPromotionRosterMember(
  promotionId: string,
  memberId: string,
): Promise<void> {
  return requestNoContent(`/api/admin/promotions/${promotionId}/roster-members/${memberId}`, {
    method: 'DELETE',
  })
}

export function syncAdminWweRoster(promotionId: string): Promise<{
  promotionId: string
  promotionName: string
  fetchedCount: number
  insertedCount: number
  updatedCount: number
}> {
  return requestJson(`/api/admin/promotions/${promotionId}/sync-wwe`, {
    method: 'POST',
  })
}
