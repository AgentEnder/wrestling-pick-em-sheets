"use client"

import { SignInButton, SignedIn, SignedOut, UserButton } from "@clerk/nextjs"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  BadgeCheck,
  Download,
  EllipsisVertical,
  Printer,
  RotateCcw,
  Save,
  Swords,
  Upload,
} from "lucide-react"

interface PageHeaderProps {
  hasMatches: boolean
  hasEventName: boolean
  onImportClick: () => void
  onExport: () => void
  onReset: () => void
  onPrint: () => void
  onSave: () => void
  isSaving: boolean
  canSave: boolean
}

export function PageHeader({
  hasMatches,
  hasEventName,
  onImportClick,
  onExport,
  onReset,
  onPrint,
  onSave,
  isSaving,
  canSave,
}: PageHeaderProps) {
  return (
    <header className="no-print sticky top-0 z-50 border-b border-border/70 bg-background/85 backdrop-blur-xl supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
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
          <span className="hidden items-center gap-1 rounded-full border border-border bg-card/80 px-2.5 py-1 text-[11px] font-medium text-muted-foreground lg:inline-flex">
            <BadgeCheck className="h-3.5 w-3.5 text-primary" />
            API connected
          </span>
        </div>

        <div className="flex w-full items-center justify-end gap-2 sm:w-auto">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="text-muted-foreground">
                <EllipsisVertical className="h-4 w-4" />
                <span className="sr-only">Open actions</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onImportClick}>
                <Upload className="h-4 w-4" />
                Import
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onExport}>
                <Download className="h-4 w-4" />
                Export
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onReset}>
                <RotateCcw className="h-4 w-4" />
                Reset
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            size="sm"
            variant="outline"
            onClick={onSave}
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
            <UserButton />
          </SignedIn>
        </div>
      </div>
    </header>
  )
}
