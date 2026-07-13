import type { CalendarCell, ContributionCalendar } from "@git-mosaic/calendar";
import type { ContributionLevel } from "@git-mosaic/schemas";
import type {
  PreviewRenderer,
  PreviewTheme,
  RenderOptions,
  RenderResult,
} from "./types.js";

export interface SvgRenderOptions extends RenderOptions {
  /** Add a human-readable title to every calendar cell. */
  tooltips?: boolean;
}

interface Palette {
  background: string;
  text: string;
  border: string;
  outOfRange: string;
  levels: Readonly<Record<ContributionLevel, string>>;
}

const PALETTES: Readonly<Record<PreviewTheme, Palette>> = {
  light: {
    background: "#ffffff",
    text: "#1f2328",
    border: "#d0d7de",
    outOfRange: "#f6f8fa",
    levels: {
      NONE: "#ebedf0",
      FIRST_QUARTILE: "#9be9a8",
      SECOND_QUARTILE: "#40c463",
      THIRD_QUARTILE: "#30a14e",
      FOURTH_QUARTILE: "#216e39",
    },
  },
  dark: {
    background: "#0d1117",
    text: "#e6edf3",
    border: "#30363d",
    outOfRange: "#161b22",
    levels: {
      NONE: "#161b22",
      FIRST_QUARTILE: "#0e4429",
      SECOND_QUARTILE: "#006d32",
      THIRD_QUARTILE: "#26a641",
      FOURTH_QUARTILE: "#39d353",
    },
  },
};

const MONTHS = [
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
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const LEVELS: readonly ContributionLevel[] = [
  "NONE",
  "FIRST_QUARTILE",
  "SECOND_QUARTILE",
  "THIRD_QUARTILE",
  "FOURTH_QUARTILE",
];

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function positiveNumber(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a finite number greater than zero`);
  }
  return value;
}

function nonNegativeNumber(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a finite non-negative number`);
  }
  return value;
}

function levelNumber(level: ContributionLevel): number {
  return LEVELS.indexOf(level);
}

function tooltipFor(cell: CalendarCell): string {
  if (!cell.inRange) return `${cell.date}: outside the selected period`;
  const countLabel = cell.finalCount === 1 ? "contribution" : "contributions";
  return `${cell.date}: ${cell.finalCount} ${countLabel}, level ${levelNumber(cell.level)}, ${cell.confidence.toLowerCase()}`;
}

function monthLabels(
  calendar: ContributionCalendar,
): Array<{ column: number; label: string }> {
  const labels: Array<{ column: number; label: string }> = [];
  let previousMonth = "";
  for (let column = 0; column < calendar.columns; column += 1) {
    const cell = calendar.cells
      .map((row) => row[column])
      .find((candidate) => candidate?.inRange);
    if (cell === undefined) continue;
    const month = cell.date.slice(0, 7);
    if (month !== previousMonth) {
      const monthIndex = Number(cell.date.slice(5, 7)) - 1;
      labels.push({ column, label: MONTHS[monthIndex] ?? "" });
      previousMonth = month;
    }
  }
  return labels;
}

export class SvgRenderer implements PreviewRenderer<SvgRenderOptions> {
  readonly calendar: ContributionCalendar;

  constructor(calendar: ContributionCalendar) {
    this.calendar = calendar;
  }

  render(options: SvgRenderOptions = {}): RenderResult {
    return {
      content: renderSvg(this.calendar, options),
      mediaType: "image/svg+xml",
    };
  }
}

export function renderSvg(
  calendar: ContributionCalendar,
  options: SvgRenderOptions = {},
): string {
  const theme = options.theme ?? "light";
  const palette = PALETTES[theme];
  const cellSize = positiveNumber(options.cellSize ?? 11, "cellSize");
  const cellGap = nonNegativeNumber(options.cellGap ?? 3, "cellGap");
  const showMonths = options.showMonths ?? true;
  const showWeekdays = options.showWeekdays ?? true;
  const showLegend = options.showLegend ?? true;
  const tooltips = options.tooltips ?? true;
  const step = cellSize + cellGap;
  const left = showWeekdays ? 36 : 0;
  const top = showMonths ? 22 : 0;
  const gridWidth =
    calendar.columns * cellSize + Math.max(0, calendar.columns - 1) * cellGap;
  const gridHeight = calendar.rows * cellSize + (calendar.rows - 1) * cellGap;
  const legendHeight = showLegend ? 34 : 0;
  const legendCellsWidth =
    LEVELS.length * cellSize + (LEVELS.length - 1) * cellGap;
  const legendRequiredWidth = left + legendCellsWidth + 30;
  const width = Math.max(
    left + gridWidth,
    showLegend ? legendRequiredWidth : 0,
  );
  const height = top + gridHeight + legendHeight;
  const cornerRadius = Math.min(2, cellSize / 4);
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="git-mosaic-title git-mosaic-description">`,
    '  <title id="git-mosaic-title">Contribution mosaic preview</title>',
    `  <desc id="git-mosaic-description">Contribution calendar from ${escapeXml(calendar.period.from)} to ${escapeXml(calendar.period.to)}. GitHub may render different contribution levels and colors.</desc>`,
    `  <rect width="${width}" height="${height}" fill="${palette.background}"/>`,
    `  <g font-family="-apple-system, BlinkMacSystemFont, &quot;Segoe UI&quot;, sans-serif" font-size="10" fill="${palette.text}">`,
  ];

  if (showMonths) {
    lines.push('    <g class="month-labels" aria-hidden="true">');
    for (const month of monthLabels(calendar)) {
      lines.push(
        `      <text x="${left + month.column * step}" y="12">${month.label}</text>`,
      );
    }
    lines.push("    </g>");
  }

  if (showWeekdays) {
    lines.push('    <g class="weekday-labels" aria-hidden="true">');
    for (let row = 0; row < calendar.rows; row += 1) {
      lines.push(
        `      <text x="0" y="${top + row * step + cellSize - 1}">${WEEKDAYS[row]}</text>`,
      );
    }
    lines.push("    </g>");
  }

  lines.push('    <g class="contribution-grid">');
  for (let column = 0; column < calendar.columns; column += 1) {
    for (let row = 0; row < calendar.rows; row += 1) {
      const cell = calendar.cells[row]?.[column];
      if (cell === undefined) continue;
      const state = cell.inRange ? "in-range" : "out-of-range";
      const level = cell.inRange ? levelNumber(cell.level) : -1;
      const fill = cell.inRange
        ? (cell.color ?? palette.levels[cell.level])
        : palette.outOfRange;
      const stroke = cell.inRange ? palette.border : palette.outOfRange;
      const attributes = `x="${left + column * step}" y="${top + row * step}" width="${cellSize}" height="${cellSize}" rx="${cornerRadius}" fill="${escapeXml(fill)}" stroke="${stroke}" data-date="${escapeXml(cell.date)}" data-state="${state}" data-level="${level}"`;
      if (tooltips) {
        lines.push(
          `      <rect ${attributes}><title>${escapeXml(tooltipFor(cell))}</title></rect>`,
        );
      } else {
        lines.push(`      <rect ${attributes}/>`);
      }
    }
  }
  lines.push("    </g>");

  if (showLegend) {
    const legendY = top + gridHeight + 18;
    const legendX = Math.max(left, width - legendCellsWidth - 30);
    lines.push('    <g class="legend" aria-label="Contribution level legend">');
    lines.push(
      `      <text x="${legendX - 28}" y="${legendY + cellSize - 1}">Less</text>`,
    );
    for (let index = 0; index < LEVELS.length; index += 1) {
      const level = LEVELS[index]!;
      lines.push(
        `      <rect x="${legendX + index * step}" y="${legendY}" width="${cellSize}" height="${cellSize}" rx="${cornerRadius}" fill="${palette.levels[level]}" stroke="${palette.border}" data-level="${index}"/>`,
      );
    }
    lines.push(
      `      <text x="${legendX + legendCellsWidth + 5}" y="${legendY + cellSize - 1}">More</text>`,
    );
    lines.push("    </g>");
  }

  lines.push("  </g>", "</svg>");
  return `${lines.join("\n")}\n`;
}
