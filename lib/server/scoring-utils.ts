import type { ResolvedCard } from "@/lib/server/repositories/cards";
import type { BonusQuestion } from "@/lib/types";

function bonusQuestionPoints(
  questions: BonusQuestion[],
  defaultPoints: number,
): number {
  return questions.reduce((sum, q) => {
    const pts = q.points ?? defaultPoints;
    return pts > 0 ? sum + pts : sum;
  }, 0);
}

export function computeMaxPossiblePoints(card: ResolvedCard): number {
  let total = 0;

  for (const match of card.matches) {
    // Winner pick points
    const matchPoints = match.points ?? card.defaultPoints;
    if (matchPoints > 0) total += matchPoints;

    // Surprise entrant points (battle royal)
    if (match.isBattleRoyal && match.surpriseSlots > 0) {
      const surprisePointsEach =
        match.surpriseEntrantPoints ?? card.defaultPoints;
      if (surprisePointsEach > 0) {
        total += match.surpriseSlots * surprisePointsEach;
      }
    }

    // Match-level bonus questions
    total += bonusQuestionPoints(match.bonusQuestions, card.defaultPoints);
  }

  // Event-level bonus questions
  total += bonusQuestionPoints(card.eventBonusQuestions, card.defaultPoints);

  return total;
}
