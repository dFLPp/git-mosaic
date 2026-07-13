import { describe, expect, it } from "vitest";

import type { CalendarCell } from "./index.js";
import { ArtisticIntensityStrategy } from "./levels.js";

function cell(overrides: Partial<CalendarCell>): CalendarCell {
  return {
    date: "2025-06-01",
    row: 0,
    column: 0,
    inRange: true,
    intensity: 0,
    existingCount: 0,
    plannedCount: 0,
    finalCount: 0,
    level: "NONE",
    confidence: "ESTIMATED",
    ...overrides,
  };
}

describe("ArtisticIntensityStrategy", () => {
  it("maps drawn intensity one-to-one regardless of counts", () => {
    const strategy = new ArtisticIntensityStrategy();
    const result = strategy.calculate([
      cell({ intensity: 0 }),
      cell({ intensity: 1, finalCount: 1 }),
      cell({ intensity: 2, finalCount: 4 }),
      cell({ intensity: 3, finalCount: 10 }),
      cell({ intensity: 4, finalCount: 20 }),
    ]);
    expect(result.map((day) => day.level)).toEqual([
      "NONE",
      "FIRST_QUARTILE",
      "SECOND_QUARTILE",
      "THIRD_QUARTILE",
      "FOURTH_QUARTILE",
    ]);
  });

  it("keeps out-of-range and zero-intensity cells at NONE even with observed counts", () => {
    const strategy = new ArtisticIntensityStrategy();
    const result = strategy.calculate([
      cell({ inRange: false, intensity: 4 }),
      cell({ intensity: 0, existingCount: 12, finalCount: 12 }),
    ]);
    expect(result.map((day) => day.level)).toEqual(["NONE", "NONE"]);
  });
});
