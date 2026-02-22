"use client"

import type { PickEmSheet, Match, StandardMatch, BattleRoyalMatch } from "@/lib/types"

interface PrintSheetProps {
  sheet: PickEmSheet
}

function formatDate(dateStr: string): string {
  if (!dateStr) return ""
  const d = new Date(dateStr + "T00:00:00")
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  })
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
      <div className="flex items-baseline gap-2 mb-1">
        <span className="print-match-number">{matchNumber}</span>
        <h3 className="print-match-title">{match.title || "Match"}</h3>
        <span className="print-pts">{pts} pt{pts !== 1 ? "s" : ""}</span>
      </div>
      <div className="print-match-content">
        <p className="print-label">Pick the winner:</p>
        <div className="print-participants-grid">
          {match.participants.map((p, i) => (
            <label key={i} className="print-participant">
              <span className="print-checkbox" />
              <span>{p}</span>
            </label>
          ))}
        </div>
        {match.bonusQuestions.length > 0 && (
          <div className="print-bonus-section">
            {match.bonusQuestions.map((q, i) => {
              const qPts = q.points ?? defaultPoints
              return (
                <div key={q.id} className="print-bonus-q">
                  <div className="flex items-baseline gap-1">
                    <span className="print-label">Bonus ({qPts}pt{qPts !== 1 ? "s" : ""}):</span>
                    <span className="print-q-text">{q.question}</span>
                  </div>
                  <div className="print-write-line" />
                </div>
              )
            })}
          </div>
        )}
      </div>
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

  return (
    <div className="print-match-block print-battle-royal">
      <div className="flex items-baseline gap-2 mb-1">
        <span className="print-match-number">{matchNumber}</span>
        <h3 className="print-match-title">{match.title || "Battle Royal"}</h3>
        <span className="print-pts">{pts} pt{pts !== 1 ? "s" : ""}</span>
      </div>
      <div className="print-match-content">
        <p className="print-label">Winner pick:</p>
        <div className="print-write-line" />

        {match.announcedParticipants.length > 0 && (
          <div className="mt-1">
            <p className="print-label text-[7pt]">
              Announced ({match.announcedParticipants.length}):
              {" "}
              <span className="font-normal">
                {match.announcedParticipants.join(" \u2022 ")}
              </span>
            </p>
          </div>
        )}

        {match.surpriseSlots > 0 && (
          <div className="mt-1">
            <p className="print-label">Surprise entrant guesses:</p>
            <div className="print-surprise-grid">
              {Array.from({ length: match.surpriseSlots }).map((_, i) => (
                <div key={i} className="print-surprise-line">
                  <span className="print-surprise-num">{i + 1}.</span>
                  <div className="print-write-line-inline" />
                </div>
              ))}
            </div>
          </div>
        )}

        {match.bonusQuestions.length > 0 && (
          <div className="print-bonus-section">
            {match.bonusQuestions.map((q) => {
              const qPts = q.points ?? defaultPoints
              return (
                <div key={q.id} className="print-bonus-q">
                  <div className="flex items-baseline gap-1">
                    <span className="print-label">Bonus ({qPts}pt{qPts !== 1 ? "s" : ""}):</span>
                    <span className="print-q-text">{q.question}</span>
                  </div>
                  <div className="print-write-line" />
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function MatchBlock({
  match,
  matchNumber,
  defaultPoints,
}: {
  match: Match
  matchNumber: number
  defaultPoints: number
}) {
  if (match.type === "battleRoyal") {
    return (
      <BattleRoyalBlock
        match={match}
        matchNumber={matchNumber}
        defaultPoints={defaultPoints}
      />
    )
  }
  return (
    <StandardMatchBlock
      match={match}
      matchNumber={matchNumber}
      defaultPoints={defaultPoints}
    />
  )
}

export function PrintSheet({ sheet }: PrintSheetProps) {
  const totalPoints = sheet.matches.reduce((sum, m) => {
    const matchPts = m.points ?? sheet.defaultPoints
    const bonusPts = m.bonusQuestions.reduce(
      (s, q) => s + (q.points ?? sheet.defaultPoints),
      0
    )
    return sum + matchPts + bonusPts
  }, 0)

  return (
    <div className="print-sheet" id="print-target">
      {/* Header */}
      <header className="print-header">
        <div className="print-header-content">
          <h1 className="print-event-name">
            {sheet.eventName || "Event Name"}
          </h1>
          {sheet.eventTagline && (
            <p className="print-tagline">{sheet.eventTagline}</p>
          )}
          <div className="print-meta">
            {sheet.eventDate && (
              <span>{formatDate(sheet.eventDate)}</span>
            )}
            <span className="print-meta-sep">{"\u2022"}</span>
            <span>Total Points: {totalPoints}</span>
          </div>
        </div>
        <div className="print-name-field">
          <span className="print-label">Name:</span>
          <div className="print-write-line-inline print-name-line" />
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
      </div>

      {/* Footer */}
      <footer className="print-footer">
        <div className="print-tiebreaker">
          <span className="print-label">Tiebreaker &mdash; Total match time of the main event (mins):</span>
          <div className="print-write-line-inline print-tiebreaker-line" />
        </div>
      </footer>
    </div>
  )
}
