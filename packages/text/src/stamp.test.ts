import { describe, expect, it } from "vitest";

import { buildCalendar } from "@git-mosaic/calendar";

import { stampTextOnCalendar } from "./stamp.js";

// 2025: partial first and last weeks; fully in-range span is columns 1..51.
const calendar2025 = () =>
  buildCalendar({ from: "2025-01-01", to: "2025-12-31" }, "UTC");

describe("stampTextOnCalendar", () => {
  it("centers 'HI' at 5x7 inside the in-range span", () => {
    const { map, report, tier } = stampTextOnCalendar("HI", calendar2025());
    expect(tier).toBe("5x7");
    // 'H' 5 wide + gap + 'I' 3 wide = 9 columns; span 1..51 (51 columns).
    // centered: start = 1 + floor((51 - 9) / 2) = 22.
    expect(map[0]?.[22]).toBe(4); // H top-left
    expect(map[3]?.[22]).toBe(4); // H crossbar row
    expect(map[0]?.[21]).toBe(0);
    // Partial edge columns stay empty.
    expect(map.map((row) => row[0])).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(map.map((row) => row[52])).toEqual([0, 0, 0, 0, 0, 0, 0]);
    // Only 0 and 4 appear.
    expect([...new Set(map.flat())].sort()).toEqual([0, 4]);
    expect(report.verdict).toBe("good");
    expect(report.signals.fontTier).toBe("5x7");
    expect(report.signals.columnsUsed).toBe(9);
    expect(report.signals.columnsAvailable).toBe(51);
  });

  it("respects left and right alignment", () => {
    const left = stampTextOnCalendar("HI", calendar2025(), { align: "left" });
    const right = stampTextOnCalendar("HI", calendar2025(), {
      align: "right",
    });
    // Left: 'H' top-left lands on the span start (column 1).
    expect(left.map[0]?.[1]).toBe(4);
    // Right: width 9, so the block starts at 51 - 9 + 1 = 43 ('H' left edge)
    // and 'I' (top row fully on) ends exactly at the span end (column 51).
    expect(right.map[0]?.[43]).toBe(4);
    expect(right.map[0]?.[51]).toBe(4);
  });

  it("degrades the verdict at the 3x5 floor", () => {
    // "LOADING... OK" at 4x5 needs 52 columns; the 2025 span has 51 — a
    // deliberate one-column boundary that forces the 3x5 floor.
    const { report, tier } = stampTextOnCalendar(
      "LOADING... OK",
      calendar2025(),
    );
    expect(tier).toBe("3x5");
    expect(report.verdict).toBe("degraded");
    expect(report.remedies.join(" ")).toContain("shorten");
  });

  it("keeps Sunday and Saturday rows empty for 5-row fonts", () => {
    // "STARTING..." needs 54 columns at 5x7 (> 51) and 42 at 4x5 -> 5-row font.
    const { map, tier } = stampTextOnCalendar("STARTING...", calendar2025());
    expect(tier).toBe("4x5");
    expect(map[0]?.every((value) => value === 0)).toBe(true);
    expect(map[6]?.every((value) => value === 0)).toBe(true);
  });
});
