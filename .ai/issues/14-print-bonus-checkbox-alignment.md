# #14 — fix: align bonus question boxes or justify-right

> **Labels**: priority: high
> **Author**: AgentEnder
> **Created**: 2026-04-17

## Issue body

> The checkboxes for y/n bonus questions should be right aligned or at least line up with each other's start on the print view, right now its kinda messy
>
> ![screenshot showing misaligned checkboxes](https://github.com/user-attachments/assets/d8fc339a-b621-420b-aecf-9562a9c6d70d)

## Where it lives

- Render: `components/print-sheet.tsx` — `BonusQuestionsBlock` (lines 64–116)
- Styles: `app/globals.css` — `.print-bonus-q-row`, `.print-bonus-main`, `.print-mc-options`, `.print-mc-option`, `.print-checkbox` (lines ~712–846)
- Test: `tests/unit/components/print-sheet.test.ts:148-169` (renders threshold question — does not assert alignment)

## Current rendering (relevant snippet)

```tsx
// print-sheet.tsx:83-102 (yes/no = threshold; multiple-choice is structurally identical)
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
    {(q.thresholdLabels ?? ["Over", "Under"]).map((label, li) => (
      <span key={li} className="print-mc-option">
        <span className="print-checkbox" />
        <span>{label}</span>
      </span>
    ))}
  </span>
) : (
  <span className="print-write-line-inline" />
)}
```

Layout: `print-bonus-q-row` is a 2-column grid (`1fr` for main, `56px` for points). The checkboxes sit *inside* the main column, inline with the question text via `inline-flex` + `flex-wrap`. Adjacent rows therefore start their checkboxes at whatever x-position the previous text wrapped to — hence the visual mess in the screenshot.

## What "fixed" might mean

- **Right-align** the option group within the main column (push checkboxes to the right).
- Or **column-align** the checkbox starts (e.g., put them in their own grid column with consistent width).
- Or just align the starts within a row (turning `flex-wrap` off + truncating long question text).

The user phrased it loosely ("right aligned or at least line up with each other's start") — open to either approach. Worth confirming the preferred direction before implementing.

## Cross-cutting notes

- See `.ai/context/cards.md` (Print view section) for the full layout + class list.
- The fix is CSS-only in the simplest case. If we restructure JSX (e.g., separate column for checkboxes) the test might need new assertions.
- Whatever change is chosen should be verified visually with the print preview in a browser; CSS print styles are easy to break.
