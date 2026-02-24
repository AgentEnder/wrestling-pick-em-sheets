"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { PickEmSheet } from "@/lib/types";

interface EventSettingsProps {
  sheet: PickEmSheet;
  onChange: (sheet: PickEmSheet) => void;
}

export function EventSettings({ sheet, onChange }: EventSettingsProps) {
  return (
    <div className="flex flex-col gap-4">
      <h2 className="font-[family-name:var(--font-heading)] text-xl font-bold uppercase tracking-wide text-primary">
        Event Details
      </h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="event-name">Event Name</Label>
          <Input
            id="event-name"
            placeholder="e.g. WrestleMania 42"
            value={sheet.eventName}
            onChange={(e) => onChange({ ...sheet, eventName: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="promotion-name">Promotion</Label>
          <Input
            id="promotion-name"
            placeholder="e.g. WWE, AEW, NJPW"
            value={sheet.promotionName}
            onChange={(e) =>
              onChange({ ...sheet, promotionName: e.target.value })
            }
          />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="event-date">Event Date</Label>
          <Input
            id="event-date"
            type="date"
            value={sheet.eventDate}
            onChange={(e) => onChange({ ...sheet, eventDate: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="event-tagline">Tagline / Subtitle</Label>
          <Input
            id="event-tagline"
            placeholder="e.g. The Showcase of the Immortals"
            value={sheet.eventTagline}
            onChange={(e) =>
              onChange({ ...sheet, eventTagline: e.target.value })
            }
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="default-points">
            Default Points Per Correct Pick
          </Label>
          <Input
            id="default-points"
            type="number"
            min={1}
            value={sheet.defaultPoints}
            onChange={(e) =>
              onChange({
                ...sheet,
                defaultPoints: Math.max(1, parseInt(e.target.value) || 1),
              })
            }
          />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="tiebreaker-label">Tiebreaker Question</Label>
        <Input
          id="tiebreaker-label"
          placeholder="e.g. Main event total match time (mins)"
          value={sheet.tiebreakerLabel}
          onChange={(e) =>
            onChange({ ...sheet, tiebreakerLabel: e.target.value })
          }
        />
        <p className="text-xs text-muted-foreground">
          Leave blank to hide the tiebreaker from the printed sheet.
        </p>
      </div>
      <div className="flex items-center justify-between rounded-md border border-border/70 px-3 py-2">
        <div className="space-y-0.5">
          <Label htmlFor="tiebreaker-time-based">Time-based tiebreaker</Label>
          <p className="text-xs text-muted-foreground">
            Enable this when the tiebreaker answer is a time value so live
            keying captures timestamps.
          </p>
        </div>
        <Switch
          id="tiebreaker-time-based"
          checked={sheet.tiebreakerIsTimeBased}
          onCheckedChange={(checked) =>
            onChange({ ...sheet, tiebreakerIsTimeBased: checked })
          }
        />
      </div>
    </div>
  );
}
