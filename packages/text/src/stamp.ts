import {
  fullyInRangeColumnSpan,
  validateIntensityMap,
  type ContributionCalendar,
} from "@git-mosaic/calendar";
import {
  fitReportSchema,
  type FitReport,
  type FontTier,
  type IntensityMap,
} from "@git-mosaic/schemas";

import { layoutText } from "./layout.js";

export type TextAlign = "left" | "center" | "right";

export interface StampResult {
  map: IntensityMap;
  report: FitReport;
  tier: FontTier;
}

const TIER_QUALITY: Record<
  FontTier,
  { verdict: "good" | "degraded"; score: number }
> = {
  "5x7": { verdict: "good", score: 1 },
  "4x5": { verdict: "good", score: 0.85 },
  "3x5": { verdict: "degraded", score: 0.6 },
};

/**
 * Render text directly onto the intensity grid. Glyphs are stamped as cells,
 * never resampled through an image pipeline, so strokes stay crisp.
 */
export function stampTextOnCalendar(
  content: string,
  calendar: ContributionCalendar,
  options: { align?: TextAlign } = {},
): StampResult {
  const span = fullyInRangeColumnSpan(calendar);
  const available = span.end - span.start + 1;
  const layout = layoutText(content, available);

  const align = options.align ?? "center";
  const startColumn =
    align === "left"
      ? span.start
      : align === "right"
        ? span.end - layout.width + 1
        : span.start + Math.floor((available - layout.width) / 2);

  const map: IntensityMap = Array.from({ length: 7 }, (_, row) =>
    Array.from({ length: calendar.columns }, (_, column) => {
      const layoutRow = row - layout.startRow;
      const layoutColumn = column - startColumn;
      if (
        layoutRow < 0 ||
        layoutRow >= layout.height ||
        layoutColumn < 0 ||
        layoutColumn >= layout.width
      ) {
        return 0;
      }
      return layout.cells[layoutRow]?.[layoutColumn] === true ? 4 : 0;
    }),
  );
  validateIntensityMap(map, calendar);

  const quality = TIER_QUALITY[layout.tier];
  const report = fitReportSchema.parse({
    verdict: quality.verdict,
    score: quality.score,
    signals: {
      fontTier: layout.tier,
      columnsUsed: layout.width,
      columnsAvailable: available,
    },
    survives: [`every character at the ${layout.tier} pixel font`],
    lost:
      quality.verdict === "degraded"
        ? ["stroke detail: 3x5 is the legibility floor"]
        : [],
    remedies:
      quality.verdict === "degraded"
        ? ["shorten the text to use a larger font tier"]
        : [],
  });

  return { map, report, tier: layout.tier };
}
