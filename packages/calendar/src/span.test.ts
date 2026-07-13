import { describe, expect, it } from "vitest";

import { buildCalendar, fullyInRangeColumnSpan } from "./index.js";

describe("fullyInRangeColumnSpan", () => {
  it("skips partial first and last weeks (2025 starts Wednesday, ends Wednesday)", () => {
    const calendar = buildCalendar(
      { from: "2025-01-01", to: "2025-12-31" },
      "UTC",
    );
    expect(calendar.columns).toBe(53);
    expect(fullyInRangeColumnSpan(calendar)).toEqual({ start: 1, end: 51 });
  });

  it("uses the whole grid when the range is Sunday-aligned", () => {
    const calendar = buildCalendar(
      { from: "2023-01-01", to: "2023-12-30" },
      "UTC",
    );
    expect(fullyInRangeColumnSpan(calendar)).toEqual({
      start: 0,
      end: calendar.columns - 1,
    });
  });
});
