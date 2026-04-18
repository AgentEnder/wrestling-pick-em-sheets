# #19 — fix: threshold questions shouldn't show grading options

> **Labels**: priority: high
> **Author**: AgentEnder
> **Created**: 2026-04-17

## Issue body

> Thresholds are things like over/under, closest / exact / at-above / at-below don't make sense
>
> ![screenshot showing grading buttons on a threshold question](https://github.com/user-attachments/assets/e775023d-57ce-40d2-8eae-a6f01cf1be45)

## Where it lives

`components/match-editor.tsx` (match-level bonuses) and `components/pick-em/editor-view.tsx` (event-level bonuses). Both surfaces carry a duplicated copy of the grading-rule block.

The conditional that's wrong:

```tsx
// match-editor.tsx:1047-1080
{(q.valueType === "time" ||
  q.valueType === "numerical") && (
  <>
    <span className="text-xs text-muted-foreground">Grading:</span>
    <div className="flex flex-wrap items-center gap-2">
      {[
        { value: "exact",      label: "Exact" },
        { value: "closest",    label: "Closest" },
        { value: "atOrAbove",  label: "At/Above" },
        { value: "atOrBelow",  label: "At/Below" },
      ].map((rule) => (
        <button onClick={() => updateBonusQuestion(qi, { gradingRule: rule.value as BonusQuestion["gradingRule"] })}>
          {rule.label}
        </button>
      ))}
    </div>
  </>
)}
```

The block immediately above it (the value-type pills, lines 973–1045) already hides `string` and `rosterMember` when `q.answerType === "threshold"` — but the grading-rule block was missed. The threshold-specific inputs (value, labels) at lines 1082–1147 *are* correctly gated on `q.answerType === "threshold"`.

## Why threshold doesn't need a grading rule

Threshold questions are inherently binary: the player picks `thresholdLabels[0]` (e.g., "Over") or `thresholdLabels[1]` (e.g., "Under"). Scoring (`lib/server/scoring.ts:96-120`) compares the key answer's category to the player's pick — there is no "closest" or "atOrAbove" semantics involved.

## Type implications

`BonusQuestion.gradingRule` is optional (`lib/types.ts:37`). Whatever value is in storage today for threshold questions is harmless to scoring; the editor just shouldn't keep mutating it.

Worth deciding during planning:

- Just hide the UI? (smallest fix)
- Also unset `gradingRule` whenever the user switches to `answerType: "threshold"`? (cleaner data; maybe matters for analytics or for the print view)
- Drop `gradingRule` server-side at write time when `answerType === "threshold"`?

## Tests

No existing test for the editor's conditional. A unit test using react-testing-library against `<MatchEditor>` (or pulling out a smaller sub-component) would lock the behavior.

## Cross-cutting

- `.ai/context/cards.md` (Bonus question editor section) for line spans of the surrounding controls.
- `.ai/context/data-model.md` for the `BonusQuestion` type.
