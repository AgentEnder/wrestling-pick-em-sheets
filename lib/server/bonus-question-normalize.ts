import type { BonusQuestion } from "@/lib/types";

export function normalizeBonusQuestionForWrite(
  q: BonusQuestion,
): BonusQuestion {
  if (q.answerType === "threshold") {
    const { gradingRule: _drop, ...rest } = q;
    return rest;
  }
  return q;
}
