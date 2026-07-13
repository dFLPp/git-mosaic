import { Temporal } from "@js-temporal/polyfill";
import {
  dateRangeSchema,
  GitMosaicError,
  type Confidence,
  type ContributionLevel,
  type DateRange,
  type Intensity,
  type IntensityMap,
} from "@git-mosaic/schemas";

export * from "./levels.js";

export interface CalendarCell {
  date: string;
  row: number;
  column: number;
  inRange: boolean;
  intensity: Intensity;
  existingCount: number;
  plannedCount: number;
  finalCount: number;
  level: ContributionLevel;
  confidence: Confidence;
  color?: string;
}

export interface ContributionCalendar {
  period: DateRange;
  timezone: string;
  alignedFrom: string;
  alignedTo: string;
  rows: 7;
  columns: number;
  cells: CalendarCell[][];
}

function parsePlainDate(value: string): Temporal.PlainDate {
  try {
    return Temporal.PlainDate.from(value);
  } catch (cause) {
    throw new GitMosaicError("INVALID_DATE_RANGE", `Invalid date: ${value}`, {
      hint: "Use a real calendar date in YYYY-MM-DD format",
      cause,
    });
  }
}

export function validateTimezone(timezone: string): void {
  try {
    Temporal.Now.zonedDateTimeISO(timezone);
  } catch (cause) {
    throw new GitMosaicError(
      "INVALID_TIMEZONE",
      `Invalid timezone: ${timezone}`,
      {
        hint: "Use an IANA timezone such as America/Sao_Paulo or UTC",
        cause,
      },
    );
  }
}

export function buildCalendar(
  rangeInput: DateRange,
  timezone: string,
): ContributionCalendar {
  const parsed = dateRangeSchema.safeParse(rangeInput);
  if (!parsed.success) {
    throw new GitMosaicError(
      "INVALID_DATE_RANGE",
      "The requested period is invalid",
      {
        hint: parsed.error.issues.map((issue) => issue.message).join("; "),
        cause: parsed.error,
      },
    );
  }
  validateTimezone(timezone);

  const from = parsePlainDate(parsed.data.from);
  const to = parsePlainDate(parsed.data.to);
  const alignedFrom = from.subtract({ days: from.dayOfWeek % 7 });
  const alignedTo = to.add({ days: 6 - (to.dayOfWeek % 7) });
  const totalDays =
    alignedFrom.until(alignedTo, { largestUnit: "day" }).days + 1;
  const columns = totalDays / 7;
  const cells: CalendarCell[][] = Array.from({ length: 7 }, () => []);

  for (let column = 0; column < columns; column += 1) {
    for (let row = 0; row < 7; row += 1) {
      const date = alignedFrom.add({ days: column * 7 + row });
      const dateString = date.toString();
      const inRange =
        Temporal.PlainDate.compare(date, from) >= 0 &&
        Temporal.PlainDate.compare(date, to) <= 0;
      cells[row]?.push({
        date: dateString,
        row,
        column,
        inRange,
        intensity: 0,
        existingCount: 0,
        plannedCount: 0,
        finalCount: 0,
        level: "NONE",
        confidence: "ESTIMATED",
      });
    }
  }

  return {
    period: parsed.data,
    timezone,
    alignedFrom: alignedFrom.toString(),
    alignedTo: alignedTo.toString(),
    rows: 7,
    columns,
    cells,
  };
}

/**
 * The inclusive range of columns whose seven cells are all in range. Partial
 * first/last weeks are excluded so artwork is never clipped by out-of-range
 * cells.
 */
export function fullyInRangeColumnSpan(calendar: ContributionCalendar): {
  start: number;
  end: number;
} {
  const isFull = (column: number): boolean =>
    calendar.cells.every((row) => row[column]?.inRange === true);
  let start = 0;
  while (start < calendar.columns && !isFull(start)) start += 1;
  let end = calendar.columns - 1;
  while (end >= start && !isFull(end)) end -= 1;
  if (start > end) {
    throw new GitMosaicError(
      "INVALID_DATE_RANGE",
      "The period does not contain a full Sunday-to-Saturday week",
      { hint: "Use a period of at least one full week" },
    );
  }
  return { start, end };
}

export function createEmptyIntensityMap(columns: number): IntensityMap {
  return Array.from({ length: 7 }, () => Array<Intensity>(columns).fill(0));
}

export function validateIntensityMap(
  map: IntensityMap,
  calendar: ContributionCalendar,
): void {
  const hasSevenRows = map.length === 7;
  const hasCorrectColumns = map.every((row) => row.length === calendar.columns);
  const outOfRangeIsEmpty = calendar.cells.every((row, rowIndex) =>
    row.every(
      (cell, columnIndex) => cell.inRange || map[rowIndex]?.[columnIndex] === 0,
    ),
  );

  if (!hasSevenRows || !hasCorrectColumns || !outOfRangeIsEmpty) {
    throw new GitMosaicError(
      "INVALID_INTENSITY_MAP",
      "Intensity map does not match the calendar",
      {
        hint: `Expected 7 rows and ${calendar.columns} columns; OUT_OF_RANGE cells must be zero`,
      },
    );
  }
}

export function applyIntensityMap(
  calendar: ContributionCalendar,
  map: IntensityMap,
): ContributionCalendar {
  validateIntensityMap(map, calendar);
  return {
    ...calendar,
    cells: calendar.cells.map((row, rowIndex) =>
      row.map((cell, columnIndex) => ({
        ...cell,
        intensity: map[rowIndex]?.[columnIndex] ?? 0,
      })),
    ),
  };
}

export function dateToCell(
  calendar: ContributionCalendar,
  date: string,
): CalendarCell | undefined {
  const target = parsePlainDate(date);
  const start = parsePlainDate(calendar.alignedFrom);
  const offset = start.until(target, { largestUnit: "day" }).days;
  if (offset < 0 || offset >= calendar.columns * 7) return undefined;
  const column = Math.floor(offset / 7);
  const row = offset % 7;
  return calendar.cells[row]?.[column];
}

export function cellToDate(
  calendar: ContributionCalendar,
  row: number,
  column: number,
): string | undefined {
  return calendar.cells[row]?.[column]?.date;
}

export function civilYearRange(year: number): DateRange {
  if (!Number.isInteger(year) || year < 1 || year > 9999) {
    throw new GitMosaicError("INVALID_DATE_RANGE", `Invalid year: ${year}`);
  }
  const formatted = year.toString().padStart(4, "0");
  return { from: `${formatted}-01-01`, to: `${formatted}-12-31` };
}

export function rollingYearRange(toInput: string): DateRange {
  const to = parsePlainDate(toInput);
  return {
    from: to.subtract({ years: 1 }).add({ days: 1 }).toString(),
    to: to.toString(),
  };
}

export function todayInTimezone(timezone: string): string {
  validateTimezone(timezone);
  return Temporal.Now.zonedDateTimeISO(timezone).toPlainDate().toString();
}

export function commitTimestamp(
  dateInput: string,
  timezone: string,
  zeroBasedIndex: number,
): string {
  if (
    !Number.isInteger(zeroBasedIndex) ||
    zeroBasedIndex < 0 ||
    zeroBasedIndex >= 43_200
  ) {
    throw new RangeError("Commit index must be an integer between 0 and 43199");
  }
  validateTimezone(timezone);
  const date = parsePlainDate(dateInput);
  return date
    .toZonedDateTime({
      timeZone: timezone,
      plainTime: Temporal.PlainTime.from("12:00:00"),
    })
    .add({ seconds: zeroBasedIndex })
    .toString({ smallestUnit: "second", timeZoneName: "never" });
}
