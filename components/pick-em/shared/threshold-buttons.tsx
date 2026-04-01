"use client";

import { normalizeText } from "@/lib/pick-em/text-utils";

interface ThresholdButtonsProps {
  labels: string[];
  selectedValue: string;
  onSelect: (label: string) => void;
  disabled?: boolean;
}

export function ThresholdButtons({
  labels,
  selectedValue,
  onSelect,
  disabled = false,
}: ThresholdButtonsProps) {
  return (
    <div className="flex gap-2">
      {labels.map((label) => (
        <button
          key={label}
          type="button"
          disabled={disabled}
          onClick={() => onSelect(label)}
          className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
            normalizeText(selectedValue) === normalizeText(label)
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-card text-card-foreground hover:border-primary/50"
          } disabled:cursor-not-allowed disabled:opacity-50`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
