"use client";

import { Input } from "@/components/ui/input";

interface RosterAutocompleteInputProps {
  value: string;
  onChange: (value: string) => void;
  onFocus?: () => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  placeholder?: string;
  readOnly?: boolean;
  disabled?: boolean;
  className?: string;
  suggestions: string[];
  isLoadingSuggestions: boolean;
  activeFieldKey: string | null;
  fieldKey: string;
  onSelectSuggestion: (suggestion: string) => void;
}

export function RosterAutocompleteInput({
  value,
  onChange,
  onFocus,
  onKeyDown,
  placeholder,
  readOnly,
  disabled,
  className,
  suggestions,
  isLoadingSuggestions,
  activeFieldKey,
  fieldKey,
  onSelectSuggestion,
}: RosterAutocompleteInputProps) {
  const showSuggestions =
    (activeFieldKey === fieldKey && isLoadingSuggestions) ||
    suggestions.length > 0;

  return (
    <div className={className}>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        readOnly={readOnly}
        disabled={disabled}
      />
      {showSuggestions ? (
        <div className="mt-2 rounded-md border border-border/70 bg-background/35 px-3 py-2">
          <p className="text-[11px] text-muted-foreground">
            {activeFieldKey === fieldKey && isLoadingSuggestions
              ? "Loading roster suggestions..."
              : "Autocomplete from promotion roster"}
          </p>
          {suggestions.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => onSelectSuggestion(suggestion)}
                  className="inline-flex items-center rounded-md border border-border bg-card px-2 py-1 text-xs text-card-foreground transition-colors hover:border-primary hover:text-primary"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
