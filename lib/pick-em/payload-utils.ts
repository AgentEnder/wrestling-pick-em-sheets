import type {
  CardLiveKeyPayload,
  LiveKeyAnswer,
  LiveKeyMatchResult,
} from "@/lib/types";
import { nowIso, toMatchBonusTimerId, toEventBonusTimerId } from "./timer-utils";

export function findMatchResult(
  payload: CardLiveKeyPayload,
  matchId: string,
): LiveKeyMatchResult | undefined {
  return payload.matchResults.find((result) => result.matchId === matchId);
}

export function findAnswer<T extends { questionId: string; answer: string }>(
  answers: T[],
  questionId: string,
): T | undefined {
  return answers.find((answer) => answer.questionId === questionId);
}

export function toLockKey(matchId: string, questionId: string): string {
  return `${matchId}:${questionId}`;
}

export function snapshotPayload(payload: CardLiveKeyPayload): string {
  return JSON.stringify(payload);
}

function ensureMatchResult(
  payload: CardLiveKeyPayload,
  matchId: string,
): { results: LiveKeyMatchResult[]; index: number } {
  const results = [...payload.matchResults];
  let index = results.findIndex((result) => result.matchId === matchId);

  if (index === -1) {
    results.push({
      matchId,
      winnerName: "",
      winnerRecordedAt: null,
      battleRoyalEntryOrder: [],
      bonusAnswers: [],
    });
    index = results.length - 1;
  }

  return { results, index };
}

export function updateMatchWinner(
  payload: CardLiveKeyPayload,
  matchId: string,
  winnerName: string,
): CardLiveKeyPayload {
  const { results, index } = ensureMatchResult(payload, matchId);
  results[index] = {
    ...results[index],
    winnerName,
    winnerRecordedAt: winnerName.trim() ? nowIso() : null,
  };
  return { ...payload, matchResults: results };
}

export function addBattleRoyalEntrant(
  payload: CardLiveKeyPayload,
  matchId: string,
  entrantName: string,
): CardLiveKeyPayload {
  const { results, index } = ensureMatchResult(payload, matchId);
  results[index] = {
    ...results[index],
    battleRoyalEntryOrder: [
      ...results[index].battleRoyalEntryOrder,
      entrantName,
    ],
  };
  return { ...payload, matchResults: results };
}

export function removeBattleRoyalEntrant(
  payload: CardLiveKeyPayload,
  matchId: string,
  entryIndex: number,
): CardLiveKeyPayload {
  const { results, index } = ensureMatchResult(payload, matchId);
  results[index] = {
    ...results[index],
    battleRoyalEntryOrder: results[index].battleRoyalEntryOrder.filter(
      (_, i) => i !== entryIndex,
    ),
  };
  return { ...payload, matchResults: results };
}

export function setBattleRoyalEntryOrder(
  payload: CardLiveKeyPayload,
  matchId: string,
  entryOrder: string[],
): CardLiveKeyPayload {
  const { results, index } = ensureMatchResult(payload, matchId);
  results[index] = {
    ...results[index],
    battleRoyalEntryOrder: entryOrder,
  };
  return { ...payload, matchResults: results };
}

export function updateMatchBonusAnswer(
  payload: CardLiveKeyPayload,
  matchId: string,
  questionId: string,
  answer: string,
  isTimeBased: boolean,
): CardLiveKeyPayload {
  const { results, index } = ensureMatchResult(payload, matchId);
  const existingResult = results[index];
  const nextAnswers = [...existingResult.bonusAnswers];
  const existingAnswerIndex = nextAnswers.findIndex(
    (item) => item.questionId === questionId,
  );
  const existingAnswer =
    existingAnswerIndex === -1 ? undefined : nextAnswers[existingAnswerIndex];
  const recordedAt = isTimeBased && answer.trim() ? nowIso() : null;
  const timerId = isTimeBased
    ? (existingAnswer?.timerId ?? toMatchBonusTimerId(matchId, questionId))
    : null;

  const newAnswer: LiveKeyAnswer = { questionId, answer, recordedAt, timerId };
  if (existingAnswerIndex === -1) {
    nextAnswers.push(newAnswer);
  } else {
    nextAnswers[existingAnswerIndex] = newAnswer;
  }

  results[index] = { ...existingResult, bonusAnswers: nextAnswers };
  return { ...payload, matchResults: results };
}

export function updateEventBonusAnswer(
  payload: CardLiveKeyPayload,
  questionId: string,
  answer: string,
  isTimeBased: boolean,
): CardLiveKeyPayload {
  const nextAnswers = [...payload.eventBonusAnswers];
  const existingIndex = nextAnswers.findIndex(
    (item) => item.questionId === questionId,
  );
  const existingAnswer =
    existingIndex === -1 ? undefined : nextAnswers[existingIndex];
  const recordedAt = isTimeBased && answer.trim() ? nowIso() : null;
  const timerId = isTimeBased
    ? (existingAnswer?.timerId ?? toEventBonusTimerId(questionId))
    : null;

  const newAnswer: LiveKeyAnswer = { questionId, answer, recordedAt, timerId };
  if (existingIndex === -1) {
    nextAnswers.push(newAnswer);
  } else {
    nextAnswers[existingIndex] = newAnswer;
  }

  return { ...payload, eventBonusAnswers: nextAnswers };
}
