import sharp from "sharp";

import {
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
}

export interface RasterDebugResult {
  width: number;
  height: number;
  /** One quantized 0-4 intensity byte for every source pixel, row-major. */
  intensities: Uint8Array;
}

const supportedFormats = new Set(["jpeg", "png", "webp"]);

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
      throw new Error(
        `Unsupported image format: ${metadata.format ?? "unknown"}`,
      );
    }
    let pipeline = sharp(input, { failOn: "error" })
      .autoOrient()
      .flatten({ background: "white" })
      .grayscale();
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
    for (let index = 0; index < intensities.length; index += 1) {
      intensities[index] = quantize(
        data[index * info.channels] ?? 255,
        options.invert ?? false,
      );
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
      throw new Error(
        `Unsupported image format: ${metadata.format ?? "unknown"}`,
      );
    }

    const fit = options.fit ?? "contain";
    let pipeline = sharp(input, { failOn: "error" })
      .autoOrient()
      .flatten({ background: "white" })
      .resize(calendar.columns, 7, {
        fit: fit === "stretch" ? "fill" : fit,
        position: "centre",
        background: "white",
      })
      .grayscale();

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
      info.width !== calendar.columns ||
      info.height !== 7 ||
      info.channels < 1
    ) {
      throw new Error("Raster pipeline returned unexpected dimensions");
    }

    const map: IntensityMap = Array.from({ length: 7 }, (_, row) =>
      Array.from({ length: calendar.columns }, (_, column) => {
        const cell = calendar.cells[row]?.[column];
        if (cell?.inRange !== true) return 0;
        const offset = (row * calendar.columns + column) * info.channels;
        return quantize(data[offset] ?? 255, options.invert ?? false);
      }),
    );

    validateIntensityMap(map, calendar);
    return map;
  } catch (cause) {
    if (cause instanceof GitMosaicError) throw cause;
    throw imageError(input, cause);
  }
}
