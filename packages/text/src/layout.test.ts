import { describe, expect, it } from "vitest";

import { FONTS } from "./fonts.js";
import { layoutText, measureText } from "./layout.js";

const font3x5 = FONTS[2]!;

describe("measureText", () => {
  it("sums glyph widths plus one gap between glyphs", () => {
    // 3x5: 'H' is 3 wide, 'I' is 3 wide -> 3 + 1 + 3 = 7
    expect(measureText("HI", font3x5)).toBe(7);
  });

  it("is case-insensitive", () => {
    expect(measureText("hi", font3x5)).toBe(measureText("HI", font3x5));
  });

  it("measures empty content as zero columns", () => {
    expect(measureText("", font3x5)).toBe(0);
  });
});

describe("layoutText ladder", () => {
  it("uses the largest tier that fits", () => {
    // Widths from the Task 8 glyph tables, gaps = chars - 1:
    // "HI" at 5x7: 5+1+3 = 9 <= 53 -> 5x7.
    expect(layoutText("HI", 53).tier).toBe("5x7");
    // "STARTING..." at 5x7: 38+6+10 = 54 > 53; at 4x5: 32+10 = 42 -> 4x5.
    expect(layoutText("STARTING...", 53).tier).toBe("4x5");
    // "LOADING... WAIT" at 4x5: 47+14 = 61 > 53; at 3x5: 38+14 = 52 -> 3x5.
    expect(layoutText("LOADING... WAIT", 53).tier).toBe("3x5");
  });

  it("renders 'HI' exactly at 3x5 when space is tight", () => {
    // "HI" measures 9 at 5x7, 8 at 4x5, 7 at 3x5 — 7 columns forces the floor.
    const layout = layoutText("HI", 7);
    expect(layout.tier).toBe("3x5");
    expect(layout.width).toBe(7);
    expect(layout.startRow).toBe(1);
    const rows = layout.cells.map((row) =>
      row.map((on) => (on ? "#" : ".")).join(""),
    );
    expect(rows).toEqual([
      "#.#.###",
      "#.#..#.",
      "###..#.",
      "#.#..#.",
      "#.#.###",
    ]);
  });

  it("refuses with exact numbers when nothing fits", () => {
    const longText = "lorem ipsum dolor".repeat(5);
    try {
      layoutText(longText, 53);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toMatchObject({ code: "GM016" });
      const message = (error as Error).message;
      expect(message).toMatch(/needs \d+ columns/);
      expect(message).toContain("53");
    }
  });

  it("rejects unsupported characters with the offending character named", () => {
    expect(() => layoutText("Δ", 53)).toThrow(/Δ/u);
    try {
      layoutText("Δ", 53);
    } catch (error) {
      expect(error).toMatchObject({ code: "GM017" });
    }
  });

  it("rejects empty and whitespace-only content", () => {
    expect(() => layoutText("", 53)).toThrow();
    expect(() => layoutText("   ", 53)).toThrow();
  });
});
