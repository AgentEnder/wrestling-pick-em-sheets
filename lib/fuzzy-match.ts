function normalizeForFuzzy(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;

  if (m === 0) return n;
  if (n === 0) return m;

  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);

  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1, // deletion
        curr[j - 1] + 1, // insertion
        prev[j - 1] + cost, // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }

  return prev[n];
}

function wordSubstringConfidence(shorter: string, longer: string): number {
  const longerWords = longer.split(" ");
  const shorterWords = shorter.split(" ");

  // Check if all words in shorter appear as complete words in longer
  const allWordsMatch = shorterWords.every((word) =>
    longerWords.some((lw) => lw === word),
  );

  if (allWordsMatch) {
    const ratio = shorter.length / longer.length;
    return 0.8 + 0.2 * ratio;
  }

  return 0;
}

export function computeFuzzyConfidence(
  playerAnswer: string,
  keyAnswer: string,
): number {
  const normPlayer = normalizeForFuzzy(playerAnswer);
  const normKey = normalizeForFuzzy(keyAnswer);

  if (!normPlayer || !normKey) return 0;

  // Exact match after normalization
  if (normPlayer === normKey) return 1.0;

  // Word-level substring matching
  const [shorter, longer] =
    normPlayer.length <= normKey.length
      ? [normPlayer, normKey]
      : [normKey, normPlayer];

  const substringScore = wordSubstringConfidence(shorter, longer);

  // Levenshtein distance
  const distance = levenshteinDistance(normPlayer, normKey);
  const maxLen = Math.max(normPlayer.length, normKey.length);
  const levenshteinScore = 1.0 - distance / maxLen;

  return Math.max(substringScore, levenshteinScore);
}
