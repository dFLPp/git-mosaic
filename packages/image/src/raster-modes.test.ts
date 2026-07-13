import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { buildCalendar } from "@git-mosaic/calendar";

import { importRasterImage } from "./raster.js";

// 2024 starts on Monday and ends on Tuesday; use a Sunday-aligned range so
// every calendar cell is in range and placement is trivial.
const calendar = () =>
  buildCalendar({ from: "2023-01-01", to: "2023-12-30" }, "UTC"); // Sun..Sat, 52 columns

async function grayPng(
  pixels: Uint8Array,
  width: number,
  height: number,
): Promise<Buffer> {
  return sharp(pixels, { raw: { width, height, channels: 1 } })
    .png()
    .toBuffer();
}

/** 7 horizontal bands, one per output row (height 70 -> 7 rows of 10px). */
async function bandsPng(values: number[]): Promise<Buffer> {
  const width = 520;
  const height = 70;
  const pixels = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const value = values[Math.floor(y / 10)] ?? 255;
    pixels.fill(value, y * width, (y + 1) * width);
  }
  return grayPng(pixels, width, height);
}

describe("levels mode (default)", () => {
  it("maps band luminances to fixed thresholds", async () => {
    const image = await bandsPng([0, 0, 76, 127, 178, 255, 255]);
    const map = await importRasterImage(image, calendar(), { fit: "stretch" });
    expect(map.map((row) => row[10])).toEqual([4, 4, 3, 2, 1, 0, 0]);
  });

  it("stretches a low-contrast image when normalize is on", async () => {
    // Raw luminances 100..160 quantize to only {3, 2, 1}; normalizing maps
    // them across the full 0..255 range and separates all five intensities.
    const flat = await bandsPng([100, 110, 120, 130, 140, 150, 160]);
    const withoutNormalize = await importRasterImage(flat, calendar(), {
      fit: "stretch",
    });
    const withNormalize = await importRasterImage(flat, calendar(), {
      fit: "stretch",
      normalize: true,
    });
    expect(
      new Set(withoutNormalize.map((row) => row[10])).size,
    ).toBeLessThanOrEqual(3);
    expect(
      new Set(withNormalize.map((row) => row[10])).size,
    ).toBeGreaterThanOrEqual(4);
  });
});

describe("binary mode", () => {
  it("produces only 0 and 4", async () => {
    const image = await bandsPng([0, 40, 90, 127, 170, 220, 255]);
    const map = await importRasterImage(image, calendar(), {
      fit: "stretch",
      mode: "binary",
    });
    const values = new Set(map.flat());
    expect([...values].every((value) => value === 0 || value === 4)).toBe(true);
    expect(map[0]?.[10]).toBe(4);
    expect(map[6]?.[10]).toBe(0);
  });

  it("respects invert", async () => {
    const image = await bandsPng([0, 0, 0, 0, 255, 255, 255]);
    const map = await importRasterImage(image, calendar(), {
      fit: "stretch",
      mode: "binary",
      invert: true,
    });
    expect(map[0]?.[10]).toBe(0);
    expect(map[6]?.[10]).toBe(4);
  });
});
