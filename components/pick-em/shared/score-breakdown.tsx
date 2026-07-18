"use client";

import React from "react";

import type { ResolvedCard } from "@/lib/client/cards-api";
import {
  EVENT_BUCKET_KEY,
  OTHER_BUCKET_KEY,
  bucketKeyForRow,
  buildMatchGroups,
  buildSectionIdByMatchId,
  sectionDisplayName,
} from "@/lib/pick-em/section-utils";
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
  groupKey: string;
  scoresByNickname: Map<string, number>;
}

interface RowGroup {
  key: string;
  /** null = card has no sections; render without header/subtotal. */
  label: string | null;
  rows: CanonicalRow[];
  subtotalsByNickname: Map<string, number>;
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
  displayIndexByMatchId: Map<string, number>,
): { label: string; order: number } {
  switch (row.kind) {
    case "match-winner": {
      const idx = displayIndexByMatchId.get(row.matchId) ?? -1;
      return { label: `Match ${idx + 1} Winner`, order: idx * 1000 };
    }
    case "match-surprise": {
      const idx = displayIndexByMatchId.get(row.matchId) ?? -1;
      return {
        label: `Match ${idx + 1} Surprise — ${row.entrantName}`,
        order: idx * 1000 + 100,
      };
    }
    case "match-bonus": {
      const idx = displayIndexByMatchId.get(row.matchId) ?? -1;
      const match = card.matches.find((m) => m.id === row.matchId);
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

function groupLabelFor(groupKey: string, card: ResolvedCard): string {
  if (groupKey === OTHER_BUCKET_KEY) return "Other Matches";
  if (groupKey === EVENT_BUCKET_KEY) return "Event Bonuses";
  const index = card.sections.findIndex((section) => section.id === groupKey);
  const section = card.sections[index];
  return section ? sectionDisplayName(section, index) : "Section";
}

function canonicalize(
  leaderboard: LiveGameLeaderboardEntry[],
  card: ResolvedCard,
): RowGroup[] {
  const hasSections = card.sections.length > 0;
  const sectionIdByMatchId = buildSectionIdByMatchId(card);
  const orderedMatches = buildMatchGroups(card).flatMap(
    (group) => group.matches,
  );
  const displayIndexByMatchId = new Map(
    orderedMatches.map((match, index) => [match.id, index]),
  );

  const map = new Map<string, CanonicalRow>();
  for (const entry of leaderboard) {
    for (const row of entry.breakdown.perQuestion) {
      const k = rowKeyFor(row);
      if (!map.has(k)) {
        const { label, order } = labelAndOrderFor(
          row,
          card,
          displayIndexByMatchId,
        );
        map.set(k, {
          key: k,
          label,
          order,
          groupKey: bucketKeyForRow(row, sectionIdByMatchId) ?? OTHER_BUCKET_KEY,
          scoresByNickname: new Map(),
        });
      }
      map.get(k)!.scoresByNickname.set(entry.nickname, row.score);
    }
  }

  const rows = Array.from(map.values()).sort((a, b) => a.order - b.order);
  if (rows.length === 0) return [];

  if (!hasSections) {
    return [
      {
        key: "all",
        label: null,
        rows,
        subtotalsByNickname: new Map(),
      },
    ];
  }

  // Bucket order mirrors computeSectionScores: unsectioned matches first,
  // sections in card order, event bonuses last. Empty groups are skipped.
  const groupOrder = [
    OTHER_BUCKET_KEY,
    ...card.sections.map((section) => section.id),
    EVENT_BUCKET_KEY,
  ];

  const groups: RowGroup[] = [];
  for (const groupKey of groupOrder) {
    const groupRows = rows.filter((row) => row.groupKey === groupKey);
    if (groupRows.length === 0) continue;

    const subtotals = new Map<string, number>();
    for (const row of groupRows) {
      for (const [nickname, score] of row.scoresByNickname) {
        subtotals.set(nickname, (subtotals.get(nickname) ?? 0) + score);
      }
    }

    groups.push({
      key: groupKey,
      label: groupLabelFor(groupKey, card),
      rows: groupRows,
      subtotalsByNickname: subtotals,
    });
  }

  return groups;
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
  const groups = canonicalize(selected, card);

  if (groups.length === 0) {
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

  const columnCount = selectedNicknames.length + 1;

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
            {groups.map((group) => (
              <React.Fragment key={group.key}>
                {group.label !== null ? (
                  <tr className="border-t border-border/40">
                    <td
                      colSpan={columnCount}
                      className="sticky left-0 z-10 bg-secondary/50 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-primary"
                    >
                      {group.label}
                    </td>
                  </tr>
                ) : null}
                {group.rows.map((row) => (
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
                {group.label !== null ? (
                  <tr className="border-t border-border/40">
                    <td className="sticky left-0 z-10 bg-card px-3 py-1.5 text-xs font-semibold text-muted-foreground">
                      {group.label} subtotal
                    </td>
                    {selectedNicknames.map((nick) => (
                      <td
                        key={nick}
                        className="px-3 py-1.5 text-right font-mono text-xs font-semibold text-muted-foreground"
                      >
                        {group.subtotalsByNickname.get(nick) ?? 0}
                      </td>
                    ))}
                  </tr>
                ) : null}
              </React.Fragment>
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
        {groups.map((group) => (
          <React.Fragment key={group.key}>
            {group.label !== null ? (
              <div className="flex items-baseline justify-between gap-2 pt-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-primary">
                  {group.label}
                </span>
                <span className="flex flex-wrap justify-end gap-x-3 text-[11px] text-muted-foreground">
                  {selectedNicknames.map((nick) => (
                    <span key={nick} className="font-mono">
                      {columnHeader(nick)}:{" "}
                      {group.subtotalsByNickname.get(nick) ?? 0}
                    </span>
                  ))}
                </span>
              </div>
            ) : null}
            {group.rows.map((row) => (
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
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

export const ScoreBreakdown = React.memo(ScoreBreakdownInner);
