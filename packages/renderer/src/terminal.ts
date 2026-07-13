import type { ContributionCalendar, CalendarCell } from "@git-mosaic/calendar";
import type { ContributionLevel } from "@git-mosaic/schemas";

import type {
  PreviewRenderer,
  PreviewTheme,
  RenderOptions,
  RenderResult,
} from "./types.js";

type CalendarLevel = ContributionLevel | "OUT_OF_RANGE";

export interface TerminalRenderOptions extends RenderOptions {
  /** Twelve labels, starting with January. */
  monthLabels?: readonly string[];
  /** Seven labels, starting with Sunday. */
  weekdayLabels?: readonly string[];
  /** Text used for each item in the optional legend. */
  legendLabels?: Partial<Record<CalendarLevel, string>>;
}

const DEFAULT_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

const DEFAULT_WEEKDAYS = [
  "Sun",
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
] as const;

const SYMBOLS: Record<CalendarLevel, string> = {
  OUT_OF_RANGE: "×",
  NONE: "·",
  FIRST_QUARTILE: "░",
  SECOND_QUARTILE: "▒",
  THIRD_QUARTILE: "▓",
  FOURTH_QUARTILE: "█",
};

const DEFAULT_LEGEND: Record<CalendarLevel, string> = {
  OUT_OF_RANGE: "out of range",
  NONE: "none",
  FIRST_QUARTILE: "level 1",
  SECOND_QUARTILE: "level 2",
  THIRD_QUARTILE: "level 3",
  FOURTH_QUARTILE: "level 4",
};

const LEVEL_ORDER: readonly CalendarLevel[] = [
  "OUT_OF_RANGE",
  "NONE",
  "FIRST_QUARTILE",
  "SECOND_QUARTILE",
  "THIRD_QUARTILE",
  "FOURTH_QUARTILE",
];

const ANSI_BY_THEME: Record<PreviewTheme, Record<CalendarLevel, string>> = {
  dark: {
    OUT_OF_RANGE: "\u001B[90m",
    NONE: "\u001B[37m",
    FIRST_QUARTILE: "\u001B[38;5;22m",
    SECOND_QUARTILE: "\u001B[38;5;28m",
    THIRD_QUARTILE: "\u001B[38;5;34m",
    FOURTH_QUARTILE: "\u001B[38;5;40m",
  },
  light: {
    OUT_OF_RANGE: "\u001B[90m",
    NONE: "\u001B[37m",
    FIRST_QUARTILE: "\u001B[38;5;120m",
    SECOND_QUARTILE: "\u001B[38;5;34m",
    THIRD_QUARTILE: "\u001B[38;5;28m",
    FOURTH_QUARTILE: "\u001B[38;5;22m",
  },
};

const ANSI_RESET = "\u001B[0m";
const ESTIMATE_WARNING =
  "Warning: GitHub contribution levels and colors are estimates.";

function assertLabelCount(
  labels: readonly string[],
  count: number,
  option: string,
): void {
  if (labels.length !== count) {
    throw new RangeError(`${option} must contain exactly ${count} labels`);
  }
}

function naturalNumber(value: number | undefined, fallback: number): number {
  return value === undefined || !Number.isInteger(value) || value < 0
    ? fallback
    : value;
}

function levelOf(cell: CalendarCell): CalendarLevel {
  return cell.inRange ? cell.level : "OUT_OF_RANGE";
}

function paintSymbol(
  level: CalendarLevel,
  color: boolean,
  theme: PreviewTheme,
  cellSize: number,
): string {
  const symbol = SYMBOLS[level].repeat(cellSize);
  return color
    ? `${ANSI_BY_THEME[theme][level]}${symbol}${ANSI_RESET}`
    : symbol;
}

function confidenceOf(calendar: ContributionCalendar): string {
  const values = new Set(
    calendar.cells
      .flat()
      .filter((cell) => cell.inRange)
      .map((cell) => cell.confidence),
  );
  if (values.size === 1) return values.values().next().value ?? "ESTIMATED";
  return "MIXED";
}

function monthLine(
  calendar: ContributionCalendar,
  labels: readonly string[],
  prefixWidth: number,
  slotWidth: number,
): string | undefined {
  const positions = new Map<number, string>();
  const first = calendar.cells
    .flat()
    .find((cell) => cell.date === calendar.period.from);
  if (first)
    positions.set(
      first.column,
      labels[Number(first.date.slice(5, 7)) - 1] ?? "",
    );

  for (const cell of calendar.cells.flat()) {
    if (cell.inRange && cell.date.slice(8, 10) === "01") {
      positions.set(
        cell.column,
        labels[Number(cell.date.slice(5, 7)) - 1] ?? "",
      );
    }
  }
  if (positions.size === 0) return undefined;

  const width = Math.max(0, calendar.columns * slotWidth - (slotWidth - 1));
  const characters = Array<string>(width).fill(" ");
  for (const [column, label] of positions) {
    const start = column * slotWidth;
    for (
      let index = 0;
      index < label.length && start + index < width;
      index += 1
    ) {
      characters[start + index] = label[index] ?? " ";
    }
  }
  return `${" ".repeat(prefixWidth)}${characters.join("").trimEnd()}`;
}

export function renderTerminal(
  calendar: ContributionCalendar,
  options: TerminalRenderOptions = {},
): RenderResult {
  const months = options.monthLabels ?? DEFAULT_MONTHS;
  const weekdays = options.weekdayLabels ?? DEFAULT_WEEKDAYS;
  assertLabelCount(months, 12, "monthLabels");
  assertLabelCount(weekdays, 7, "weekdayLabels");

  const showMonths = options.showMonths ?? true;
  const showWeekdays = options.showWeekdays ?? true;
  const showLegend = options.showLegend ?? true;
  const color = options.color ?? false;
  const theme = options.theme ?? "dark";
  const cellSize = Math.max(1, naturalNumber(options.cellSize, 1));
  const cellGap = naturalNumber(options.cellGap, 1);
  const separator = " ".repeat(cellGap);
  const weekdayWidth = showWeekdays
    ? Math.max(...weekdays.map((label) => label.length))
    : 0;
  const prefixWidth = showWeekdays ? weekdayWidth + 1 : 0;
  const slotWidth = cellSize + cellGap;
  const lines: string[] = [];

  if (showMonths) {
    const heading = monthLine(calendar, months, prefixWidth, slotWidth);
    if (heading !== undefined) lines.push(heading);
  }

  for (let row = 0; row < calendar.rows; row += 1) {
    const prefix = showWeekdays
      ? `${(weekdays[row] ?? "").padStart(weekdayWidth)} `
      : "";
    const cells = calendar.cells[row] ?? [];
    lines.push(
      `${prefix}${cells
        .map((cell) => paintSymbol(levelOf(cell), color, theme, cellSize))
        .join(separator)}`,
    );
  }

  if (showLegend) {
    const labels = { ...DEFAULT_LEGEND, ...options.legendLabels };
    lines.push(
      `Legend: ${LEVEL_ORDER.map(
        (level) => `${paintSymbol(level, color, theme, 1)} ${labels[level]}`,
      ).join("  ")}`,
    );
  }

  lines.push(`Confidence: ${confidenceOf(calendar)}`);
  // This warning is deliberately not controlled by showLegend: the approximation
  // must remain explicit in every preview configuration.
  lines.push(ESTIMATE_WARNING);

  return { content: `${lines.join("\n")}\n`, mediaType: "text/plain" };
}

export class TerminalRenderer implements PreviewRenderer<TerminalRenderOptions> {
  constructor(private readonly calendar: ContributionCalendar) {}

  render(options: TerminalRenderOptions = {}): RenderResult {
    return renderTerminal(this.calendar, options);
  }
}
