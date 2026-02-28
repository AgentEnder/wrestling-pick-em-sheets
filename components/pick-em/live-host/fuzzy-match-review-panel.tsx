"use client";

import React from "react";

import { computeFuzzyConfidence } from "@/lib/fuzzy-match";
import { normalizeText } from "@/lib/pick-em/text-utils";

/* ---- Constants ---- */

const FUZZY_REVIEW_THRESHOLD = 0.6;
const FUZZY_AUTO_THRESHOLD = 0.9;

/* ---- Types ---- */

export interface FuzzyCandidate {
  playerNickname: string;
  normalizedNickname: string;
  playerAnswer: string;
  confidence: number;
  isAutoAccepted: boolean;
}

/* ---- Exported helpers (used by auto-accept effect in the shell) ---- */

export { FUZZY_AUTO_THRESHOLD, FUZZY_REVIEW_THRESHOLD };

export function computeFuzzyCandidatesForAnswer(
  keyAnswer: string,
  playerAnswers: Array<{
    nickname: string;
    normalizedNickname: string;
    answer: string;
  }>,
  existingOverrides: Array<{ playerNickname: string; accepted: boolean }>,
): FuzzyCandidate[] {
  if (!keyAnswer.trim()) return [];

  const candidates: FuzzyCandidate[] = [];

  for (const pa of playerAnswers) {
    if (!pa.answer.trim()) continue;

    const normKey = normalizeText(keyAnswer);
    const normPlayer = normalizeText(pa.answer);
    if (normKey === normPlayer) continue;

    const hasOverride = existingOverrides.some(
      (o) => normalizeText(o.playerNickname) === pa.normalizedNickname,
    );
    if (hasOverride) continue;

    const confidence = computeFuzzyConfidence(pa.answer, keyAnswer);
    if (confidence >= FUZZY_REVIEW_THRESHOLD) {
      candidates.push({
        playerNickname: pa.nickname,
        normalizedNickname: pa.normalizedNickname,
        playerAnswer: pa.answer,
        confidence,
        isAutoAccepted: confidence >= FUZZY_AUTO_THRESHOLD,
      });
    }
  }

  return candidates.sort((a, b) => b.confidence - a.confidence);
}

/* ---- FuzzyReviewPanel (presentational) ---- */

interface FuzzyReviewPanelProps {
  candidates: FuzzyCandidate[];
  onAccept: (normalizedNickname: string) => void;
  onReject: (normalizedNickname: string) => void;
}

function FuzzyReviewPanelInner({
  candidates,
  onAccept,
  onReject,
}: FuzzyReviewPanelProps) {
  if (candidates.length === 0) return null;

  return (
    <div className="mt-2 space-y-1.5 rounded-md border border-amber-500/30 bg-amber-500/5 p-2">
      <p className="text-xs font-medium text-amber-600">Fuzzy Matches</p>
      {candidates.map((c) => (
        <div
          key={c.normalizedNickname}
          className="flex items-center justify-between gap-2 text-xs"
        >
          <span className="min-w-0 truncate">
            <span className="font-medium">{c.playerNickname}</span>
            {" answered "}
            <span className="italic">&ldquo;{c.playerAnswer}&rdquo;</span>
            {" \u2014 "}
            <span className="font-mono">
              {Math.round(c.confidence * 100)}%
            </span>
            {c.isAutoAccepted ? (
              <span className="ml-1 text-emerald-600">(auto)</span>
            ) : null}
          </span>
          <div className="flex shrink-0 gap-1">
            <button
              type="button"
              onClick={() => onAccept(c.normalizedNickname)}
              className="rounded bg-emerald-600 px-2 py-0.5 text-white hover:bg-emerald-700"
            >
              &#10003;
            </button>
            <button
              type="button"
              onClick={() => onReject(c.normalizedNickname)}
              className="rounded bg-red-600 px-2 py-0.5 text-white hover:bg-red-700"
            >
              &#10007;
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

export const FuzzyReviewPanel = React.memo(FuzzyReviewPanelInner);
