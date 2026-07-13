import { describe, expect, it } from "vitest";

import { CHARSET, FONTS } from "./fonts.js";

const EXPECTED_CHARS = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .!?-:"];

describe("pixel fonts", () => {
  it("ships three tiers, largest first", () => {
    expect(FONTS.map((font) => font.tier)).toEqual(["5x7", "4x5", "3x5"]);
    expect(FONTS.map((font) => font.height)).toEqual([7, 5, 5]);
    expect(FONTS.map((font) => font.startRow)).toEqual([0, 1, 1]);
  });

  it("covers the full charset in every tier", () => {
    for (const font of FONTS) {
      for (const char of EXPECTED_CHARS) {
        expect(
          font.glyphs[char],
          `${font.tier} missing '${char}'`,
        ).toBeDefined();
      }
    }
    expect(CHARSET).toEqual(new Set(EXPECTED_CHARS));
  });

  it("has structurally valid glyphs", () => {
    for (const font of FONTS) {
      for (const [char, rows] of Object.entries(font.glyphs)) {
        expect(rows.length, `${font.tier} '${char}' height`).toBe(font.height);
        const width = rows[0]?.length ?? 0;
        expect(width, `${font.tier} '${char}' width`).toBeGreaterThan(0);
        for (const row of rows) {
          expect(row.length, `${font.tier} '${char}' ragged rows`).toBe(width);
          expect(/^[#.]*$/.test(row), `${font.tier} '${char}' bad chars`).toBe(
            true,
          );
        }
      }
    }
  });

  it("keeps every non-space glyph visually distinct within a tier", () => {
    for (const font of FONTS) {
      const seen = new Map<string, string>();
      for (const [char, rows] of Object.entries(font.glyphs)) {
        if (char === " ") continue;
        const key = rows.join("/");
        expect(
          seen.has(key),
          `${font.tier}: '${char}' duplicates '${seen.get(key) ?? ""}'`,
        ).toBe(false);
        seen.set(key, char);
      }
    }
  });

  it("marks every non-space glyph with at least one pixel", () => {
    for (const font of FONTS) {
      for (const [char, rows] of Object.entries(font.glyphs)) {
        if (char === " ") continue;
        expect(
          rows.join("").includes("#"),
          `${font.tier} '${char}' empty`,
        ).toBe(true);
      }
    }
  });
});
