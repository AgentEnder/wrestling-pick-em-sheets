"use client";

import { useCallback, useEffect, useState } from "react";

import { getRosterSuggestions } from "@/lib/client/roster-api";
import { filterRosterMemberSuggestions } from "@/lib/pick-em/text-utils";

interface UseRosterSuggestionsOptions {
  promotionName: string | undefined | null;
}

interface UseRosterSuggestionsReturn {
  activeFieldKey: string | null;
  query: string;
  suggestions: string[];
  isLoading: boolean;
  setActiveInput: (fieldKey: string, value: string) => void;
  clearSuggestions: () => void;
  getFilteredSuggestions: (currentValue: string) => string[];
}

export function useRosterSuggestions({
  promotionName,
}: UseRosterSuggestionsOptions): UseRosterSuggestionsReturn {
  const [activeFieldKey, setActiveFieldKey] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [querySuggestions, setQuerySuggestions] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const trimmedPromotion = promotionName?.trim() ?? "";
    const trimmedQuery = query.trim();
    if (!trimmedPromotion || trimmedQuery.length < 2) {
      setQuerySuggestions([]);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      setIsLoading(true);
      void getRosterSuggestions(trimmedPromotion, trimmedQuery)
        .then((response) => {
          if (cancelled) return;
          setQuerySuggestions(response.names);
        })
        .catch(() => {
          if (cancelled) return;
          setQuerySuggestions([]);
        })
        .finally(() => {
          if (cancelled) return;
          setIsLoading(false);
        });
    }, 220);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [query, promotionName]);

  const setActiveInput = useCallback(
    (fieldKey: string, value: string) => {
      setActiveFieldKey(fieldKey);
      setQuery(value);
    },
    [],
  );

  const clearSuggestions = useCallback(() => {
    setActiveFieldKey(null);
    setQuery("");
  }, []);

  const getFilteredSuggestions = useCallback(
    (currentValue: string) => {
      return filterRosterMemberSuggestions(currentValue, querySuggestions);
    },
    [querySuggestions],
  );

  return {
    activeFieldKey,
    query,
    suggestions: querySuggestions,
    isLoading,
    setActiveInput,
    clearSuggestions,
    getFilteredSuggestions,
  };
}
