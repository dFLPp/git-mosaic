import sharp from "sharp";

import {
  fullyInRangeColumnSpan,
  type ContributionCalendar,
} from "@git-mosaic/calendar";
import { fitReportSchema, type FitReport } from "@git-mosaic/schemas";

import {
  importRasterImage,
  LUMINANCE_BY_INTENSITY,
  type RasterImportOptions,
  type RasterInput,
} from "./raster.js";

const CELL_PIXELS = 4;
const GOOD_THRESHOLD = 0.6;
const DEGRADED_THRESHOLD = 0.35;

interface GrayImage {
  data: Buffer;
  width: number;
  height: number;
  channels: number;
}

function gradientEnergyPerCell(
  image: GrayImage,
  columns: number,
  rows: number,
): Float64Array {
  const energy = new Float64Array(columns * rows);
  const at = (x: number, y: number): number =>
    image.data[(y * image.width + x) * image.channels] ?? 255;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const dx = x + 1 < image.width ? Math.abs(at(x + 1, y) - at(x, y)) : 0;
      const dy = y + 1 < image.height ? Math.abs(at(x, y + 1) - at(x, y)) : 0;
      const cellColumn = Math.min(columns - 1, Math.floor(x / CELL_PIXELS));
      const cellRow = Math.min(rows - 1, Math.floor(y / CELL_PIXELS));
      energy[cellRow * columns + cellColumn]! += dx + dy;
    }
  }
  return energy;
}

function entropyOfIntensities(counts: number[]): number {
  const total = counts.reduce((sum, count) => sum + count, 0);
  if (total === 0) return 0;
  let entropy = 0;
  for (const count of counts) {
    if (count === 0) continue;
    const p = count / total;
    entropy -= p * Math.log2(p);
  }
  return entropy / Math.log2(5);
}

/**
 * Measure how much of an image's structure survives quantization to the
 * contribution grid. Signals: aspect efficiency, per-cell edge survival, and
 * tone separability. The verdict never replaces looking at the preview; it
 * calibrates expectations and powers the low-expressibility gate.
 */
export async function analyzeExpressibility(
  input: RasterInput,
  calendar: ContributionCalendar,
  options: RasterImportOptions = {},
): Promise<FitReport> {
  const fit = options.fit ?? "contain";
  const span =
    fit === "contain"
      ? fullyInRangeColumnSpan(calendar)
      : { start: 0, end: calendar.columns - 1 };
  const columns = span.end - span.start + 1;

  const map = await importRasterImage(input, calendar, options);

  const metadata = await sharp(input, { failOn: "error" }).metadata();
  const swapped = (metadata.orientation ?? 1) >= 5;
  const sourceWidth = (swapped ? metadata.height : metadata.width) ?? 1;
  const sourceHeight = (swapped ? metadata.width : metadata.height) ?? 1;
  const imageAspect = sourceWidth / sourceHeight;
  const canvasAspect = columns / 7;
  const aspectEfficiency =
    fit === "contain"
      ? Math.min(imageAspect, canvasAspect) /
        Math.max(imageAspect, canvasAspect)
      : 1;

  const refWidth = columns * CELL_PIXELS;
  const refHeight = 7 * CELL_PIXELS;
  const originalRaw = await sharp(input, { failOn: "error" })
    .autoOrient()
    .flatten({ background: "white" })
    .resize(refWidth, refHeight, {
      fit: fit === "stretch" ? "fill" : fit,
      position: "centre",
      background: "white",
    })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const roundtrip = Buffer.alloc(refWidth * refHeight);
  for (let y = 0; y < refHeight; y += 1) {
    for (let x = 0; x < refWidth; x += 1) {
      const row = Math.floor(y / CELL_PIXELS);
      const column = span.start + Math.floor(x / CELL_PIXELS);
      const intensity = map[row]?.[column] ?? 0;
      roundtrip[y * refWidth + x] = LUMINANCE_BY_INTENSITY[intensity]!;
    }
  }

  const originalEnergy = gradientEnergyPerCell(
    {
      data: originalRaw.data,
      width: originalRaw.info.width,
      height: originalRaw.info.height,
      channels: originalRaw.info.channels,
    },
    columns,
    7,
  );
  const roundtripEnergy = gradientEnergyPerCell(
    { data: roundtrip, width: refWidth, height: refHeight, channels: 1 },
    columns,
    7,
  );
  let originalTotal = 0;
  let sharedTotal = 0;
  for (let index = 0; index < originalEnergy.length; index += 1) {
    originalTotal += originalEnergy[index]!;
    sharedTotal += Math.min(originalEnergy[index]!, roundtripEnergy[index]!);
  }
  const edgeSurvival =
    originalTotal === 0 ? 1 : Math.min(1, sharedTotal / originalTotal);

  const histogram = [0, 0, 0, 0, 0];
  for (const [row, cells] of map.entries()) {
    for (const [column, intensity] of cells.entries()) {
      if (calendar.cells[row]?.[column]?.inRange === true) {
        histogram[intensity] = (histogram[intensity] ?? 0) + 1;
      }
    }
  }
  const toneSeparability = entropyOfIntensities(histogram);

  const score = edgeSurvival * Math.sqrt(aspectEfficiency);
  const verdict =
    score >= GOOD_THRESHOLD
      ? "good"
      : score >= DEGRADED_THRESHOLD
        ? "degraded"
        : "bad";

  const survives: string[] = [];
  const lost: string[] = [];
  const remedies: string[] = [];
  if (edgeSurvival >= 0.5) {
    survives.push("large shapes and strong edges");
  } else {
    lost.push("fine detail smaller than one week/day cell");
    remedies.push(
      "simplify the source or use --mode binary for line art and text",
    );
  }
  if (aspectEfficiency < 0.5) {
    lost.push(
      "most of the canvas: the image aspect ratio leaves large empty areas",
    );
    remedies.push(
      `crop the source to a wide region (canvas is about ${(columns / 7).toFixed(1)}:1) or use --fit cover`,
    );
  }
  if (toneSeparability < 0.3 && options.mode !== "binary") {
    lost.push("tonal variation: most cells share one shade");
    remedies.push(
      "increase contrast with --contrast or enable --dithering for smooth gradients",
    );
  } else if (options.mode !== "binary" && toneSeparability >= 0.3) {
    survives.push("tonal structure across the five shades");
  }

  return fitReportSchema.parse({
    verdict,
    score: Math.max(0, Math.min(1, score)),
    signals: { aspectEfficiency, edgeSurvival, toneSeparability },
    survives,
    lost,
    remedies,
  });
}
