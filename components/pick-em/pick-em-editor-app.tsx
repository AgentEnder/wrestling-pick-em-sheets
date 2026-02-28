"use client";

import Link from "next/link";
import { Timer } from "lucide-react";
import { EditorView } from "@/components/pick-em/editor-view";
import { PageHeader } from "@/components/pick-em/page-header";
import { PreviewView } from "@/components/pick-em/preview-view";
import { PrintSheet } from "@/components/print-sheet";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { PickEmSheet } from "@/lib/types";
import { useAuth } from "@/lib/client/clerk-test-mode";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useAppStore } from "@/stores/app-store";
import {
  useEditorUi,
  useEditorActions,
  useHasMatches,
} from "@/stores/selectors";

const AUTOSAVE_DEBOUNCE_MS = 900;

function isEditableField(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  if (element.isContentEditable) {
    return true;
  }

  return (
    element.closest("input, textarea, select, [contenteditable='true']") !==
    null
  );
}

interface PickEmEditorAppProps {
  cardId: string;
}

export function PickEmEditorApp({ cardId }: PickEmEditorAppProps) {
  const { userId, isLoaded: isAuthLoaded } = useAuth();

  const {
    activeTab,
    isLoadingCard,
    isSyncingOverrides,
    isSavingSheet,
    isAutoSavingSheet,
    hasPendingAutoSave,
    autoSaveError,
    isDraftDirty,
  } = useEditorUi();

  const {
    setActiveTab,
    getSheetSnapshot,
    loadCard,
    saveSheet,
    syncOverrides,
    hydrateFromDraft,
    persistDraft,
    importSheet,
    setHasPendingAutoSave,
    clearAutoSaveError,
  } = useEditorActions();

  const hasMatches = useHasMatches();

  const [isEditableFieldFocused, setIsEditableFieldFocused] = useState(false);

  const printRef = useRef<HTMLDivElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const syncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const canAutoSave = isAuthLoaded && Boolean(userId);

  // Hydrate from local draft on mount (or when cardId changes)
  useEffect(() => {
    hydrateFromDraft(cardId);
  }, [cardId, hydrateFromDraft]);

  // Load card from server after hydration
  useEffect(() => {
    const hasHydrated = useAppStore.getState()._hasHydratedDraft;
    if (!hasHydrated) {
      return;
    }

    void loadCard(cardId);
  }, [cardId, loadCard]);

  // Persist draft to localStorage whenever the store dirty flag changes
  useEffect(() => {
    const hasHydrated = useAppStore.getState()._hasHydratedDraft;
    if (!hasHydrated) {
      return;
    }

    persistDraft(cardId);
  }, [cardId, isDraftDirty, persistDraft]);

  // Global error handlers
  useEffect(() => {
    function onError(event: ErrorEvent) {
      toast.error(event.message || "An unexpected error occurred");
    }

    function onUnhandledRejection(event: PromiseRejectionEvent) {
      const message =
        event.reason instanceof Error
          ? event.reason.message
          : String(event.reason);
      toast.error(message || "An unexpected error occurred");
    }

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);

    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, []);

  // Focus tracking for autosave gating
  useEffect(() => {
    function syncFocusedFieldState() {
      setIsEditableFieldFocused(isEditableField(document.activeElement));
    }

    function onFocusIn() {
      syncFocusedFieldState();
    }

    function onFocusOut() {
      window.requestAnimationFrame(syncFocusedFieldState);
    }

    syncFocusedFieldState();
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);

    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, []);

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current);
      }
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }
    };
  }, []);

  // Autosave orchestration
  useEffect(() => {
    if (
      !canAutoSave ||
      !isDraftDirty ||
      isSavingSheet ||
      isAutoSavingSheet ||
      isEditableFieldFocused
    ) {
      if (!isDraftDirty && autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
        autoSaveTimeoutRef.current = null;
      }
      if (!isDraftDirty || isEditableFieldFocused) {
        setHasPendingAutoSave(false);
      }
      return;
    }

    const currentSerialized = JSON.stringify(getSheetSnapshot());
    const lastFailedSnapshot =
      useAppStore.getState()._lastFailedAutoSaveSnapshot;

    if (lastFailedSnapshot === currentSerialized) {
      setHasPendingAutoSave(false);
      return;
    }

    if (autoSaveError) {
      clearAutoSaveError();
    }

    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
    }

    setHasPendingAutoSave(true);
    autoSaveTimeoutRef.current = setTimeout(() => {
      autoSaveTimeoutRef.current = null;
      setHasPendingAutoSave(false);
      void saveSheet(cardId, "auto");
    }, AUTOSAVE_DEBOUNCE_MS);
  }, [
    autoSaveError,
    canAutoSave,
    isAutoSavingSheet,
    isEditableFieldFocused,
    isDraftDirty,
    isSavingSheet,
    saveSheet,
    getSheetSnapshot,
    cardId,
  ]);

  // Beforeunload guard
  useEffect(() => {
    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (!hasPendingAutoSave && !isAutoSavingSheet && !isSavingSheet) {
        return;
      }

      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [hasPendingAutoSave, isAutoSavingSheet, isSavingSheet]);

  // Override sync — subscribe to event settings changes in the store
  useEffect(() => {
    const unsubscribe = useAppStore.subscribe((state, prevState) => {
      // Only sync when event settings actually change
      if (
        !state._hasHydratedDraft ||
        state.isLoadingCard ||
        (state.eventName === prevState.eventName &&
          state.promotionName === prevState.promotionName &&
          state.eventDate === prevState.eventDate &&
          state.eventTagline === prevState.eventTagline &&
          state.defaultPoints === prevState.defaultPoints &&
          state.tiebreakerLabel === prevState.tiebreakerLabel &&
          state.tiebreakerIsTimeBased === prevState.tiebreakerIsTimeBased)
      ) {
        return;
      }

      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current);
      }

      syncTimeoutRef.current = setTimeout(() => {
        void syncOverrides(cardId);
      }, 500);
    });

    return unsubscribe;
  }, [cardId, syncOverrides]);

  const handlePrint = useCallback(() => {
    window.print();
  }, []);

  const handleImportClick = useCallback(() => {
    importInputRef.current?.click();
  }, []);

  const handleImportFile = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) {
        return;
      }

      const reader = new FileReader();
      reader.onload = (loadEvent) => {
        try {
          const raw = loadEvent.target?.result as string;
          const decoded = atob(raw.trim());
          const bytes = Uint8Array.from(decoded, (char) => char.charCodeAt(0));
          const json = new TextDecoder().decode(bytes);
          const parsed = JSON.parse(json) as PickEmSheet;
          importSheet(parsed);
        } catch {
          toast.error("Failed to import: the file appears to be invalid.");
        }
      };

      reader.readAsText(file);
      event.target.value = "";
    },
    [importSheet],
  );

  const draftStatusMessage = (() => {
    if (!isAuthLoaded) {
      return "Loading account status...";
    }

    if (!userId) {
      return isDraftDirty
        ? "Unsaved local sheet edits in this browser."
        : "Saved locally in this browser (not signed in).";
    }

    if (isSavingSheet || isAutoSavingSheet) {
      return "Saving sheet...";
    }

    if (isEditableFieldFocused && isDraftDirty) {
      return "Editing a field. Autosave resumes when focus leaves input.";
    }

    if (hasPendingAutoSave) {
      return "Changes queued. Autosaving shortly...";
    }

    if (autoSaveError) {
      return `Autosave paused after an error: ${autoSaveError}`;
    }

    return isDraftDirty ? "Unsaved local edits." : "All sheet edits are saved.";
  })();

  const sheetForPrint = useAppStore((s) => s.getSheetSnapshot());

  return (
    <div className="relative min-h-screen overflow-x-clip bg-background print:bg-white">
      <div className="no-print pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_10%_0%,rgba(230,170,60,0.20),transparent_35%),radial-gradient(circle_at_90%_20%,rgba(130,160,255,0.12),transparent_35%),linear-gradient(to_bottom,rgba(255,255,255,0.02),transparent_35%)]" />
      <PageHeader
        cardId={cardId}
        canSave={isAuthLoaded && Boolean(userId)}
        onImportClick={handleImportClick}
        onPrint={handlePrint}
      />

      <input
        ref={importInputRef}
        type="file"
        accept=".json"
        className="hidden"
        onChange={handleImportFile}
      />

      <main className="no-print relative z-10 mx-auto max-w-5xl px-4 py-6 lg:py-8">
        <section className="rounded-2xl border border-border/70 bg-card/65 p-4 shadow-[0_24px_50px_rgba(0,0,0,0.28)] backdrop-blur lg:p-6">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <TabsList className="bg-secondary/80">
                  <TabsTrigger
                    value="editor"
                    className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
                  >
                    Editor
                  </TabsTrigger>
                  <TabsTrigger
                    value="preview"
                    disabled={!hasMatches}
                    className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
                  >
                    Print Preview
                  </TabsTrigger>
                </TabsList>
                <Button asChild size="sm" variant="outline">
                  <Link href={`/cards/${cardId}/live`}>
                    <Timer className="h-4 w-4 mr-1" />
                    Live Game
                  </Link>
                </Button>
              </div>
              <div className="w-full rounded-lg border border-border/70 bg-background/40 px-3 py-2 text-xs text-muted-foreground sm:w-auto sm:max-w-[28rem]">
                <p>
                  {isSyncingOverrides
                    ? "Syncing event settings to card overrides..."
                    : "Event settings sync directly to this card."}
                </p>
                <p
                  className={
                    autoSaveError
                      ? "mt-1 leading-relaxed text-destructive"
                      : "mt-1 leading-relaxed"
                  }
                >
                  {draftStatusMessage}
                </p>
              </div>
            </div>

            <TabsContent value="editor" className="mt-0">
              {isLoadingCard ? (
                <div className="rounded-lg border border-border bg-background/50 p-8 text-center text-muted-foreground">
                  Loading card...
                </div>
              ) : (
                <EditorView />
              )}
            </TabsContent>

            <TabsContent value="preview" className="mt-0">
              <PreviewView
                printRef={printRef}
                onPrint={handlePrint}
              />
            </TabsContent>
          </Tabs>
        </section>
      </main>

      <div className="print-only-wrapper">
        <PrintSheet sheet={sheetForPrint} />
      </div>
    </div>
  );
}
