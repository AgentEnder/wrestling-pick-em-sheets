"use client";

import React from "react";

import type { ResolvedCard } from "@/lib/client/cards-api";
import type {
  BreakdownRow,
  LiveGameLeaderboardEntry,
} from "@/lib/types";

interface ScoreBreakdownProps {
  card: ResolvedCard;
  leaderboard: LiveGameLeaderboardEntry[];
  selectedNicknames: string[];
  meNickname: string | null;
}

interface CanonicalRow {
  key: string;
  label: string;
  order: number;
  scoresByNickname: Map<string, number>;
}

function rowKeyFor(row: BreakdownRow): string {
  switch (row.kind) {
    case "match-winner":
      return `match-winner:${row.matchId}`;
    case "match-bonus":
      return `match-bonus:${row.matchId}:${row.questionId}`;
    case "event-bonus":
      return `event-bonus:${row.questionId}`;
    case "match-surprise":
      return `match-surprise:${row.matchId}:${row.entrantName}`;
  }
}

function labelAndOrderFor(
  row: BreakdownRow,
  card: ResolvedCard,
): { label: string; order: number } {
  switch (row.kind) {
    case "match-winner": {
      const idx = card.matches.findIndex((m) => m.id === row.matchId);
      return { label: `Match ${idx + 1} Winner`, order: idx * 1000 };
    }
    case "match-surprise": {
      const idx = card.matches.findIndex((m) => m.id === row.matchId);
      return {
        label: `Match ${idx + 1} Surprise — ${row.entrantName}`,
        order: idx * 1000 + 100,
      };
    }
    case "match-bonus": {
      const idx = card.matches.findIndex((m) => m.id === row.matchId);
      const match = card.matches[idx];
      const q = match?.bonusQuestions.find((q) => q.id === row.questionId);
      const qIdx =
        match?.bonusQuestions.findIndex((q) => q.id === row.questionId) ?? 0;
      return { label: q?.question ?? "(unknown)", order: idx * 1000 + 200 + qIdx };
    }
    case "event-bonus": {
      const qIdx = card.eventBonusQuestions.findIndex(
        (q) => q.id === row.questionId,
      );
      const q = card.eventBonusQuestions[qIdx];
      return { label: q?.question ?? "(unknown)", order: 1_000_000 + qIdx };
    }
  }
}

function canonicalize(
  leaderboard: LiveGameLeaderboardEntry[],
  card: ResolvedCard,
): CanonicalRow[] {
  const map = new Map<string, CanonicalRow>();
  for (const entry of leaderboard) {
    for (const row of entry.breakdown.perQuestion) {
      const k = rowKeyFor(row);
      if (!map.has(k)) {
        const { label, order } = labelAndOrderFor(row, card);
        map.set(k, { key: k, label, order, scoresByNickname: new Map() });
      }
      map.get(k)!.scoresByNickname.set(entry.nickname, row.score);
    }
  }
  return Array.from(map.values()).sort((a, b) => a.order - b.order);
}

function formatCell(score: number | undefined): string {
  if (score === undefined || score === 0) return "—";
  return `+${score}`;
}

function ScoreBreakdownInner({
  card,
  leaderboard,
  selectedNicknames,
  meNickname,
}: ScoreBreakdownProps) {
  const selected = leaderboard.filter((e) =>
    selectedNicknames.includes(e.nickname),
  );
  const rows = canonicalize(selected, card);

  if (rows.length === 0) {
    return (
      <div>
        <p className="py-6 text-center text-sm text-muted-foreground">
          Score breakdown will appear here as answers are revealed.
        </p>
      </div>
    );
  }

  const columnHeader = (nickname: string) =>
    meNickname && nickname === meNickname ? "Me" : nickname;
  const totals = new Map<string, number>();
  for (const nick of selectedNicknames) {
    const entry = leaderboard.find((e) => e.nickname === nick);
    totals.set(nick, entry?.score ?? 0);
  }

  return (
    <div>
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-card px-3 py-2 text-left font-semibold">
                Question
              </th>
              {selectedNicknames.map((nick) => (
                <th key={nick} className="px-3 py-2 text-right font-semibold">
                  {columnHeader(nick)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-t border-border/40">
                <td className="sticky left-0 z-10 bg-card px-3 py-2">
                  {row.label}
                </td>
                {selectedNicknames.map((nick) => (
                  <td
                    key={nick}
                    className="px-3 py-2 text-right font-mono"
                  >
                    {formatCell(row.scoresByNickname.get(nick))}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="sticky bottom-0 bg-card">
              <td className="sticky left-0 z-10 bg-card px-3 py-2 font-semibold">
                Total
              </td>
              {selectedNicknames.map((nick) => (
                <td
                  key={nick}
                  className="px-3 py-2 text-right font-mono font-semibold"
                >
                  {totals.get(nick) ?? 0}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
      {/* Mobile: card list */}
      <div className="md:hidden space-y-3">
        <div className="rounded-lg border border-border/70 bg-card/80 px-3 py-2">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Totals
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {selectedNicknames.map((nick) => (
              <span key={nick} className="font-mono">
                {columnHeader(nick)}: <strong>{totals.get(nick) ?? 0}</strong>
              </span>
            ))}
          </div>
        </div>
        {rows.map((row) => (
          <div
            key={row.key}
            className="rounded-lg border border-border/70 bg-card/90 p-3 shadow-sm"
          >
            <div className="font-medium">{row.label}</div>
            <ul className="mt-2 space-y-1 text-sm">
              {selectedNicknames.map((nick) => (
                <li
                  key={nick}
                  className="flex items-center justify-between"
                >
                  <span className="text-muted-foreground">
                    {columnHeader(nick)}
                  </span>
                  <span className="font-mono">
                    {formatCell(row.scoresByNickname.get(nick))}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

export const ScoreBreakdown = React.memo(ScoreBreakdownInner);
