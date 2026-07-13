import type { CalendarCell } from "./index.js";

export interface ContributionLevelStrategy {
  calculate(days: CalendarCell[]): CalendarCell[];
}

const LEVEL_BY_INTENSITY = [
  "NONE",
  "FIRST_QUARTILE",
  "SECOND_QUARTILE",
  "THIRD_QUARTILE",
  "FOURTH_QUARTILE",
] as const;

/**
 * WYSIWYG strategy: the preview level is exactly the drawn intensity. This is
 * what the artist meant; the quartile strategy remains the GitHub estimate.
 */
export class ArtisticIntensityStrategy implements ContributionLevelStrategy {
  calculate(days: CalendarCell[]): CalendarCell[] {
    return days.map((day) => ({
      ...day,
      level:
        day.inRange && day.intensity > 0
          ? LEVEL_BY_INTENSITY[day.intensity]
          : "NONE",
    }));
  }
}

function levelForPercentile(percentile: number): CalendarCell["level"] {
  if (percentile <= 0.25) return "FIRST_QUARTILE";
  if (percentile <= 0.5) return "SECOND_QUARTILE";
  if (percentile <= 0.75) return "THIRD_QUARTILE";
  return "FOURTH_QUARTILE";
}

export class QuartileApproximationStrategy implements ContributionLevelStrategy {
  calculate(days: CalendarCell[]): CalendarCell[] {
    const positiveCounts = days
      .filter((day) => day.inRange && day.finalCount > 0)
      .map((day) => day.finalCount)
      .sort((left, right) => left - right);

    return days.map((day) => {
      if (!day.inRange || day.finalCount === 0)
        return { ...day, level: "NONE" };
      const upperRank =
        positiveCounts.findLastIndex((count) => count <= day.finalCount) + 1;
      return {
        ...day,
        level: levelForPercentile(upperRank / positiveCounts.length),
      };
    });
  }
}

export class FixedThresholdStrategy implements ContributionLevelStrategy {
  readonly thresholds: readonly [number, number, number, number];

  constructor(thresholds: readonly [number, number, number, number]) {
    if (
      thresholds.some((value) => !Number.isInteger(value) || value < 1) ||
      thresholds.some(
        (value, index) => index > 0 && value <= thresholds[index - 1]!,
      )
    ) {
      throw new RangeError(
        "Thresholds must be positive, strictly increasing integers",
      );
    }
    this.thresholds = thresholds;
  }

  calculate(days: CalendarCell[]): CalendarCell[] {
    return days.map((day) => {
      if (!day.inRange || day.finalCount === 0)
        return { ...day, level: "NONE" };
      const [, second, third, fourth] = this.thresholds;
      const level =
        day.finalCount < second
          ? "FIRST_QUARTILE"
          : day.finalCount < third
            ? "SECOND_QUARTILE"
            : day.finalCount < fourth
              ? "THIRD_QUARTILE"
              : "FOURTH_QUARTILE";
      return { ...day, level };
    });
  }
}
