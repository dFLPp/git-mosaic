import sharp from "sharp";

import {
  fullyInRangeColumnSpan,
  validateIntensityMap,
  type ContributionCalendar,
} from "@git-mosaic/calendar";
import {
  GitMosaicError,
  type Intensity,
  type IntensityMap,
} from "@git-mosaic/schemas";

export type RasterInput = string | Buffer;
export type RasterFit = "contain" | "cover" | "stretch";
export type RasterMode = "levels" | "binary";

export interface RasterImportOptions {
  /** How the source is fitted to the calendar's columns by seven rows. */
  fit?: RasterFit;
  /** Invert the quantized result (0 becomes 4, 1 becomes 3, and so on). */
  invert?: boolean;
  /**
   * Optional contrast multiplier around middle gray. `1` leaves contrast
   * unchanged, values above `1` increase it, and values between `0` and `1`
   * decrease it.
   */
  contrast?: number;
  /**
   * Quantization mode. `"levels"` maps luminance to all five intensities;
   * `"binary"` thresholds at middle gray to 0 or 4 for line art and text.
   */
  mode?: RasterMode;
  /** Stretch the grayscale histogram to full range before quantizing. */
  normalize?: boolean;
  /** Diffuse quantization error (Floyd–Steinberg); levels mode only. */
  dithering?: boolean;
}

export interface RasterDebugResult {
  width: number;
  height: number;
  /** One quantized 0-4 intensity byte for every source pixel, row-major. */
  intensities: Uint8Array;
}

const supportedFormats = new Set(["jpeg", "png", "webp"]);

/** Representative luminance for each intensity, index 0..4. */
export const LUMINANCE_BY_INTENSITY = [255, 191, 128, 64, 0] as const;

function invalidCalendar(message: string, cause?: unknown): GitMosaicError {
  return new GitMosaicError("INVALID_INTENSITY_MAP", message, {
    hint: "Provide a valid seven-row contribution calendar before importing an image",
    cause,
  });
}

function assertValidCalendar(calendar: ContributionCalendar): void {
  if (
    calendar.rows !== 7 ||
    !Number.isInteger(calendar.columns) ||
    calendar.columns <= 0 ||
    !Array.isArray(calendar.cells) ||
    calendar.cells.length !== 7 ||
    calendar.cells.some(
      (row) => !Array.isArray(row) || row.length !== calendar.columns,
    )
  ) {
    throw invalidCalendar("Calendar dimensions are invalid");
  }
}

function assertValidOptions(options: RasterImportOptions): void {
  if (
    options.contrast !== undefined &&
    (!Number.isFinite(options.contrast) || options.contrast <= 0)
  ) {
    throw new GitMosaicError(
      "UNSUPPORTED_IMAGE",
      `Invalid contrast multiplier: ${String(options.contrast)}`,
      { hint: "Use a finite contrast multiplier greater than zero" },
    );
  }
}

function quantize(luminance: number, invert: boolean): Intensity {
  let intensity: Intensity;
  if (luminance < 51) intensity = 4;
  else if (luminance < 102) intensity = 3;
  else if (luminance < 153) intensity = 2;
  else if (luminance < 204) intensity = 1;
  else intensity = 0;

  return (invert ? 4 - intensity : intensity) as Intensity;
}

function quantizeBinary(luminance: number, invert: boolean): Intensity {
  const intensity: Intensity = luminance < 128 ? 4 : 0;
  return (invert ? 4 - intensity : intensity) as Intensity;
}

function nearestIntensity(luminance: number): Intensity {
  let best: Intensity = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let level = 0; level <= 4; level += 1) {
    const distance = Math.abs(luminance - LUMINANCE_BY_INTENSITY[level]!);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = level as Intensity;
    }
  }
  return best;
}

/** Floyd–Steinberg error diffusion onto the 0..4 intensity scale. */
function ditherToIntensities(
  luminance: Float64Array,
  width: number,
  height: number,
  invert: boolean,
): Uint8Array {
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const value = luminance[index] ?? 255;
      const intensity = nearestIntensity(value);
      out[index] = invert ? 4 - intensity : intensity;
      const error = value - LUMINANCE_BY_INTENSITY[intensity]!;
      if (x + 1 < width) luminance[index + 1]! += (error * 7) / 16;
      if (y + 1 < height) {
        if (x > 0) luminance[index + width - 1]! += (error * 3) / 16;
        luminance[index + width]! += (error * 5) / 16;
        if (x + 1 < width) luminance[index + width + 1]! += (error * 1) / 16;
      }
    }
  }
  return out;
}

function imageError(input: RasterInput, cause: unknown): GitMosaicError {
  const description = typeof input === "string" ? input : "image buffer";
  return new GitMosaicError(
    "UNSUPPORTED_IMAGE",
    `Could not import ${description}`,
    {
      hint: "Use a valid PNG, JPEG, or WebP image",
      cause,
    },
  );
}

/** Quantize an image at its original, auto-oriented dimensions for debugging. */
export async function quantizeRasterForDebug(
  input: RasterInput,
  options: RasterImportOptions = {},
): Promise<RasterDebugResult> {
  assertValidOptions(options);
  try {
    const metadata = await sharp(input, { failOn: "error" }).metadata();
    if (
      metadata.format === undefined ||
      !supportedFormats.has(metadata.format)
    ) {
      throw imageError(
        input,
        `Unsupported image format: ${metadata.format ?? "unknown"}`,
      );
    }
    let pipeline = sharp(input, { failOn: "error" })
      .autoOrient()
      .flatten({ background: "white" })
      .grayscale();
    if (options.normalize === true) {
      pipeline = pipeline.normalize();
    }
    if (options.contrast !== undefined && options.contrast !== 1) {
      pipeline = pipeline.linear(
        options.contrast,
        128 * (1 - options.contrast),
      );
    }
    const { data, info } = await pipeline
      .raw()
      .toBuffer({ resolveWithObject: true });
    const intensities = new Uint8Array(info.width * info.height);
    const quantizePixel =
      options.mode === "binary"
        ? (luminance: number) =>
            quantizeBinary(luminance, options.invert ?? false)
        : (luminance: number) => quantize(luminance, options.invert ?? false);
    for (let index = 0; index < intensities.length; index += 1) {
      intensities[index] = quantizePixel(data[index * info.channels] ?? 255);
    }
    return { width: info.width, height: info.height, intensities };
  } catch (cause) {
    if (cause instanceof GitMosaicError) throw cause;
    throw imageError(input, cause);
  }
}

/**
 * Convert a PNG, JPEG, or WebP image into the contribution calendar's 0-4
 * intensity matrix. The function is pure with respect to project state: it
 * reads the input and returns a new matrix without writing any files.
 */
export async function importRasterImage(
  input: RasterInput,
  calendar: ContributionCalendar,
  options: RasterImportOptions = {},
): Promise<IntensityMap> {
  assertValidCalendar(calendar);
  assertValidOptions(options);

  try {
    const metadata = await sharp(input, { failOn: "error" }).metadata();
    if (
      metadata.format === undefined ||
      !supportedFormats.has(metadata.format)
    ) {
      throw imageError(
        input,
        `Unsupported image format: ${metadata.format ?? "unknown"}`,
      );
    }

    const fit = options.fit ?? "contain";
    const span =
      fit === "contain"
        ? fullyInRangeColumnSpan(calendar)
        : { start: 0, end: calendar.columns - 1 };
    const targetColumns = span.end - span.start + 1;
    let pipeline = sharp(input, { failOn: "error" })
      .autoOrient()
      .flatten({ background: "white" })
      .resize(targetColumns, 7, {
        fit: fit === "stretch" ? "fill" : fit,
        position: "centre",
        background: "white",
      })
      .grayscale();

    if (options.normalize === true) {
      pipeline = pipeline.normalize();
    }

    if (options.contrast !== undefined && options.contrast !== 1) {
      pipeline = pipeline.linear(
        options.contrast,
        128 * (1 - options.contrast),
      );
    }

    const { data, info } = await pipeline
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (
      info.width !== targetColumns ||
      info.height !== 7 ||
      info.channels < 1
    ) {
      throw imageError(input, "Raster pipeline returned unexpected dimensions");
    }

    let ditheredIntensities: Uint8Array | undefined;
    if (options.dithering === true && options.mode !== "binary") {
      const luminance = new Float64Array(info.width * info.height);
      for (let index = 0; index < luminance.length; index += 1) {
        luminance[index] = data[index * info.channels] ?? 255;
      }
      ditheredIntensities = ditherToIntensities(
        luminance,
        info.width,
        info.height,
        options.invert ?? false,
      );
    }

    const quantizePixel =
      options.mode === "binary"
        ? (luminance: number) =>
            quantizeBinary(luminance, options.invert ?? false)
        : (luminance: number) => quantize(luminance, options.invert ?? false);

    const map: IntensityMap = Array.from({ length: 7 }, (_, row) =>
      Array.from({ length: calendar.columns }, (_, column) => {
        const cell = calendar.cells[row]?.[column];
        if (cell?.inRange !== true) return 0;
        const localColumn = column - span.start;
        if (localColumn < 0 || localColumn >= info.width) return 0;
        const pixelIndex = row * info.width + localColumn;
        if (ditheredIntensities !== undefined) {
          return ditheredIntensities[pixelIndex] as Intensity;
        }
        const offset = pixelIndex * info.channels;
        return quantizePixel(data[offset] ?? 255);
      }),
    );

    validateIntensityMap(map, calendar);
    return map;
  } catch (cause) {
    if (cause instanceof GitMosaicError) throw cause;
    throw imageError(input, cause);
  }
}
