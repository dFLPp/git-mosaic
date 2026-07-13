import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { buildCalendar } from "@git-mosaic/calendar";

import { importRasterImage } from "./raster.js";

async function blackPng(): Promise<Buffer> {
  const width = 510;
  const height = 70;
  return sharp(new Uint8Array(width * height), {
    raw: { width, height, channels: 1 },
  })
    .png()
    .toBuffer();
}

describe("contain placement inside the fully in-range span", () => {
  it("never paints partial edge columns", async () => {
    const calendar = buildCalendar(
      { from: "2025-01-01", to: "2025-12-31" },
      "UTC",
    );
    const map = await importRasterImage(await blackPng(), calendar, {
      fit: "contain",
    });
    // Column 0 has in-range cells (Wed..Sat) but is a partial week: must stay 0.
    expect(map.map((row) => row[0])).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(map.map((row) => row[52])).toEqual([0, 0, 0, 0, 0, 0, 0]);
    // The span interior is fully painted.
    expect(map.map((row) => row[1])).toEqual([4, 4, 4, 4, 4, 4, 4]);
    expect(map.map((row) => row[51])).toEqual([4, 4, 4, 4, 4, 4, 4]);
  });

  it("keeps cover mode on the full grid", async () => {
    const calendar = buildCalendar(
      { from: "2025-01-01", to: "2025-12-31" },
      "UTC",
    );
    const map = await importRasterImage(await blackPng(), calendar, {
      fit: "cover",
    });
    // Cover still paints in-range cells of the partial first column.
    expect(map[3]?.[0]).toBe(4);
  });
});
