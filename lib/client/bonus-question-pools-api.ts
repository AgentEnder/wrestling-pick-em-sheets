import type { BonusPoolRuleSet, BonusQuestionAnswerType, BonusQuestionPool, BonusQuestionTemplate, BonusQuestionValueType } from '@/lib/types'

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

export function listBonusQuestionPools(): Promise<BonusQuestionPool[]> {
  return requestJson<BonusQuestionPool[]>('/api/bonus-question-pools')
}

export function listAdminBonusQuestionPools(): Promise<BonusQuestionPool[]> {
  return requestJson<BonusQuestionPool[]>('/api/admin/bonus-question-pools')
}

export function createBonusQuestionPool(input: {
  name: string
  description?: string
  sortOrder?: number
  isActive?: boolean
  matchTypeIds?: string[]
  ruleSetIds?: BonusPoolRuleSet[]
}): Promise<BonusQuestionPool> {
  return requestJson<BonusQuestionPool>('/api/admin/bonus-question-pools', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(input),
  })
}

export function updateBonusQuestionPool(
  poolId: string,
  input: {
    name?: string
    description?: string
    sortOrder?: number
    isActive?: boolean
    matchTypeIds?: string[]
    ruleSetIds?: BonusPoolRuleSet[]
  },
): Promise<void> {
  return requestNoContent(`/api/admin/bonus-question-pools/${poolId}`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(input),
  })
}

export function deleteBonusQuestionPool(poolId: string): Promise<void> {
  return requestNoContent(`/api/admin/bonus-question-pools/${poolId}`, {
    method: 'DELETE',
  })
}

export function createBonusQuestionTemplate(input: {
  poolId: string
  label: string
  questionTemplate: string
  defaultPoints?: number | null
  answerType: BonusQuestionAnswerType
  options?: string[]
  valueType?: BonusQuestionValueType
  defaultSection?: 'match' | 'event'
  sortOrder?: number
  isActive?: boolean
}): Promise<BonusQuestionTemplate> {
  return requestJson<BonusQuestionTemplate>('/api/admin/bonus-question-templates', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(input),
  })
}

export function updateBonusQuestionTemplate(
  templateId: string,
  input: {
    poolId?: string
    label?: string
    questionTemplate?: string
    defaultPoints?: number | null
    answerType?: BonusQuestionAnswerType
    options?: string[]
    valueType?: BonusQuestionValueType
    defaultSection?: 'match' | 'event'
    sortOrder?: number
    isActive?: boolean
  },
): Promise<void> {
  return requestNoContent(`/api/admin/bonus-question-templates/${templateId}`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(input),
  })
}

export function deleteBonusQuestionTemplate(templateId: string): Promise<void> {
  return requestNoContent(`/api/admin/bonus-question-templates/${templateId}`, {
    method: 'DELETE',
  })
}
