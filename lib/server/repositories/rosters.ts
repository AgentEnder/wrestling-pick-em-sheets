import { randomUUID } from 'crypto'

import { db } from '@/lib/server/db/client'
import type { PromotionRosterMembers, Promotions } from '@/lib/server/db/generated'
import { requireDbId } from '@/lib/server/db/types'
import type { Promotion, PromotionRosterMember } from '@/lib/types'
import type { Selectable, Updateable } from 'kysely'

type PromotionSelectable = Selectable<Promotions>
type PromotionRosterMemberSelectable = Selectable<PromotionRosterMembers>

interface PromotionRow {
  id: string
  name: string
  aliases_json: string
  sort_order: number
  is_active: number
  created_at: string
  updated_at: string
}

interface PromotionRosterMemberRow {
  id: string
  promotion_id: string
  display_name: string
  normalized_name: string
  aliases_json: string
  is_active: number
  created_at: string
  updated_at: string
}

export interface PromotionRosterSuggestions {
  promotionId: string | null
  promotionName: string
  names: string[]
}

export interface SyncWweRosterResult {
  promotionId: string
  promotionName: string
  fetchedCount: number
  insertedCount: number
  updatedCount: number
}

interface WweTalentEntry {
  value?: string | null
}

const WWE_TALENT_URL = 'https://www.wwe.com/superstar/talent'

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function normalizeDisplayName(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .trim()
}

async function fetchWweTalentNames(): Promise<string[]> {
  const response = await fetch(WWE_TALENT_URL, {
    method: 'GET',
    headers: {
      accept: 'application/json',
      'user-agent': 'wrestling-pick-em-sheets/1.0 (+admin-roster-sync)',
    },
  })

  if (!response.ok) {
    throw new Error(`WWE talent request failed (${response.status})`)
  }

  const payload = (await response.json()) as unknown
  if (!Array.isArray(payload)) {
    throw new Error('Unexpected WWE talent payload')
  }

  const names: string[] = []
  const seen = new Set<string>()

  for (const item of payload as WweTalentEntry[]) {
    const displayName = normalizeDisplayName(String(item?.value ?? ''))
    if (!displayName) continue

    const normalized = normalizeName(displayName)
    if (!normalized) continue
    if (seen.has(normalized)) continue

    seen.add(normalized)
    names.push(displayName)
  }

  return names.sort((a, b) => a.localeCompare(b))
}

function parseAliases(value: string | null | undefined): string[] {
  if (!value) return []

  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) return []

    const aliases: string[] = []
    const seen = new Set<string>()
    for (const item of parsed) {
      if (typeof item !== 'string') continue
      const trimmed = item.trim()
      if (!trimmed) continue

      const normalized = trimmed.toLowerCase()
      if (seen.has(normalized)) continue
      seen.add(normalized)
      aliases.push(trimmed)
    }

    return aliases
  } catch {
    return []
  }
}

function normalizeAliases(aliases: string[]): string[] {
  const deduped: string[] = []
  const seen = new Set<string>()

  for (const alias of aliases) {
    const trimmed = alias.trim()
    if (!trimmed) continue

    const normalized = trimmed.toLowerCase()
    if (seen.has(normalized)) continue
    seen.add(normalized)
    deduped.push(trimmed)
  }

  return deduped
}

function asPromotionRow(row: PromotionSelectable): PromotionRow {
  return {
    id: requireDbId(row.id, 'promotions.id'),
    name: row.name,
    aliases_json: row.aliases_json,
    sort_order: row.sort_order,
    is_active: Number(row.is_active),
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

function asPromotionRosterMemberRow(
  row: PromotionRosterMemberSelectable,
): PromotionRosterMemberRow {
  return {
    id: requireDbId(row.id, 'promotion_roster_members.id'),
    promotion_id: row.promotion_id,
    display_name: row.display_name,
    normalized_name: row.normalized_name,
    aliases_json: row.aliases_json,
    is_active: Number(row.is_active),
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

function mapPromotion(row: PromotionRow): Promotion {
  return {
    id: row.id,
    name: row.name,
    aliases: parseAliases(row.aliases_json),
    sortOrder: row.sort_order,
    isActive: row.is_active === 1,
  }
}

function mapRosterMember(row: PromotionRosterMemberRow): PromotionRosterMember {
  return {
    id: row.id,
    promotionId: row.promotion_id,
    displayName: row.display_name,
    normalizedName: row.normalized_name,
    aliases: parseAliases(row.aliases_json),
    isActive: row.is_active === 1,
  }
}

function matchesPromotionQuery(promotion: Promotion, normalizedPromotionName: string): boolean {
  const allNames = [promotion.name, ...promotion.aliases]
  for (const name of allNames) {
    const normalizedCandidate = normalizeName(name)
    if (!normalizedCandidate) continue
    if (normalizedCandidate === normalizedPromotionName) return true
  }

  for (const name of allNames) {
    const normalizedCandidate = normalizeName(name)
    if (!normalizedCandidate) continue
    if (
      normalizedCandidate.includes(normalizedPromotionName) ||
      normalizedPromotionName.includes(normalizedCandidate)
    ) {
      return true
    }
  }

  return false
}

export async function listPromotions(options?: {
  includeInactive?: boolean
}): Promise<Promotion[]> {
  let query = db
    .selectFrom('promotions')
    .selectAll()
    .orderBy('sort_order', 'asc')
    .orderBy('name', 'asc')

  if (!options?.includeInactive) {
    query = query.where('is_active', '=', 1)
  }

  const rows = await query.execute()
  return rows.map((row) => mapPromotion(asPromotionRow(row)))
}

export async function createPromotion(input: {
  name: string
  aliases?: string[]
  sortOrder?: number
  isActive?: boolean
}): Promise<Promotion> {
  const now = new Date().toISOString()
  const id = randomUUID()
  const aliases = normalizeAliases(input.aliases ?? [])

  await db
    .insertInto('promotions')
    .values({
      id,
      name: input.name.trim(),
      aliases_json: JSON.stringify(aliases),
      sort_order: input.sortOrder ?? 0,
      is_active: input.isActive === false ? 0 : 1,
      created_at: now,
      updated_at: now,
    })
    .execute()

  const created = await db
    .selectFrom('promotions')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirstOrThrow()

  return mapPromotion(asPromotionRow(created))
}

export async function updatePromotion(
  promotionId: string,
  input: {
    name?: string
    aliases?: string[]
    sortOrder?: number
    isActive?: boolean
  },
): Promise<boolean> {
  const now = new Date().toISOString()
  const update: Updateable<Promotions> = {
    updated_at: now,
  }

  if (input.name !== undefined) {
    update.name = input.name.trim()
  }
  if (input.aliases !== undefined) {
    update.aliases_json = JSON.stringify(normalizeAliases(input.aliases))
  }
  if (input.sortOrder !== undefined) {
    update.sort_order = input.sortOrder
  }
  if (input.isActive !== undefined) {
    update.is_active = input.isActive ? 1 : 0
  }

  const result = await db
    .updateTable('promotions')
    .set(update)
    .where('id', '=', promotionId)
    .executeTakeFirst()

  return Number(result.numUpdatedRows ?? 0) > 0
}

export async function deletePromotion(promotionId: string): Promise<boolean> {
  const result = await db
    .deleteFrom('promotions')
    .where('id', '=', promotionId)
    .executeTakeFirst()

  return Number(result.numDeletedRows ?? 0) > 0
}

export async function listPromotionRosterMembers(
  promotionId: string,
  options?: { includeInactive?: boolean },
): Promise<PromotionRosterMember[]> {
  let query = db
    .selectFrom('promotion_roster_members')
    .selectAll()
    .where('promotion_id', '=', promotionId)
    .orderBy('display_name', 'asc')

  if (!options?.includeInactive) {
    query = query.where('is_active', '=', 1)
  }

  const rows = await query.execute()
  return rows.map((row) => mapRosterMember(asPromotionRosterMemberRow(row)))
}

export async function createPromotionRosterMember(
  promotionId: string,
  input: {
    displayName: string
    aliases?: string[]
    isActive?: boolean
  },
): Promise<PromotionRosterMember | null> {
  const promotion = await db
    .selectFrom('promotions')
    .select(['id'])
    .where('id', '=', promotionId)
    .executeTakeFirst()

  if (!promotion) return null

  const now = new Date().toISOString()
  const displayName = input.displayName.trim()
  const aliases = normalizeAliases(input.aliases ?? [])
  const id = randomUUID()

  await db
    .insertInto('promotion_roster_members')
    .values({
      id,
      promotion_id: promotionId,
      display_name: displayName,
      normalized_name: normalizeName(displayName),
      aliases_json: JSON.stringify(aliases),
      is_active: input.isActive === false ? 0 : 1,
      created_at: now,
      updated_at: now,
    })
    .execute()

  const created = await db
    .selectFrom('promotion_roster_members')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirstOrThrow()

  return mapRosterMember(asPromotionRosterMemberRow(created))
}

export async function updatePromotionRosterMember(
  promotionId: string,
  memberId: string,
  input: {
    displayName?: string
    aliases?: string[]
    isActive?: boolean
  },
): Promise<boolean> {
  const now = new Date().toISOString()
  const update: Updateable<PromotionRosterMembers> = {
    updated_at: now,
  }

  if (input.displayName !== undefined) {
    const displayName = input.displayName.trim()
    update.display_name = displayName
    update.normalized_name = normalizeName(displayName)
  }
  if (input.aliases !== undefined) {
    update.aliases_json = JSON.stringify(normalizeAliases(input.aliases))
  }
  if (input.isActive !== undefined) {
    update.is_active = input.isActive ? 1 : 0
  }

  const result = await db
    .updateTable('promotion_roster_members')
    .set(update)
    .where('id', '=', memberId)
    .where('promotion_id', '=', promotionId)
    .executeTakeFirst()

  return Number(result.numUpdatedRows ?? 0) > 0
}

export async function deletePromotionRosterMember(
  promotionId: string,
  memberId: string,
): Promise<boolean> {
  const result = await db
    .deleteFrom('promotion_roster_members')
    .where('id', '=', memberId)
    .where('promotion_id', '=', promotionId)
    .executeTakeFirst()

  return Number(result.numDeletedRows ?? 0) > 0
}

export async function getRosterSuggestionsByPromotionName(input: {
  promotionName: string
  query?: string
  limit?: number
}): Promise<PromotionRosterSuggestions> {
  const normalizedPromotionName = normalizeName(input.promotionName)
  if (!normalizedPromotionName) {
    return {
      promotionId: null,
      promotionName: input.promotionName.trim(),
      names: [],
    }
  }

  const promotions = await listPromotions({ includeInactive: false })
  const matchedPromotion = promotions.find((promotion) =>
    matchesPromotionQuery(promotion, normalizedPromotionName),
  )

  if (!matchedPromotion) {
    return {
      promotionId: null,
      promotionName: input.promotionName.trim(),
      names: [],
    }
  }

  const members = await listPromotionRosterMembers(matchedPromotion.id, { includeInactive: false })
  const normalizedQuery = normalizeName(input.query ?? '')
  const maxResults = input.limit ?? 250

  const names: string[] = []
  const seen = new Set<string>()
  for (const member of members) {
    const candidateNames = [member.displayName, ...member.aliases]
    const matchesQuery =
      !normalizedQuery ||
      candidateNames.some((candidate) => normalizeName(candidate).includes(normalizedQuery))

    if (!matchesQuery) continue

    const dedupeKey = member.displayName.toLowerCase()
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    names.push(member.displayName)

    if (names.length >= maxResults) break
  }

  return {
    promotionId: matchedPromotion.id,
    promotionName: matchedPromotion.name,
    names,
  }
}

export async function syncWweRosterForPromotion(
  promotionId: string,
): Promise<SyncWweRosterResult | null> {
  const promotionRaw = await db
    .selectFrom('promotions')
    .selectAll()
    .where('id', '=', promotionId)
    .executeTakeFirst()

  if (!promotionRaw) return null

  const promotion = mapPromotion(asPromotionRow(promotionRaw))
  const names = await fetchWweTalentNames()
  const now = new Date().toISOString()

  const existingRows = await db
    .selectFrom('promotion_roster_members')
    .selectAll()
    .where('promotion_id', '=', promotionId)
    .execute()

  const existingByNormalizedName = new Map<string, PromotionRosterMemberRow>()
  for (const row of existingRows) {
    const mapped = asPromotionRosterMemberRow(row)
    existingByNormalizedName.set(mapped.normalized_name, mapped)
  }

  let insertedCount = 0
  let updatedCount = 0

  await db.transaction().execute(async (trx) => {
    for (const displayName of names) {
      const normalized = normalizeName(displayName)
      const existing = existingByNormalizedName.get(normalized)

      if (existing) {
        if (existing.display_name !== displayName || existing.is_active !== 1) {
          await trx
            .updateTable('promotion_roster_members')
            .set({
              display_name: displayName,
              is_active: 1,
              updated_at: now,
            })
            .where('id', '=', existing.id)
            .execute()
          updatedCount += 1
        }
        continue
      }

      await trx
        .insertInto('promotion_roster_members')
        .values({
          id: randomUUID(),
          promotion_id: promotionId,
          display_name: displayName,
          normalized_name: normalized,
          aliases_json: '[]',
          is_active: 1,
          created_at: now,
          updated_at: now,
        })
        .execute()
      insertedCount += 1
    }
  })

  return {
    promotionId: promotion.id,
    promotionName: promotion.name,
    fetchedCount: names.length,
    insertedCount,
    updatedCount,
  }
}
