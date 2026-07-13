import { GitMosaicError, type FontTier } from "@git-mosaic/schemas";

import { CHARSET, FONTS, type PixelFont } from "./fonts.js";

export interface TextLayout {
  tier: FontTier;
  width: number;
  height: number;
  /** First canvas row the block occupies on the 7-row canvas. */
  startRow: number;
  /** height x width; true = paint the cell. */
  cells: boolean[][];
}

function normalizeContent(content: string): string {
  const normalized = content.toUpperCase();
  if (normalized.trim().length === 0) {
    throw new GitMosaicError("UNSUPPORTED_TEXT", "Text content is empty", {
      hint: "Provide at least one visible character",
    });
  }
  for (const char of normalized) {
    if (!CHARSET.has(char)) {
      throw new GitMosaicError(
        "UNSUPPORTED_TEXT",
        `Unsupported character: '${char}'`,
        {
          hint: "Supported characters are A-Z, 0-9, space, and . ! ? - :",
        },
      );
    }
  }
  return normalized;
}

export function measureText(content: string, font: PixelFont): number {
  const chars = [...content.toUpperCase()];
  const glyphWidths = chars.map((char) => font.glyphs[char]?.[0]?.length ?? 0);
  const gapColumns = Math.max(0, chars.length - 1);
  return glyphWidths.reduce((sum, width) => sum + width, 0) + gapColumns;
}

function renderCells(content: string, font: PixelFont): boolean[][] {
  const cells: boolean[][] = Array.from({ length: font.height }, () => []);
  const chars = [...content];
  for (const [index, char] of chars.entries()) {
    const glyph = font.glyphs[char]!;
    for (let row = 0; row < font.height; row += 1) {
      for (const pixel of glyph[row]!) {
        cells[row]!.push(pixel === "#");
      }
      if (index < chars.length - 1) cells[row]!.push(false);
    }
  }
  return cells;
}

/**
 * Fit text onto `availableColumns` using the largest font tier that fits.
 * Everything "fits" if shrunk enough, but glyphs below 3x5 pixels stop being
 * distinct characters — so beyond the smallest tier this refuses with exact
 * numbers instead of producing an illegible smear.
 */
export function layoutText(
  content: string,
  availableColumns: number,
): TextLayout {
  const normalized = normalizeContent(content);
  for (const font of FONTS) {
    const width = measureText(normalized, font);
    if (width <= availableColumns) {
      return {
        tier: font.tier,
        width,
        height: font.height,
        startRow: font.startRow,
        cells: renderCells(normalized, font),
      };
    }
  }
  const smallest = FONTS[FONTS.length - 1]!;
  const needed = measureText(normalized, smallest);
  const maxCharacters = Math.max(1, Math.floor((availableColumns + 1) / 4));
  throw new GitMosaicError(
    "TEXT_DOES_NOT_FIT",
    `Text needs ${needed} columns at the smallest legible font; ${availableColumns} are available`,
    {
      hint: `Shorten the text to about ${maxCharacters} characters, or split it across multiple year projects`,
    },
  );
}
