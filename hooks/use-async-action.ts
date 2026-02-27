"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";

/**
 * Wraps an async action with loading state and error handling via toast.
 * Eliminates the repeated try/catch/finally + isLoading pattern.
 */
export function useAsyncAction<Args extends unknown[]>(
  action: (...args: Args) => Promise<void>,
  fallbackMessage: string = "An error occurred",
): { execute: (...args: Args) => Promise<void>; isRunning: boolean } {
  const [isRunning, setIsRunning] = useState(false);

  const execute = useCallback(
    async (...args: Args) => {
      setIsRunning(true);
      try {
        await action(...args);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : fallbackMessage;
        toast.error(message);
      } finally {
        setIsRunning(false);
      }
    },
    [action, fallbackMessage],
  );

  return { execute, isRunning };
}
