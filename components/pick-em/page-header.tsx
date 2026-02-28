"use client";

import { AppNavbar } from "@/components/pick-em/app-navbar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SignInButton,
  SignedIn,
  SignedOut,
  UserButton,
} from "@/lib/client/clerk-test-mode";
import {
  useHasMatches,
  useHasEventName,
  useEditorUi,
  useEditorActions,
} from "@/stores/selectors";
import {
  Download,
  EllipsisVertical,
  Printer,
  RotateCcw,
  Save,
  Swords,
  Upload,
} from "lucide-react";
import Link from "next/link";
import { memo, useCallback } from "react";

interface PageHeaderProps {
  cardId: string;
  canSave: boolean;
  onImportClick: () => void;
  onPrint: () => void;
}

export const PageHeader = memo(function PageHeader({
  cardId,
  canSave,
  onImportClick,
  onPrint,
}: PageHeaderProps) {
  const hasMatches = useHasMatches();
  const hasEventName = useHasEventName();
  const { isSavingSheet, isAutoSavingSheet } = useEditorUi();
  const { saveSheet, resetToServer, getSheetSnapshot } = useEditorActions();
  const isSaving = isSavingSheet || isAutoSavingSheet;

  const handleSave = useCallback(() => {
    void saveSheet(cardId, "manual");
  }, [saveSheet, cardId]);

  const handleReset = useCallback(() => {
    resetToServer();
  }, [resetToServer]);

  const handleExport = useCallback(() => {
    const sheet = getSheetSnapshot();
    const json = JSON.stringify(sheet, null, 2);
    const bytes = new TextEncoder().encode(json);
    let binary = "";

    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });

    const encoded = btoa(binary);
    const blob = new Blob([encoded], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;

    const safeName = (sheet.eventName.trim() || "pick-em-sheet")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-");

    anchor.download = `${safeName}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [getSheetSnapshot]);

  return (
    <header className="no-print sticky top-0 z-50 border-b border-border/70 bg-background/85 backdrop-blur-xl supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <Link
          href="/"
          className="flex items-center gap-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary shadow-[0_0_0_1px_rgba(0,0,0,0.25)]">
            <Swords className="h-4 w-4 text-primary-foreground" />
          </div>
          <div className="min-w-0">
            <h1 className="font-[family-name:var(--font-heading)] text-xl font-bold uppercase tracking-wider text-foreground leading-tight">
              Pick Em Generator
            </h1>
            <p className="text-sm text-muted-foreground leading-tight">
              Create printable pick sheets for wrestling events
            </p>
          </div>
        </Link>

        <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
          <AppNavbar />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
              >
                <EllipsisVertical className="h-4 w-4" />
                <span className="sr-only">Open actions</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onImportClick}>
                <Upload className="h-4 w-4" />
                Import
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleExport}>
                <Download className="h-4 w-4" />
                Export
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleReset}>
                <RotateCcw className="h-4 w-4" />
                Reset
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            size="sm"
            variant="outline"
            onClick={handleSave}
            disabled={isSaving || !canSave}
          >
            <Save className="h-4 w-4 mr-1" />
            <span>{isSaving ? "Saving..." : "Save Sheet"}</span>
          </Button>

          <Button
            size="sm"
            onClick={onPrint}
            disabled={!hasMatches || !hasEventName}
            title={
              !hasEventName
                ? "Enter an event name to enable printing"
                : !hasMatches
                  ? "Add at least one match to enable printing"
                  : undefined
            }
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Printer className="h-4 w-4 mr-1" />
            <span className="hidden sm:inline">Print Sheet</span>
          </Button>

          <SignedOut>
            <SignInButton mode="modal">
              <Button variant="outline" size="sm">
                Sign in
              </Button>
            </SignInButton>
          </SignedOut>
          <SignedIn>
            <UserButton afterSignOutUrl="/" />
          </SignedIn>
        </div>
      </div>
    </header>
  );
});
