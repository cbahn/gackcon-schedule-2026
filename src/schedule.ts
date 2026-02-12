import { DateTime } from "luxon";

export type RawEvent = {
  starttime: string;
  duration: number;
  title?: string;
  host?: string;
  floor?: number;
  tags?: string[];
  description?: string;
};

export type NormalizedEvent = {
  title: string;
  host?: string;
  floor?: number;
  tags: string[];
  description?: string;

  // For display
  dayKey: "friday" | "saturday" | "sunday" | "other";
  startLabel: string;
  endLabel: string;

  // For client-side greying out
  startMs: number;
  endMs: number;
};

const INPUT_FORMAT = "yyyy-MM-dd h:mm a";

function parseStart(starttime: string, tz: string): DateTime {
  // Strict parse in the chosen timezone
  return DateTime.fromFormat(starttime, INPUT_FORMAT, { zone: tz });
}

function weekdayToDayKey(dt: DateTime): NormalizedEvent["dayKey"] {
  // Time is shifted back 5 hours before day of week is applied
  // This is so events that happen at 1am are condisered part of 
  // the previous day
  const shiftedWeekday = dt.minus({ hours: 5 }).weekday;
  if (shiftedWeekday === 5) return "friday";
  if (shiftedWeekday === 6) return "saturday";
  if (shiftedWeekday === 7) return "sunday";
  return "other";
}

export function normalizeSchedule(scheduleRaw: unknown, tz: string): {
  events: NormalizedEvent[];
  warnings: string[];
} {
  const warnings: string[] = [];

  if (!Array.isArray(scheduleRaw)) {
    return { events: [], warnings: ["Schedule JSON must be a top-level array of events."] };
  }

  const events: NormalizedEvent[] = [];

  for (let i = 0; i < scheduleRaw.length; i++) {
    const item = scheduleRaw[i] as Partial<RawEvent> | null;

    if (!item || typeof item !== "object") {
      warnings.push(`Event #${i + 1}: not an object (skipped).`);
      continue;
    }

    const starttime = item.starttime;
    const duration = item.duration;

    if (typeof starttime !== "string" || typeof duration !== "number") {
      warnings.push(`Event #${i + 1}: missing starttime (string) or duration (number) (skipped).`);
      continue;
    }

    const start = parseStart(starttime, tz);
    if (!start.isValid) {
      warnings.push(`Event #${i + 1}: invalid starttime "${starttime}" (expected "${INPUT_FORMAT}") (skipped).`);
      continue;
    }

    const end = start.plus({ minutes: duration });

    const title = typeof item.title === "string" ? item.title : "(Untitled)";
    const tags = Array.isArray(item.tags) ? item.tags.filter((t) => typeof t === "string") as string[] : [];

    const dayKey = weekdayToDayKey(start);

    events.push({
      title,
      host: typeof item.host === "string" ? item.host : undefined,
      floor: typeof item.floor === "number" ? item.floor : undefined,
      tags,
      description: typeof item.description === "string" ? item.description : undefined,
      dayKey,
      startLabel: start.toFormat("h:mm a"),
      endLabel: end.toFormat("h:mm a"),
      startMs: start.toMillis(),
      endMs: end.toMillis()
    });
  }

  // Sort by start time
  events.sort((a, b) => a.startMs - b.startMs);

  return { events, warnings };
}
