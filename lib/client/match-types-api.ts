import type { MatchType } from '@/lib/types'

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

export function listMatchTypes(): Promise<MatchType[]> {
  return requestJson<MatchType[]>('/api/match-types')
}

export function listAdminMatchTypes(): Promise<MatchType[]> {
  return requestJson<MatchType[]>('/api/admin/match-types')
}

export function createMatchType(input: {
  name: string
  sortOrder?: number
  isActive?: boolean
  defaultRuleSetIds?: Array<'timed-entry' | 'elimination'>
}): Promise<MatchType> {
  return requestJson<MatchType>('/api/admin/match-types', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(input),
  })
}

export function updateMatchType(
  matchTypeId: string,
  input: {
    name?: string
    sortOrder?: number
    isActive?: boolean
    defaultRuleSetIds?: Array<'timed-entry' | 'elimination'>
  },
): Promise<void> {
  return requestNoContent(`/api/admin/match-types/${matchTypeId}`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(input),
  })
}

export function deleteMatchType(matchTypeId: string): Promise<void> {
  return requestNoContent(`/api/admin/match-types/${matchTypeId}`, {
    method: 'DELETE',
  })
}
