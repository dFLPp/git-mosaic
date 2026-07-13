import { describe, expect, it } from "vitest";
import { buildCalendar } from "./index.js";
import {
  FixedThresholdStrategy,
  QuartileApproximationStrategy,
} from "./levels.js";

function daysWithCounts(counts: number[]) {
  const calendar = buildCalendar(
    { from: "2026-01-04", to: "2026-01-10" },
    "UTC",
  );
  return calendar.cells
    .flat()
    .map((day, index) => ({ ...day, finalCount: counts[index] ?? 0 }));
}

describe("QuartileApproximationStrategy", () => {
  it("uses the upper empirical rank so tied counts share a level", () => {
    const days = new QuartileApproximationStrategy().calculate(
      daysWithCounts([1, 1, 4, 10, 20]),
    );
    expect(days.slice(0, 5).map((day) => day.level)).toEqual([
      "SECOND_QUARTILE",
      "SECOND_QUARTILE",
      "THIRD_QUARTILE",
      "FOURTH_QUARTILE",
      "FOURTH_QUARTILE",
    ]);
  });

  it("handles empty and uniform calendars", () => {
    const strategy = new QuartileApproximationStrategy();
    expect(
      strategy
        .calculate(daysWithCounts([]))
        .every((day) => day.level === "NONE"),
    ).toBe(true);
    expect(
      strategy
        .calculate(daysWithCounts([3, 3]))
        .slice(0, 2)
        .every((day) => day.level === "FOURTH_QUARTILE"),
    ).toBe(true);
  });
});

describe("FixedThresholdStrategy", () => {
  it("maps fixed positive thresholds", () => {
    const days = new FixedThresholdStrategy([1, 4, 10, 20]).calculate(
      daysWithCounts([0, 1, 4, 10, 20]),
    );
    expect(days.slice(0, 5).map((day) => day.level)).toEqual([
      "NONE",
      "FIRST_QUARTILE",
      "SECOND_QUARTILE",
      "THIRD_QUARTILE",
      "FOURTH_QUARTILE",
    ]);
  });
});
