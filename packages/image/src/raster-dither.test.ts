import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { buildCalendar } from "@git-mosaic/calendar";

import { importRasterImage } from "./raster.js";

const calendar = () =>
  buildCalendar({ from: "2023-01-01", to: "2023-12-30" }, "UTC");

/** Horizontal linear gradient, identical on every row. */
async function gradientPng(): Promise<Buffer> {
  const width = 520;
  const height = 70;
  const pixels = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      pixels[y * width + x] = Math.round((x / (width - 1)) * 255);
    }
  }
  return sharp(pixels, { raw: { width, height, channels: 1 } })
    .png()
    .toBuffer();
}

describe("dithering", () => {
  it("keeps rows identical without dithering and varies them with dithering", async () => {
    const image = await gradientPng();
    const plain = await importRasterImage(image, calendar(), {
      fit: "stretch",
    });
    const dithered = await importRasterImage(image, calendar(), {
      fit: "stretch",
      dithering: true,
    });
    expect(new Set(plain.map((row) => JSON.stringify(row))).size).toBe(1);
    expect(
      new Set(dithered.map((row) => JSON.stringify(row))).size,
    ).toBeGreaterThan(1);
  });

  it("preserves the overall light-to-dark direction", async () => {
    const image = await gradientPng();
    const dithered = await importRasterImage(image, calendar(), {
      fit: "stretch",
      dithering: true,
    });
    const columnMean = (column: number) =>
      dithered.reduce((sum, row) => sum + (row[column] ?? 0), 0) / 7;
    expect(columnMean(2)).toBeGreaterThan(columnMean(49));
  });

  it("is deterministic", async () => {
    const image = await gradientPng();
    const first = await importRasterImage(image, calendar(), {
      fit: "stretch",
      dithering: true,
    });
    const second = await importRasterImage(image, calendar(), {
      fit: "stretch",
      dithering: true,
    });
    expect(first).toEqual(second);
  });

  it("does not change binary quantization", async () => {
    const image = await gradientPng();
    const plain = await importRasterImage(image, calendar(), {
      fit: "stretch",
      mode: "binary",
    });
    const withDithering = await importRasterImage(image, calendar(), {
      fit: "stretch",
      mode: "binary",
      dithering: true,
    });
    expect(withDithering).toEqual(plain);
  });
});
