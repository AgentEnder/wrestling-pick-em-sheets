"use client"

import type { PickEmSheet, Match, StandardMatch, BattleRoyalMatch, BonusQuestion } from "@/lib/types"

interface PrintSheetProps {
  sheet: PickEmSheet
}

function formatDate(dateStr: string): string {
  if (!dateStr) return ""
  const d = new Date(dateStr + "T00:00:00")
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}

function BonusQuestionsBlock({ questions, defaultPoints }: { questions: BonusQuestion[]; defaultPoints: number }) {
  if (questions.length === 0) return null
  return (
    <div className="print-bonus-section">
      {questions.map((q) => {
        const qPts = q.points ?? defaultPoints
        return (
          <div key={q.id} className="print-bonus-q">
            <div className="flex items-baseline gap-1 flex-wrap">
              <span className="print-q-text">{q.question || "Bonus question"}</span>
              {q.answerType === "multiple-choice" && q.options.length > 0 ? (
                <span className="print-mc-options">
                  {q.options.map((opt, oi) => (
                    <span key={oi} className="print-mc-option">
                      <span className="print-checkbox" />
                      <span>{opt}</span>
                    </span>
                  ))}
                </span>
              ) : (
                <span className="print-write-line-inline" />
              )}
              <span className="print-score-field">__/{qPts}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function StandardMatchBlock({
  match,
  matchNumber,
  defaultPoints,
}: {
  match: StandardMatch
  matchNumber: number
  defaultPoints: number
}) {
  const pts = match.points ?? defaultPoints
  return (
    <div className="print-match-block">
      <div className="print-match-header-row">
        <span className="print-match-number">{matchNumber}.</span>
        <h3 className="print-match-title">{match.title || "Match"}</h3>
        <span className="print-score-field">__/{pts}</span>
      </div>
      {match.description && <p className="print-description">{match.description}</p>}
      <div className="print-participants-grid">
        {match.participants.map((p, i) => (
          <label key={i} className="print-participant">
            <span className="print-checkbox" />
            <span>{p}</span>
          </label>
        ))}
      </div>
      <BonusQuestionsBlock questions={match.bonusQuestions} defaultPoints={defaultPoints} />
    </div>
  )
}

function BattleRoyalBlock({
  match,
  matchNumber,
  defaultPoints,
}: {
  match: BattleRoyalMatch
  matchNumber: number
  defaultPoints: number
}) {
  const pts = match.points ?? defaultPoints
  const surprisePts = match.surprisePoints ?? defaultPoints
  const surpriseTotalPts = match.surpriseSlots * surprisePts
  return (
    <div className="print-match-block print-battle-royal">
      <div className="print-match-header-row">
        <span className="print-match-number">{matchNumber}.</span>
        <h3 className="print-match-title">{match.title || "Battle Royal"}</h3>
        <span className="print-score-field">__/{pts}</span>
      </div>
      {match.description && <p className="print-description">{match.description}</p>}
      <div className="print-br-layout">
        {/* Winner line */}
        <div className="print-br-winner">
          <span className="print-label-inline">Winner:</span>
          <span className="print-write-line-inline" />
        </div>
        {/* Announced list */}
        {match.announcedParticipants.length > 0 && (
          <div className="print-br-announced">
            <span className="print-label-inline">Announced:</span>
            <span className="print-br-names">{match.announcedParticipants.join(", ")}</span>
          </div>
        )}
        {/* Surprise guess lines */}
        {match.surpriseSlots > 0 && (
          <div className="print-br-surprises">
            <div className="print-match-header-row">
              <span className="print-label-inline">Guest spot guesses:</span>
              <span className="text-xs text-muted-foreground">({surprisePts} pts ea.)</span>
              <span className="print-score-field">__/{surpriseTotalPts}</span>
            </div>
            <div className="print-surprise-grid">
              {Array.from({ length: match.surpriseSlots }).map((_, i) => (
                <div key={i} className="print-surprise-line">
                  <span className="print-surprise-num">{i + 1}.</span>
                  <span className="print-write-line-inline" />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      <BonusQuestionsBlock questions={match.bonusQuestions} defaultPoints={defaultPoints} />
    </div>
  )
}

function MatchBlock({ match, matchNumber, defaultPoints }: { match: Match; matchNumber: number; defaultPoints: number }) {
  if (match.type === "battleRoyal") {
    return <BattleRoyalBlock match={match} matchNumber={matchNumber} defaultPoints={defaultPoints} />
  }
  return <StandardMatchBlock match={match} matchNumber={matchNumber} defaultPoints={defaultPoints} />
}

export function PrintSheet({ sheet }: PrintSheetProps) {
  const totalPoints = sheet.matches.reduce((sum, m) => {
    const matchPts = m.points ?? sheet.defaultPoints
    const bonusPts = m.bonusQuestions.reduce((s, q) => s + (q.points ?? sheet.defaultPoints), 0)
    const surprisePts =
      m.type === "battleRoyal"
        ? m.surpriseSlots * (m.surprisePoints ?? sheet.defaultPoints)
        : 0
    return sum + matchPts + bonusPts + surprisePts
  }, 0)

  return (
    <div className="print-sheet" id="print-target">
      {/* Compact header: event name left, name/meta right */}
      <header className="print-header">
        <div className="print-header-top">
          <div className="print-header-left">
            <h1 className="print-event-name">{sheet.eventName || "Event Name"}</h1>
            {sheet.eventTagline && <p className="print-tagline">{sheet.eventTagline}</p>}
          </div>
          <div className="print-header-right">
            <div className="print-name-field">
              <span className="print-label-inline">Name:</span>
              <span className="print-write-line-inline print-name-line" />
            </div>
            <div className="print-header-meta">
              {sheet.eventDate && <span>{formatDate(sheet.eventDate)}</span>}
              {sheet.eventDate && <span className="print-meta-sep">{"\u00B7"}</span>}
              <span>{totalPoints} pts possible</span>
            </div>
          </div>
        </div>
      </header>

      {/* Matches */}
      <div className="print-matches">
        {sheet.matches.map((match, i) => (
          <MatchBlock key={match.id} match={match} matchNumber={i + 1} defaultPoints={sheet.defaultPoints} />
        ))}
      </div>

      {/* Footer */}
      {sheet.tiebreakerLabel && sheet.tiebreakerLabel.trim() !== "" && (
        <footer className="print-footer">
          <div className="print-tiebreaker">
            <span className="print-label-inline">Tiebreaker &mdash; {sheet.tiebreakerLabel}:</span>
            <span className="print-write-line-inline print-tiebreaker-line" />
          </div>
        </footer>
      )}
    </div>
  )
}
