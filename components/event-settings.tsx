"use client";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { useEventSettings, useEventSettingsActions } from "@/stores/selectors";
import { Check, ChevronsUpDown } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

const TIMEZONE_FALLBACK = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Phoenix",
  "America/Anchorage",
  "Pacific/Honolulu",
  "Europe/London",
  "Europe/Paris",
  "Asia/Tokyo",
  "Australia/Sydney",
];

function parseLocalDateTimeInput(value: string): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
} | null {
  const trimmed = value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(trimmed);
  if (!match) return null;

  return {
    year: Number.parseInt(match[1] ?? "", 10),
    month: Number.parseInt(match[2] ?? "", 10),
    day: Number.parseInt(match[3] ?? "", 10),
    hour: Number.parseInt(match[4] ?? "", 10),
    minute: Number.parseInt(match[5] ?? "", 10),
  };
}

function formatOffset(offsetMinutes: number): string {
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutes);
  const hours = String(Math.floor(abs / 60)).padStart(2, "0");
  const minutes = String(abs % 60).padStart(2, "0");
  return `${sign}${hours}:${minutes}`;
}

function getOffsetForTimeZoneAtInstant(
  instant: Date,
  timeZone: string,
): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "shortOffset",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(instant);
  const zoneName =
    parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT+00:00";
  const normalized = zoneName.replace("UTC", "GMT");
  const match = /^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/.exec(normalized);
  if (!match) return 0;
  const sign = match[1] === "-" ? -1 : 1;
  const hours = Number.parseInt(match[2] ?? "0", 10);
  const minutes = Number.parseInt(match[3] ?? "0", 10);
  return sign * (hours * 60 + minutes);
}

function zonedLocalInputToIso(value: string, timeZone: string): string {
  const parsedInput = parseLocalDateTimeInput(value);
  if (!parsedInput) return "";

  const { year, month, day, hour, minute } = parsedInput;
  const localAsUtcMs = Date.UTC(year, month - 1, day, hour, minute, 0);

  const guessDate = new Date(localAsUtcMs);
  const guessOffsetMinutes = getOffsetForTimeZoneAtInstant(guessDate, timeZone);
  const instantMs = localAsUtcMs - guessOffsetMinutes * 60_000;
  const resolvedDate = new Date(instantMs);
  const resolvedOffsetMinutes = getOffsetForTimeZoneAtInstant(
    resolvedDate,
    timeZone,
  );

  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00${formatOffset(resolvedOffsetMinutes)}`;
}

function formatInstantForTimeZoneInput(
  instant: Date,
  timeZone: string,
): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(instant);

  const year = parts.find((part) => part.type === "year")?.value ?? "0000";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  const hour = parts.find((part) => part.type === "hour")?.value ?? "00";
  const minute = parts.find((part) => part.type === "minute")?.value ?? "00";
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function eventDateToInputValue(eventDate: string, timeZone: string): string {
  const trimmed = eventDate.trim();
  if (!trimmed) return "";

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return `${trimmed}T00:00`;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(trimmed)) return trimmed;

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return "";
  return formatInstantForTimeZoneInput(parsed, timeZone);
}

function getTimeZoneShortLabel(timeZone: string, instant: Date): string {
  const parts = new Intl.DateTimeFormat(undefined, {
    timeZone,
    timeZoneName: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(instant);
  return parts.find((part) => part.type === "timeZoneName")?.value ?? timeZone;
}

export function EventSettings() {
  const { eventName, promotionName, eventDate, eventTagline, defaultPoints, tiebreakerLabel, tiebreakerIsTimeBased } = useEventSettings();
  const { setEventName: onEventNameChange, setPromotionName: onPromotionNameChange, setEventDate: onEventDateChange, setEventTagline: onEventTaglineChange, setDefaultPoints: onDefaultPointsChange, setTiebreakerLabel: onTiebreakerLabelChange, setTiebreakerIsTimeBased: onTiebreakerIsTimeBasedChange } = useEventSettingsActions();
  const browserTimeZone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    [],
  );
  const [selectedTimeZone, setSelectedTimeZone] = useState(browserTimeZone);
  const [eventStartInput, setEventStartInput] = useState(() =>
    eventDateToInputValue(eventDate, browserTimeZone),
  );
  const [isTimezoneOpen, setIsTimezoneOpen] = useState(false);

  const selectedTimeZoneLabel = useMemo(
    () => getTimeZoneShortLabel(selectedTimeZone, new Date()),
    [selectedTimeZone],
  );
  const availableTimeZones = useMemo(() => {
    const fromIntl =
      typeof Intl.supportedValuesOf === "function"
        ? Intl.supportedValuesOf("timeZone")
        : [];
    const all = Array.from(new Set([...TIMEZONE_FALLBACK, ...fromIntl]));
    all.sort((left, right) => left.localeCompare(right));
    return all;
  }, []);

  const nowRef = useMemo(() => new Date(), [isTimezoneOpen]);
  const timeZoneLabels = useMemo(() => {
    const labels = new Map<string, string>();
    for (const tz of availableTimeZones) {
      labels.set(tz, getTimeZoneShortLabel(tz, nowRef));
    }
    return labels;
  }, [availableTimeZones, nowRef]);

  useEffect(() => {
    setEventStartInput(
      eventDateToInputValue(eventDate, selectedTimeZone),
    );
  }, [eventDate, selectedTimeZone]);

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
            value={eventName}
            onChange={(e) => onEventNameChange(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="promotion-name">Promotion</Label>
          <Input
            id="promotion-name"
            placeholder="e.g. WWE, AEW, NJPW"
            value={promotionName}
            onChange={(e) => onPromotionNameChange(e.target.value)}
          />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="event-date">Event Start</Label>
          <div className="relative">
            <Input
              id="event-date"
              type="datetime-local"
              className="pr-28"
              value={eventStartInput}
              onClick={(e) => {
                e.currentTarget.showPicker?.();
              }}
              onChange={(e) => {
                const nextInput = e.target.value;
                setEventStartInput(nextInput);
                onEventDateChange(zonedLocalInputToIso(nextInput, selectedTimeZone));
              }}
            />
            <Popover open={isTimezoneOpen} onOpenChange={setIsTimezoneOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="secondary"
                  className="absolute top-1/2 right-1 h-7 -translate-y-1/2 px-2 text-xs"
                  aria-label="Change event timezone"
                >
                  {selectedTimeZoneLabel}
                  <ChevronsUpDown className="ml-1 h-3 w-3" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-[300px] p-0">
                <Command>
                  <CommandInput placeholder="Search timezone..." />
                  <CommandList>
                    <CommandEmpty>No timezone found.</CommandEmpty>
                    <CommandGroup>
                      {availableTimeZones.map((timeZone) => (
                        <CommandItem
                          key={timeZone}
                          value={`${timeZone} ${timeZoneLabels.get(timeZone)}`}
                          onSelect={() => {
                            const newDate = zonedLocalInputToIso(
                              eventStartInput,
                              timeZone,
                            );
                            setSelectedTimeZone(timeZone);
                            onEventDateChange(newDate);
                            setIsTimezoneOpen(false);
                          }}
                        >
                          <Check
                            className={`h-4 w-4 ${timeZone === selectedTimeZone ? "opacity-100" : "opacity-0"}`}
                          />
                          <span className="flex-1 truncate">{timeZone}</span>
                          <span className="text-xs text-muted-foreground">
                            {timeZoneLabels.get(timeZone)}
                          </span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
          <p className="text-xs text-muted-foreground">
            Stored with timezone {selectedTimeZoneLabel} ({selectedTimeZone}).
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="event-tagline">Tagline / Subtitle</Label>
          <Input
            id="event-tagline"
            placeholder="e.g. The Showcase of the Immortals"
            value={eventTagline}
            onChange={(e) => onEventTaglineChange(e.target.value)}
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
            value={defaultPoints}
            onChange={(e) =>
              onDefaultPointsChange(Math.max(1, parseInt(e.target.value) || 1))
            }
          />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="tiebreaker-label">Tiebreaker Question</Label>
          <Input
            id="tiebreaker-label"
            placeholder="e.g. Main event total match time (mins)"
            value={tiebreakerLabel}
            onChange={(e) => onTiebreakerLabelChange(e.target.value)}
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
          checked={tiebreakerIsTimeBased}
          onCheckedChange={onTiebreakerIsTimeBasedChange}
        />
      </div>
    </div>
  );
}
