import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { buildCalendar } from "@git-mosaic/calendar";

import { analyzeExpressibility } from "./expressibility.js";

const calendar = () =>
  buildCalendar({ from: "2023-01-01", to: "2023-12-30" }, "UTC");

async function grayPng(
  pixels: Uint8Array,
  width: number,
  height: number,
): Promise<Buffer> {
  return sharp(pixels, { raw: { width, height, channels: 1 } })
    .png()
    .toBuffer();
}

/** Wide white canvas with a large black rectangle: ideal mosaic art. */
async function silhouettePng(): Promise<Buffer> {
  const width = 520;
  const height = 70;
  const pixels = new Uint8Array(width * height).fill(255);
  for (let y = 10; y < 60; y += 1) {
    pixels.fill(0, y * width + 100, y * width + 420);
  }
  return grayPng(pixels, width, height);
}

/** Deterministic per-pixel noise (LCG): detail far below cell size. */
async function noisePng(): Promise<Buffer> {
  const width = 520;
  const height = 70;
  const pixels = new Uint8Array(width * height);
  let state = 42;
  for (let index = 0; index < pixels.length; index += 1) {
    state = (state * 1103515245 + 12345) % 2147483648;
    pixels[index] = state % 2 === 0 ? 0 : 255;
  }
  return grayPng(pixels, width, height);
}

/** Tall portrait image: terrible aspect for a 7-row canvas. */
async function portraitPng(): Promise<Buffer> {
  const width = 70;
  const height = 520;
  const pixels = new Uint8Array(width * height).fill(255);
  for (let y = 100; y < 420; y += 1) {
    pixels.fill(0, y * width + 10, y * width + 60);
  }
  return grayPng(pixels, width, height);
}

describe("analyzeExpressibility", () => {
  it("scores a bold wide silhouette as good", async () => {
    const report = await analyzeExpressibility(
      await silhouettePng(),
      calendar(),
    );
    expect(report.verdict).toBe("good");
    expect(report.signals.edgeSurvival).toBeGreaterThan(0.6);
  });

  it("scores pixel noise as bad with a simplify remedy", async () => {
    const report = await analyzeExpressibility(await noisePng(), calendar());
    expect(report.verdict).toBe("bad");
    expect(report.lost.join(" ")).toContain("fine detail");
  });

  it("flags portrait aspect with a crop remedy", async () => {
    const report = await analyzeExpressibility(await portraitPng(), calendar());
    expect(report.signals.aspectEfficiency).toBeLessThan(0.1);
    expect(report.verdict).toBe("bad");
    expect(report.remedies.join(" ")).toContain("crop");
  });

  it("orders scores sensibly", async () => {
    const good = await analyzeExpressibility(await silhouettePng(), calendar());
    const bad = await analyzeExpressibility(await noisePng(), calendar());
    expect(good.score).toBeGreaterThan(bad.score);
  });
});
