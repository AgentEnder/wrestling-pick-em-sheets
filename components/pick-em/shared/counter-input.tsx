"use client";

import { Button } from "@/components/ui/button";
import { parseCountAnswer } from "@/lib/pick-em/text-utils";

interface CounterInputProps {
  value: string | undefined;
  onChange: (newValue: string) => void;
  thresholdValue?: number;
  thresholdLabels?: string[];
  disabled?: boolean;
}

export function CounterInput({
  value,
  onChange,
  thresholdValue,
  thresholdLabels,
  disabled = false,
}: CounterInputProps) {
  const current = parseCountAnswer(value);
  const labels = thresholdLabels ?? ["Over", "Under"];

  return (
    <div>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={disabled}
          onClick={() => onChange(String(Math.max(0, current - 1)))}
        >
          &minus;
        </Button>
        <span className="min-w-[3rem] rounded-md border border-border px-3 py-1.5 text-center font-mono text-lg">
          {current}
        </span>
        <Button
          size="sm"
          variant="secondary"
          disabled={disabled}
          onClick={() => onChange(String(current + 1))}
        >
          +
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={disabled || (value ?? "").trim().length === 0}
          onClick={() => onChange("")}
        >
          Clear
        </Button>
      </div>
      {thresholdValue != null ? (
        <p className="mt-1 text-xs text-muted-foreground">
          Threshold: {thresholdValue}
          {(value ?? "").trim() ? (
            <>
              {" \u00b7 "}
              Result: {current > thresholdValue ? labels[0] : labels[1]}
            </>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
