import { describe, expect, it } from "vitest";
import {
  applyIntensityMap,
  buildCalendar,
  cellToDate,
  civilYearRange,
  commitTimestamp,
  createEmptyIntensityMap,
  dateToCell,
  rollingYearRange,
  validateTimezone,
} from "./index.js";

describe("buildCalendar", () => {
  it("aligns partial weeks and maps Sunday to row zero", () => {
    const calendar = buildCalendar(
      { from: "2026-01-01", to: "2026-01-10" },
      "UTC",
    );
    expect(calendar.alignedFrom).toBe("2025-12-28");
    expect(calendar.alignedTo).toBe("2026-01-10");
    expect(calendar.columns).toBe(2);
    expect(dateToCell(calendar, "2026-01-04")).toMatchObject({
      row: 0,
      column: 1,
      inRange: true,
    });
    expect(cellToDate(calendar, 4, 0)).toBe("2026-01-01");
  });

  it("marks aligned cells outside the requested period", () => {
    const calendar = buildCalendar(
      { from: "2026-01-01", to: "2026-01-01" },
      "UTC",
    );
    expect(calendar.cells.flat().filter((cell) => cell.inRange)).toHaveLength(
      1,
    );
    expect(dateToCell(calendar, "2025-12-31")?.inRange).toBe(false);
  });

  it("supports leap years and rolling-year presets", () => {
    expect(civilYearRange(2028)).toEqual({
      from: "2028-01-01",
      to: "2028-12-31",
    });
    expect(rollingYearRange("2028-02-29")).toEqual({
      from: "2027-03-01",
      to: "2028-02-29",
    });
    const leapYearCalendar = buildCalendar(
      civilYearRange(2028),
      "America/Los_Angeles",
    );
    expect(leapYearCalendar.columns).toBe(54);
    expect(leapYearCalendar.cells.flat()).toHaveLength(378);
  });

  it("rejects invalid timezones", () => {
    expect(() => validateTimezone("Mars/Olympus_Mons")).toThrow(
      /GM003|Invalid timezone/,
    );
  });
});

describe("intensity maps", () => {
  it("round-trips an empty map and rejects intensity in OUT_OF_RANGE cells", () => {
    const calendar = buildCalendar(
      { from: "2026-01-01", to: "2026-01-02" },
      "UTC",
    );
    const map = createEmptyIntensityMap(calendar.columns);
    map[4]![0] = 4;
    expect(applyIntensityMap(calendar, map).cells[4]?.[0]?.intensity).toBe(4);
    map[0]![0] = 1;
    expect(() => applyIntensityMap(calendar, map)).toThrow(
      /GM004|Intensity map/,
    );
  });
});

describe("commitTimestamp", () => {
  it("resolves the timezone offset for each date and increments deterministically", () => {
    expect(commitTimestamp("2026-01-15", "America/Los_Angeles", 0)).toBe(
      "2026-01-15T12:00:00-08:00",
    );
    expect(commitTimestamp("2026-07-15", "America/Los_Angeles", 2)).toBe(
      "2026-07-15T12:00:02-07:00",
    );
  });
});
