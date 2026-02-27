export function filterRosterMemberSuggestions(
  input: string,
  candidates: string[],
): string[] {
  const normalizedInput = input.trim().toLowerCase();
  if (!normalizedInput) return [];

  const deduped: string[] = [];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    if (!trimmed) continue;

    const normalizedCandidate = trimmed.toLowerCase();
    if (!normalizedCandidate.includes(normalizedInput)) continue;
    if (seen.has(normalizedCandidate)) continue;

    seen.add(normalizedCandidate);
    deduped.push(trimmed);

    if (deduped.length >= 8) {
      break;
    }
  }

  return deduped;
}

export function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export function formatEventTypeLabel(type: string): string {
  const normalized = type.toLowerCase();
  if (normalized.includes("bonus")) return "Bonus Question";
  if (normalized.includes("result")) return "Match Result";
  if (normalized.includes("tiebreaker")) return "Tiebreaker";
  return type.replace(/[_-]/g, " ");
}
