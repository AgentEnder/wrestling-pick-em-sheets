"use client";

import type { BonusQuestion, Match, PickEmSheet } from "@/lib/types";
import type { CSSProperties } from "react";

interface PrintSheetProps {
  sheet: PickEmSheet;
}

const BATTLE_ROYAL_CHECKBOX_THRESHOLD = 10;

function formatDate(dateStr: string): string {
  if (!dateStr) return "";

  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr.trim())) {
    const d = new Date(`${dateStr}T00:00:00`);
    return d.toLocaleDateString("en-US", {
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }

  const parsed = new Date(dateStr);
  if (Number.isNaN(parsed.getTime())) return "";

  return parsed.toLocaleString("en-US", {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

function formatPointsLabel(points: number): string {
  return `${points} pt${points === 1 ? "" : "s"}`;
}

function shouldRenderCompactBattleRoyal(match: Match): boolean {
  if (!match.isBattleRoyal) return false;

  const totalCompetitors = match.participants.length;
  return (
    totalCompetitors > 0 && totalCompetitors <= BATTLE_ROYAL_CHECKBOX_THRESHOLD
  );
}

function getMatchTotalPoints(match: Match, defaultPoints: number): number {
  const primaryPoints = match.points ?? defaultPoints;
  const bonusPoints = match.bonusQuestions.reduce(
    (sum, q) => sum + (q.points ?? defaultPoints),
    0,
  );
  const surprisePoints = match.isBattleRoyal
    ? match.surpriseSlots * (match.surpriseEntrantPoints ?? defaultPoints)
    : 0;
  return primaryPoints + bonusPoints + surprisePoints;
}

function BonusQuestionsBlock({
  questions,
  defaultPoints,
}: {
  questions: BonusQuestion[];
  defaultPoints: number;
}) {
  if (questions.length === 0) return null;
  return (
    <div className="print-bonus-section">
      {questions.map((q) => {
        const qPts = q.points ?? defaultPoints;
        return (
          <div key={q.id} className="print-bonus-q">
            <div className="print-bonus-q-row">
              <div className="print-bonus-main">
                <span className="print-q-text">
                  {q.question || "Bonus question"}
                </span>
                {q.answerType === "multiple-choice" && q.options.length > 0 ? (
                  <span className="print-mc-options">
                    {q.options.map((opt, oi) => (
                      <span key={oi} className="print-mc-option">
                        <span className="print-checkbox" />
                        <span>{opt}</span>
                      </span>
                    ))}
                  </span>
                ) : q.answerType === "threshold" ? (
                  <span className="print-mc-options">
                    {(q.thresholdLabels ?? ["Over", "Under"]).map(
                      (label, li) => (
                        <span key={li} className="print-mc-option">
                          <span className="print-checkbox" />
                          <span>{label}</span>
                        </span>
                      ),
                    )}
                  </span>
                ) : (
                  <span className="print-write-line-inline" />
                )}
              </div>
              <span className="print-question-points">
                {formatPointsLabel(qPts)}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function EventBonusSection({
  questions,
  defaultPoints,
}: {
  questions: BonusQuestion[];
  defaultPoints: number;
}) {
  if (questions.length === 0) return null;

  const totalPts = questions.reduce(
    (sum, question) => sum + (question.points ?? defaultPoints),
    0,
  );

  return (
    <div className="print-match-block">
      <div className="print-match-grid-row print-match-header-row">
        <div className="print-match-header-main">
          <h3 className="print-match-title">Event Bonus Questions</h3>
        </div>
        <span className="print-score-field">__/{totalPts}</span>
      </div>
      <BonusQuestionsBlock
        questions={questions}
        defaultPoints={defaultPoints}
      />
    </div>
  );
}

function StandardMatchBlock({
  match,
  matchNumber,
  defaultPoints,
}: {
  match: Match;
  matchNumber: number;
  defaultPoints: number;
}) {
  const winnerPts = match.points ?? defaultPoints;
  const totalPts = getMatchTotalPoints(match, defaultPoints);
  return (
    <div className="print-match-block">
      <div className="print-match-grid-row print-match-header-row">
        <div className="print-match-header-main">
          <span className="print-match-number">{matchNumber}.</span>
          <h3 className="print-match-title">{match.title || "Match"}</h3>
        </div>
        <span className="print-score-field">__/{totalPts}</span>
      </div>
      <div className="print-match-grid-row print-match-pick-row">
        <div className="print-match-pick-main">
          {match.description && (
            <p className="print-description">{match.description}</p>
          )}
          {match.isEliminationStyle && (
            <p className="print-description">Elimination rules apply.</p>
          )}
          <div className="print-participants-grid">
            {match.participants.map((p, i) => (
              <label key={i} className="print-participant">
                <span className="print-checkbox" />
                <span>{p}</span>
              </label>
            ))}
          </div>
        </div>
        <span className="print-question-points">
          {formatPointsLabel(winnerPts)}
        </span>
      </div>
      <BonusQuestionsBlock
        questions={match.bonusQuestions}
        defaultPoints={defaultPoints}
      />
    </div>
  );
}

function BattleRoyalBlock({
  match,
  matchNumber,
  defaultPoints,
}: {
  match: Match;
  matchNumber: number;
  defaultPoints: number;
}) {
  const winnerPts = match.points ?? defaultPoints;
  const surpriseEntrantPoints = match.surpriseEntrantPoints ?? defaultPoints;
  const totalPts = getMatchTotalPoints(match, defaultPoints);
  const useCompactBattleRoyal = shouldRenderCompactBattleRoyal(match);
  return (
    <div className="print-match-block print-battle-royal">
      <div className="print-match-grid-row print-match-header-row">
        <div className="print-match-header-main">
          <span className="print-match-number">{matchNumber}.</span>
          <h3 className="print-match-title">{match.title || "Battle Royal"}</h3>
        </div>
        <span className="print-score-field">__/{totalPts}</span>
      </div>
      <div className="print-match-grid-row print-match-pick-row">
        <div className="print-match-pick-main">
          {match.description && (
            <p className="print-description">{match.description}</p>
          )}
          {match.isEliminationStyle && (
            <p className="print-description">Elimination rules apply.</p>
          )}
          <div className="print-br-layout">
            {useCompactBattleRoyal ? (
              <div className="print-br-compact">
                <span className="print-label-inline">Winner:</span>
                <div className="print-participants-grid">
                  {match.participants.map((participant, participantIndex) => (
                    <label
                      key={`announced:${participantIndex}`}
                      className="print-participant"
                    >
                      <span className="print-checkbox" />
                      <span>{participant}</span>
                    </label>
                  ))}
                </div>
              </div>
            ) : (
              <>
                {/* Winner line */}
                <div className="print-br-winner">
                  <span className="print-label-inline">Winner:</span>
                  <span className="print-write-line-inline" />
                </div>
                {/* Announced list */}
                {match.participants.length > 0 && (
                  <div className="print-br-announced">
                    <span className="print-label-inline">Announced:</span>
                    <span className="print-br-names">
                      {match.participants.join(", ")}
                    </span>
                  </div>
                )}
              </>
            )}
            {/* Surprise guess lines */}
            {match.surpriseSlots > 0 && (
              <div className="print-br-surprises">
                <span className="print-label-inline">
                  Surprise guesses ({formatPointsLabel(surpriseEntrantPoints)}{" "}
                  each, check winner):
                </span>
                <div className="print-surprise-grid">
                  {Array.from({ length: match.surpriseSlots }).map((_, i) => (
                    <div key={i} className="print-surprise-line">
                      <span className="print-checkbox" />
                      <span className="print-surprise-num">{i + 1}.</span>
                      <span className="print-write-line-inline" />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
        <span className="print-question-points">
          {formatPointsLabel(winnerPts)}
        </span>
      </div>
      <BonusQuestionsBlock
        questions={match.bonusQuestions}
        defaultPoints={defaultPoints}
      />
    </div>
  );
}

function MatchBlock({
  match,
  matchNumber,
  defaultPoints,
}: {
  match: Match;
  matchNumber: number;
  defaultPoints: number;
}) {
  if (match.isBattleRoyal) {
    return (
      <BattleRoyalBlock
        match={match}
        matchNumber={matchNumber}
        defaultPoints={defaultPoints}
      />
    );
  }
  return (
    <StandardMatchBlock
      match={match}
      matchNumber={matchNumber}
      defaultPoints={defaultPoints}
    />
  );
}

type PrintDensity = "sparse" | "normal" | "dense";

function getQuestionComplexity(question: BonusQuestion): number {
  if (
    question.answerType === "multiple-choice" &&
    question.options.length > 0
  ) {
    return 1.2 + question.options.length * 0.2;
  }
  return 1.1;
}

function getMatchComplexity(match: Match): number {
  const base = 5;
  const descriptionCost = (match.description ?? "").trim() ? 0.8 : 0;
  const bonusCost = match.bonusQuestions.reduce(
    (sum, q) => sum + getQuestionComplexity(q),
    0,
  );

  if (match.isBattleRoyal) {
    const useCompactBattleRoyal = shouldRenderCompactBattleRoyal(match);

    if (useCompactBattleRoyal) {
      const winnerOptionsCost =
        (match.participants.length + match.surpriseSlots) * 0.9;
      const surpriseCost = match.surpriseSlots * 0.85;
      return (
        base + descriptionCost + bonusCost + winnerOptionsCost + surpriseCost
      );
    }

    const announcedCost = match.participants.length * 0.35;
    const surpriseCost = match.surpriseSlots * 1.05;
    return (
      base + descriptionCost + bonusCost + 2 + announcedCost + surpriseCost
    );
  }

  const participantsCost = match.participants.length * 0.9;
  return base + descriptionCost + bonusCost + participantsCost;
}

function getPrintDensity(sheet: PickEmSheet): PrintDensity {
  const score = sheet.matches.reduce(
    (sum, match) => sum + getMatchComplexity(match),
    0,
  );
  const eventBonusScore = sheet.eventBonusQuestions.reduce(
    (sum, question) => sum + getQuestionComplexity(question),
    0,
  );
  const footerCost = (sheet.tiebreakerLabel ?? "").trim() ? 1.5 : 0;
  const taglineCost = (sheet.eventTagline ?? "").trim() ? 0.4 : 0;
  const totalScore = score + eventBonusScore + footerCost + taglineCost;

  if (totalScore <= 48) return "sparse";
  if (totalScore >= 68) return "dense";
  return "normal";
}

function getMatchLineUnits(match: Match): number {
  const descriptionUnits = (match.description ?? "").trim() ? 0.9 : 0;
  const bonusUnits = match.bonusQuestions.reduce((sum, question) => {
    const mcUnits =
      question.answerType === "multiple-choice"
        ? Math.max(1, Math.ceil(question.options.length / 3.5))
        : 1;
    return sum + mcUnits;
  }, 0);

  if (match.isBattleRoyal) {
    const useCompactBattleRoyal = shouldRenderCompactBattleRoyal(match);
    if (useCompactBattleRoyal) {
      const winnerOptionsUnits = Math.max(
        1,
        Math.ceil(match.participants.length / 4.5),
      );
      const surpriseUnits =
        match.surpriseSlots > 0 ? Math.ceil(match.surpriseSlots / 3) : 0;
      return (
        1.5 + descriptionUnits + winnerOptionsUnits + surpriseUnits + bonusUnits
      );
    }

    const announcedUnits =
      match.participants.length > 0
        ? Math.max(1, Math.ceil(match.participants.length / 8))
        : 0;
    const surpriseUnits =
      match.surpriseSlots > 0 ? Math.ceil(match.surpriseSlots / 3) : 0;
    return (
      1.5 + descriptionUnits + 1.2 + announcedUnits + surpriseUnits + bonusUnits
    );
  }

  const participantUnits = Math.max(
    1,
    Math.ceil(match.participants.length / 4.5),
  );
  return 1.5 + descriptionUnits + participantUnits + bonusUnits;
}

function getEventBonusLineUnits(sheet: PickEmSheet): number {
  if (sheet.eventBonusQuestions.length === 0) return 0;

  const baseUnits = 1.2;
  const questionUnits = sheet.eventBonusQuestions.reduce((sum, question) => {
    const mcUnits =
      question.answerType === "multiple-choice"
        ? Math.max(1, Math.ceil(question.options.length / 3.5))
        : 1;
    return sum + mcUnits;
  }, 0);

  return baseUnits + questionUnits;
}

function getSparseExpansionVars(sheet: PickEmSheet): CSSProperties {
  const sheetHeightPx = 10.4 * 96;
  const matchCount = Math.max(1, sheet.matches.length);
  const lineUnits = sheet.matches.reduce(
    (sum, match) => sum + getMatchLineUnits(match),
    0,
  );
  const eventBonusUnits = getEventBonusLineUnits(sheet);
  const headerUnits = (sheet.eventTagline ?? "").trim() ? 6.8 : 5.7;
  const footerUnits = (sheet.tiebreakerLabel ?? "").trim() ? 2.7 : 0.8;
  const estimatedUsedPx =
    (lineUnits + eventBonusUnits + headerUnits + footerUnits) * 11.8 +
    matchCount * 8;
  const leftoverPx = Math.max(
    0,
    Math.min(420, sheetHeightPx - estimatedUsedPx),
  );

  const lineGapPx = Math.max(
    0,
    Math.min(7, leftoverPx / Math.max(24, lineUnits * 2.1)),
  );
  const matchGapPx = Math.max(
    0,
    Math.min(16, leftoverPx / Math.max(10, matchCount * 3.8)),
  );
  const blockPadPx = Math.max(0, Math.min(6, lineGapPx * 0.85));
  const lineHeightPx = Math.max(0, Math.min(5, lineGapPx * 1.25));
  const participantBumpPt = Math.max(0, Math.min(2.2, leftoverPx / 210));
  const titleBumpPt = Math.max(0, Math.min(2, participantBumpPt * 0.85));
  const eventBumpPt = Math.max(0, Math.min(2.8, leftoverPx / 165));
  const checkboxBumpPx = Math.max(0, Math.min(2.5, lineGapPx * 0.45));

  return {
    "--print-dyn-match-gap": `${matchGapPx.toFixed(2)}px`,
    "--print-dyn-block-pad": `${blockPadPx.toFixed(2)}px`,
    "--print-dyn-line-gap": `${lineGapPx.toFixed(2)}px`,
    "--print-dyn-line-height": `${lineHeightPx.toFixed(2)}px`,
    "--print-dyn-font-bump": `${participantBumpPt.toFixed(2)}pt`,
    "--print-dyn-title-bump": `${titleBumpPt.toFixed(2)}pt`,
    "--print-dyn-event-bump": `${eventBumpPt.toFixed(2)}pt`,
    "--print-dyn-checkbox-bump": `${checkboxBumpPx.toFixed(2)}px`,
  } as CSSProperties;
}

export function PrintSheet({ sheet }: PrintSheetProps) {
  const density = getPrintDensity(sheet);
  const printSheetStyle =
    density === "sparse" ? getSparseExpansionVars(sheet) : undefined;
  const totalPoints =
    sheet.matches.reduce((sum, m) => {
      return sum + getMatchTotalPoints(m, sheet.defaultPoints);
    }, 0) +
    sheet.eventBonusQuestions.reduce((sum, question) => {
      return sum + (question.points ?? sheet.defaultPoints);
    }, 0);

  return (
    <div
      className="print-sheet"
      id="print-target"
      data-density={density}
      style={printSheetStyle}
    >
      {/* Compact header: event name left, name/meta right */}
      <header className="print-header">
        <div className="print-header-top">
          <div className="print-header-left">
            <h1 className="print-event-name">
              {sheet.eventName || "Event Name"}
            </h1>
            {sheet.eventTagline && (
              <p className="print-tagline">{sheet.eventTagline}</p>
            )}
          </div>
          <div className="print-header-right">
            <div className="print-name-field">
              <span className="print-label-inline">Name:</span>
              <span className="print-write-line-inline print-name-line" />
            </div>
            <div className="print-header-meta">
              {sheet.eventDate && <span>{formatDate(sheet.eventDate)}</span>}
              {sheet.eventDate && (
                <span className="print-meta-sep">{"\u00B7"}</span>
              )}
              <span>{totalPoints} pts possible</span>
            </div>
          </div>
        </div>
      </header>

      {/* Matches */}
      <div className="print-matches">
        {sheet.matches.map((match, i) => (
          <MatchBlock
            key={match.id}
            match={match}
            matchNumber={i + 1}
            defaultPoints={sheet.defaultPoints}
          />
        ))}
        <EventBonusSection
          questions={sheet.eventBonusQuestions}
          defaultPoints={sheet.defaultPoints}
        />
      </div>

      {/* Footer */}
      {sheet.tiebreakerLabel && sheet.tiebreakerLabel.trim() !== "" && (
        <footer className="print-footer">
          <div className="print-tiebreaker">
            <span className="print-label-inline">
              Tiebreaker &mdash; {sheet.tiebreakerLabel}:
            </span>
            <span className="print-write-line-inline print-tiebreaker-line" />
          </div>
        </footer>
      )}
    </div>
  );
}
