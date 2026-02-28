"use client";

import { PrintSheet } from "@/components/print-sheet";
import { Button } from "@/components/ui/button";
import { useSheetSnapshot, useHasMatches } from "@/stores/selectors";
import { Printer } from "lucide-react";
import { memo, type RefObject } from "react";

interface PreviewViewProps {
  printRef: RefObject<HTMLDivElement | null>;
  onPrint: () => void;
}

export const PreviewView = memo(function PreviewView({ printRef, onPrint }: PreviewViewProps) {
  const sheet = useSheetSnapshot();
  const hasMatches = useHasMatches();

  if (!hasMatches) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="text-muted-foreground">
          Add some matches first to preview your sheet.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          This is how your sheet will look when printed. Click &ldquo;Print
          Sheet&rdquo; to print it.
        </p>
        <Button
          size="sm"
          onClick={onPrint}
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Printer className="h-4 w-4 mr-1" />
          Print
        </Button>
      </div>
      <div className="overflow-auto rounded-xl border border-border/80 bg-secondary/25 p-4">
        <div className="mx-auto w-full max-w-[8.7in] rounded-lg border border-border bg-white/90 p-5 shadow-[0_30px_55px_rgba(0,0,0,0.35)]">
          <div ref={printRef} className="preview-paper">
            <PrintSheet sheet={sheet} />
          </div>
        </div>
      </div>
    </div>
  );
});
