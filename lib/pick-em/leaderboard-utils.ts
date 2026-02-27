import type { LiveGameLeaderboardEntry } from "@/lib/types";

interface LeaderboardState {
  leaderboard: LiveGameLeaderboardEntry[];
}

export function hasLeaderboardChanged(
  previous: LeaderboardState,
  next: LeaderboardState,
): boolean {
  if (previous.leaderboard.length !== next.leaderboard.length) return true;
  for (let index = 0; index < next.leaderboard.length; index += 1) {
    const prior = previous.leaderboard[index];
    const current = next.leaderboard[index];
    if (!prior || !current) return true;
    if (prior.nickname !== current.nickname) return true;
    if (prior.rank !== current.rank) return true;
    if (prior.score !== current.score) return true;
  }
  return false;
}

export function buildBubbleSortSteps(
  previous: string[],
  current: string[],
): string[][] {
  const currentSet = new Set(current);
  const start = [
    ...previous.filter((name) => currentSet.has(name)),
    ...current.filter((name) => !previous.includes(name)),
  ];
  const steps: string[][] = [start];
  const working = [...start];
  const targetIndex = new Map(current.map((name, index) => [name, index]));

  for (let outer = 0; outer < working.length; outer += 1) {
    let swapped = false;
    for (let inner = 0; inner < working.length - 1; inner += 1) {
      const left = working[inner];
      const right = working[inner + 1];
      if (
        (targetIndex.get(left) ?? Infinity) <=
        (targetIndex.get(right) ?? Infinity)
      )
        continue;
      working[inner] = right;
      working[inner + 1] = left;
      steps.push([...working]);
      swapped = true;
    }
    if (!swapped) break;
  }

  const finalOrder = steps[steps.length - 1];
  if (
    finalOrder.length !== current.length ||
    finalOrder.some((name, index) => name !== current[index])
  ) {
    steps.push([...current]);
  }

  return steps;
}
