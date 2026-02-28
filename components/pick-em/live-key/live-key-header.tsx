"use client";

import React from "react";
import Link from "next/link";
import { ArrowLeft, RefreshCcw, Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useLiveCard, useLiveUi } from "@/stores/selectors";

interface LiveKeyHeaderProps {
  cardId: string;
  syncStatus: string;
  usingEditorDraft: boolean;
  onSave: () => void;
  onRefresh: () => void;
}

const LiveKeyHeaderInner = function LiveKeyHeader({
  cardId,
  syncStatus,
  usingEditorDraft,
  onSave,
  onRefresh,
}: LiveKeyHeaderProps) {
  const card = useLiveCard();
  const { isSaving, isRefreshing } = useLiveUi();

  return (
    <>
      <header className="sticky top-0 z-50 border-b border-border/70 bg-background/85 backdrop-blur-xl supports-[backdrop-filter]:bg-background/70">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-3">
          <div className="flex items-center gap-3">
            <Button asChild size="sm" variant="outline">
              <Link href={`/cards/${cardId}`}>
                <ArrowLeft className="mr-1 h-4 w-4" />
                Back to Editor
              </Link>
            </Button>
            <div>
              <h1 className="font-[family-name:var(--font-heading)] text-xl font-bold uppercase tracking-wider text-foreground">
                Live Key Tracking
              </h1>
              <p className="text-xs text-muted-foreground">
                {card?.eventName || "Untitled Event"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={onRefresh}
              disabled={isRefreshing}
            >
              <RefreshCcw className="mr-1 h-4 w-4" />
              {isRefreshing ? "Refreshing..." : "Refresh"}
            </Button>
            <Button size="sm" onClick={onSave} disabled={isSaving}>
              <Save className="mr-1 h-4 w-4" />
              {isSaving ? "Saving..." : "Save Key"}
            </Button>
          </div>
        </div>
      </header>

      <section className="rounded-lg border border-border bg-card p-3">
        <p className="text-xs text-muted-foreground">{syncStatus}</p>
        {usingEditorDraft ? (
          <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
            Showing unsaved sheet editor draft changes from this browser.
          </p>
        ) : null}
      </section>
    </>
  );
}

export const LiveKeyHeader = React.memo(LiveKeyHeaderInner);
