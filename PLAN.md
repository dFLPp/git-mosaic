# Fit Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make git-mosaic actually express uploaded art: crisp image quantization, a text renderer with a font-size ladder and honest "does not fit" refusals, an image expressibility verdict, and a WYSIWYG preview.

**Architecture:** A shared `FitReport` type in `@git-mosaic/schemas` is produced by two analyzers: a deterministic text layout engine (new `@git-mosaic/text` package, pixel fonts stamped directly onto the intensity grid — never through image resampling) and an image expressibility analyzer in `@git-mosaic/image` (content analysis: aspect efficiency, per-cell edge survival, tone separability). `@git-mosaic/core` orchestrates imports and gates `bad` verdicts behind `force`. The preview defaults to an artistic (WYSIWYG) level strategy; the quartile simulation stays available behind `--estimate`.

**Tech Stack:** TypeScript (ESM, strict), pnpm workspace, vitest, zod, sharp, commander, React (web editor only).

## Global Constraints

- Node >= 22, pnpm 11 (`packageManager: pnpm@11.9.0`), Git >= 2.30.
- All packages are ESM (`"type": "module"`); internal imports use `.js` extensions.
- Intensity values are `0..4`; the calendar always has 7 rows (Sunday first); week starts Sunday.
- Determinism: no `Math.random`, no time-dependent output in library code (timestamps are injected parameters, following `now = new Date().toISOString()` parameter pattern).
- Errors are `GitMosaicError` from `@git-mosaic/schemas` with a registered code; never throw bare `Error` from library code.
- Run tests from the workspace root: `pnpm test` (vitest), or a single file: `pnpm vitest run <path>`.
- Before each commit: `pnpm format` (prettier writes) so `pnpm check` stays green.
- New source files follow existing style: named exports, no default exports, JSDoc only where behavior is non-obvious.
- **Core invariant:** `@git-mosaic/text` must never depend on `sharp`. Text is stamped cell-by-cell onto the intensity grid, never resampled through an image pipeline — that is precisely why rendering text as a PNG and importing it produces mud today, and why the new path produces legible glyphs. Its `package.json` dependencies stay `@git-mosaic/calendar` and `@git-mosaic/schemas` only.
- The workspace was not a git repository at plan time — Task 1 fixes that; every task ends with a commit.
- Existing behavior contract: `RasterImportOptions` defaults must not change at the `@git-mosaic/image` layer (existing tests depend on them). New defaults (`normalize: true`) are applied at the `@git-mosaic/core` import layer only.

---

### Task 1: Initialize git repository

**Files:**

- Create: `.git/` (via `git init`)

**Interfaces:**

- Consumes: nothing
- Produces: a repository so every later task can commit; baseline commit of the current tree

- [x] **Step 1: Initialize and verify**

Run:

```bash
cd /home/default/projects/git-mosaic
git init -b main
git add -A
git status --short | head -20
```

Expected: staged file list; no errors. `.gitignore` already exists and excludes `node_modules`, `dist`.

- [x] **Step 2: Baseline commit**

```bash
git commit -m "chore: baseline before fit-engine work

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [x] **Step 3: Sanity — build and test the baseline**

Run: `pnpm install && pnpm build && pnpm test`
Expected: all existing tests PASS. If the baseline fails, STOP and report — do not fix pre-existing failures inside this plan.

---

### Task 2: Schemas — fit report, text source, new error codes

**Files:**

- Modify: `packages/schemas/src/errors.ts` (add three codes)
- Modify: `packages/schemas/src/index.ts` (fit report + text source + image source fields)
- Test: `packages/schemas/src/fit.test.ts` (new)

**Interfaces:**

- Consumes: existing `zod` patterns in `packages/schemas/src/index.ts`
- Produces (used by Tasks 6–14):
  - `fitVerdictSchema`, `fitReportSchema`, types `FitVerdict`, `FitReport`
  - `textSourceSchema` in the `mosaicSourceSchema` discriminated union
  - `imageSourceSchema` gains `mode` (`"levels" | "binary"`, default `"levels"`) and `normalize` (boolean, default `true`)
  - Error names `TEXT_DOES_NOT_FIT` (GM016), `UNSUPPORTED_TEXT` (GM017), `LOW_EXPRESSIBILITY` (GM018)

- [x] **Step 1: Write the failing test**

Create `packages/schemas/src/fit.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  errorCodes,
  fitReportSchema,
  imageSourceSchema,
  mosaicSourceSchema,
  textSourceSchema,
} from "./index.js";

describe("fit report schema", () => {
  it("accepts a full report", () => {
    const report = fitReportSchema.parse({
      verdict: "degraded",
      score: 0.42,
      signals: {
        aspectEfficiency: 0.9,
        edgeSurvival: 0.4,
        toneSeparability: 0.7,
      },
      survives: ["large shapes and strong edges"],
      lost: ["fine detail smaller than one week/day cell"],
      remedies: [
        "simplify the source or use --mode binary for line art and text",
      ],
    });
    expect(report.verdict).toBe("degraded");
  });

  it("accepts a text report with font signals", () => {
    const report = fitReportSchema.parse({
      verdict: "good",
      score: 0.85,
      signals: { fontTier: "4x5", columnsUsed: 39, columnsAvailable: 51 },
      survives: ["every character at the 4x5 pixel font"],
      lost: [],
      remedies: [],
    });
    expect(report.signals.fontTier).toBe("4x5");
  });

  it("rejects an out-of-range score", () => {
    expect(() =>
      fitReportSchema.parse({
        verdict: "good",
        score: 1.5,
        signals: {},
        survives: [],
        lost: [],
        remedies: [],
      }),
    ).toThrow();
  });
});

describe("source schemas", () => {
  it("defaults new image source fields", () => {
    const source = imageSourceSchema.parse({
      type: "image",
      path: "assets/source.png",
    });
    expect(source.mode).toBe("levels");
    expect(source.normalize).toBe(true);
    expect(source.dithering).toBe(false);
  });

  it("accepts a text source through the union", () => {
    const source = mosaicSourceSchema.parse({
      type: "text",
      content: "LOADING...",
      font: "4x5",
    });
    expect(source).toEqual({
      type: "text",
      content: "LOADING...",
      font: "4x5",
      align: "center",
    });
  });

  it("rejects empty and oversized text content", () => {
    expect(() =>
      textSourceSchema.parse({ type: "text", content: "", font: "3x5" }),
    ).toThrow();
    expect(() =>
      textSourceSchema.parse({
        type: "text",
        content: "x".repeat(201),
        font: "3x5",
      }),
    ).toThrow();
  });
});

describe("new error codes", () => {
  it("registers fit-engine error codes", () => {
    expect(errorCodes.TEXT_DOES_NOT_FIT).toBe("GM016");
    expect(errorCodes.UNSUPPORTED_TEXT).toBe("GM017");
    expect(errorCodes.LOW_EXPRESSIBILITY).toBe("GM018");
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/schemas/src/fit.test.ts`
Expected: FAIL — `fitReportSchema` is not exported.

- [x] **Step 3: Implement**

In `packages/schemas/src/errors.ts`, extend the `errorCodes` object (after `UNSUPPORTED_IMAGE: "GM015",`):

```ts
  TEXT_DOES_NOT_FIT: "GM016",
  UNSUPPORTED_TEXT: "GM017",
  LOW_EXPRESSIBILITY: "GM018",
```

In `packages/schemas/src/index.ts`:

1. Add `mode` and `normalize` to `imageSourceSchema`:

```ts
export const imageSourceSchema = z.object({
  type: z.literal("image"),
  path: z.string().min(1),
  fit: z.enum(["contain", "cover", "stretch"]).default("contain"),
  invert: z.boolean().default(false),
  dithering: z.boolean().default(false),
  mode: z.enum(["levels", "binary"]).default("levels"),
  normalize: z.boolean().default(true),
});
```

2. Add the text source directly below `imageSourceSchema` and register it in the union:

```ts
export const fontTierSchema = z.enum(["5x7", "4x5", "3x5"]);

export const textSourceSchema = z.object({
  type: z.literal("text"),
  content: z.string().min(1).max(200),
  font: fontTierSchema,
  align: z.enum(["left", "center", "right"]).default("center"),
});

export const mosaicSourceSchema = z.discriminatedUnion("type", [
  emptySourceSchema,
  matrixSourceSchema,
  imageSourceSchema,
  textSourceSchema,
]);
```

3. Add the fit report below the source schemas:

```ts
export const fitVerdictSchema = z.enum(["good", "degraded", "bad"]);

export const fitReportSchema = z.object({
  verdict: fitVerdictSchema,
  score: z.number().min(0).max(1),
  signals: z.object({
    aspectEfficiency: z.number().min(0).max(1).optional(),
    edgeSurvival: z.number().min(0).max(1).optional(),
    toneSeparability: z.number().min(0).max(1).optional(),
    fontTier: fontTierSchema.optional(),
    columnsUsed: z.number().int().nonnegative().optional(),
    columnsAvailable: z.number().int().positive().optional(),
  }),
  survives: z.array(z.string()),
  lost: z.array(z.string()),
  remedies: z.array(z.string()),
});
```

4. Add the types next to the existing `z.infer` exports:

```ts
export type FontTier = z.infer<typeof fontTierSchema>;
export type FitVerdict = z.infer<typeof fitVerdictSchema>;
export type FitReport = z.infer<typeof fitReportSchema>;
export type TextSource = z.infer<typeof textSourceSchema>;
```

- [x] **Step 4: Run tests**

Run: `pnpm vitest run packages/schemas/src/fit.test.ts && pnpm vitest run packages/schemas`
Expected: new file PASS, existing schema tests PASS (the new image-source fields all have defaults, so stored projects still parse).

- [x] **Step 5: Commit**

```bash
pnpm format
git add packages/schemas
git commit -m "feat(schemas): add fit report, text source, and fit-engine error codes

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Raster quantization — normalize option and binary mode

**Files:**

- Modify: `packages/image/src/raster.ts`
- Test: `packages/image/src/raster-modes.test.ts` (new)

**Interfaces:**

- Consumes: `importRasterImage(input, calendar, options)` from `packages/image/src/raster.ts:144`
- Produces (used by Tasks 4–7):
  - `RasterImportOptions` gains `mode?: "levels" | "binary"` (default `"levels"`) and `normalize?: boolean` (default `false` at this layer — core flips the default on in Task 7)
  - exported helper `LUMINANCE_BY_INTENSITY: readonly [255, 191, 128, 64, 0]`

- [x] **Step 1: Write the failing test**

Create `packages/image/src/raster-modes.test.ts`:

```ts
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
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/image/src/raster-modes.test.ts`
Expected: FAIL — `mode`/`normalize` are not valid options (TypeScript error) or binary assertions fail.

- [x] **Step 3: Implement**

In `packages/image/src/raster.ts`:

1. Extend the options interface:

```ts
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
}
```

2. Add the shared luminance table and a binary quantizer next to `quantize`:

```ts
/** Representative luminance for each intensity, index 0..4. */
export const LUMINANCE_BY_INTENSITY = [255, 191, 128, 64, 0] as const;

function quantizeBinary(luminance: number, invert: boolean): Intensity {
  const intensity: Intensity = luminance < 128 ? 4 : 0;
  return (invert ? ((4 - intensity) as Intensity) : intensity) as Intensity;
}
```

3. In BOTH `quantizeRasterForDebug` and `importRasterImage`, insert normalize into the pipeline directly after `.grayscale()`:

```ts
if (options.normalize === true) {
  pipeline = pipeline.normalize();
}
```

4. In both functions, pick the quantizer once before the pixel loop and use it:

```ts
const quantizePixel =
  options.mode === "binary"
    ? (luminance: number) => quantizeBinary(luminance, options.invert ?? false)
    : (luminance: number) => quantize(luminance, options.invert ?? false);
```

In `importRasterImage`'s map construction, replace `return quantize(data[offset] ?? 255, options.invert ?? false);` with `return quantizePixel(data[offset] ?? 255);`. In `quantizeRasterForDebug`'s loop, replace the `quantize(...)` call the same way.

- [x] **Step 4: Run tests**

Run: `pnpm vitest run packages/image`
Expected: new file PASS and the existing `raster.test.ts` PASS unchanged (both new options default off).

- [x] **Step 5: Commit**

```bash
pnpm format
git add packages/image
git commit -m "feat(image): add binary quantization mode and normalize option

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Raster — Floyd–Steinberg dithering

**Files:**

- Modify: `packages/image/src/raster.ts`
- Test: `packages/image/src/raster-dither.test.ts` (new)

**Interfaces:**

- Consumes: `LUMINANCE_BY_INTENSITY`, `RasterImportOptions` from Task 3
- Produces: `RasterImportOptions.dithering?: boolean` (default `false`; only meaningful in `"levels"` mode). The already-declared-but-dead `dithering` field in `imageSourceSchema` becomes real.

- [x] **Step 1: Write the failing test**

Create `packages/image/src/raster-dither.test.ts`:

```ts
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
});
```

Direction note: `x = 0` is luminance 0 (black) and dark pixels map to HIGH intensity, so the left columns carry higher intensities than the right — that is what the second test asserts.

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/image/src/raster-dither.test.ts`
Expected: FAIL — `dithering` not a valid option / rows identical in both cases.

- [x] **Step 3: Implement**

In `packages/image/src/raster.ts`:

1. Add `dithering?: boolean;` to `RasterImportOptions` with doc comment `/** Diffuse quantization error (Floyd–Steinberg); levels mode only. */`.

2. Add below `quantizeBinary`:

```ts
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
```

3. In `importRasterImage`, after the `toBuffer` call and the dimension check, branch: when `options.dithering === true && options.mode !== "binary"`, build a luminance array for the whole resized grid, dither it, and read intensities from the result instead of quantizing per pixel:

```ts
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
```

and in the cell callback replace the quantize call with:

```ts
const pixelIndex = row * info.width + column;
if (ditheredIntensities !== undefined) {
  return ditheredIntensities[pixelIndex] as Intensity;
}
const offset = pixelIndex * info.channels;
return quantizePixel(data[offset] ?? 255);
```

(Note: `row * info.width + column` equals the previous indexing because `info.width === calendar.columns` until Task 5 changes placement; Task 5 updates this indexing consistently.)

- [x] **Step 4: Run tests**

Run: `pnpm vitest run packages/image`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
pnpm format
git add packages/image
git commit -m "feat(image): implement Floyd-Steinberg dithering for levels mode

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 5: Calendar span helper + no-clip contain placement

**Files:**

- Modify: `packages/calendar/src/index.ts` (new exported helper)
- Modify: `packages/image/src/raster.ts` (contain placement)
- Test: `packages/calendar/src/span.test.ts` (new), `packages/image/src/raster-span.test.ts` (new)

**Interfaces:**

- Consumes: `ContributionCalendar` from `@git-mosaic/calendar`
- Produces (used by Tasks 6 and 10):
  - `fullyInRangeColumnSpan(calendar: ContributionCalendar): { start: number; end: number }` exported from `@git-mosaic/calendar`
  - `importRasterImage` with `fit: "contain"` places art only inside that span, so no in-range artwork pixel is ever zeroed by partial first/last weeks. `cover`/`stretch` keep full-grid behavior (they crop or distort by contract).

- [x] **Step 1: Write the failing tests**

Create `packages/calendar/src/span.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { buildCalendar, fullyInRangeColumnSpan } from "./index.js";

describe("fullyInRangeColumnSpan", () => {
  it("skips partial first and last weeks (2025 starts Wednesday, ends Wednesday)", () => {
    const calendar = buildCalendar(
      { from: "2025-01-01", to: "2025-12-31" },
      "UTC",
    );
    expect(calendar.columns).toBe(53);
    expect(fullyInRangeColumnSpan(calendar)).toEqual({ start: 1, end: 51 });
  });

  it("uses the whole grid when the range is Sunday-aligned", () => {
    const calendar = buildCalendar(
      { from: "2023-01-01", to: "2023-12-30" },
      "UTC",
    );
    expect(fullyInRangeColumnSpan(calendar)).toEqual({
      start: 0,
      end: calendar.columns - 1,
    });
  });
});
```

Create `packages/image/src/raster-span.test.ts`:

```ts
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
```

- [x] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/calendar/src/span.test.ts packages/image/src/raster-span.test.ts`
Expected: FAIL — `fullyInRangeColumnSpan` not exported; contain currently paints `map[3][0]`.

- [x] **Step 3: Implement**

In `packages/calendar/src/index.ts`, add after `buildCalendar`:

```ts
/**
 * The inclusive range of columns whose seven cells are all in range. Partial
 * first/last weeks are excluded so artwork is never clipped by out-of-range
 * cells.
 */
export function fullyInRangeColumnSpan(calendar: ContributionCalendar): {
  start: number;
  end: number;
} {
  const isFull = (column: number): boolean =>
    calendar.cells.every((row) => row[column]?.inRange === true);
  let start = 0;
  while (start < calendar.columns && !isFull(start)) start += 1;
  let end = calendar.columns - 1;
  while (end >= start && !isFull(end)) end -= 1;
  if (start > end) {
    throw new GitMosaicError(
      "INVALID_DATE_RANGE",
      "The period does not contain a full Sunday-to-Saturday week",
      { hint: "Use a period of at least one full week" },
    );
  }
  return { start, end };
}
```

(`GitMosaicError` is already imported in that file.)

In `packages/image/src/raster.ts`:

1. Import the helper: add `fullyInRangeColumnSpan` to the existing `@git-mosaic/calendar` import.
2. In `importRasterImage`, compute the target box before building the pipeline:

```ts
const span =
  (options.fit ?? "contain") === "contain"
    ? fullyInRangeColumnSpan(calendar)
    : { start: 0, end: calendar.columns - 1 };
const targetColumns = span.end - span.start + 1;
```

3. Resize to `targetColumns` instead of `calendar.columns` (`.resize(targetColumns, 7, { ... })`) and update the dimension check to `info.width !== targetColumns`.
4. In the cell callback, translate grid column to image column:

```ts
const cell = calendar.cells[row]?.[column];
if (cell?.inRange !== true) return 0;
const localColumn = column - span.start;
if (localColumn < 0 || localColumn >= info.width) return 0;
const pixelIndex = row * info.width + localColumn;
```

(The dithering branch from Task 4 already indexes with `pixelIndex`; it stays correct.)

- [x] **Step 4: Run tests — including possible existing-expectation updates**

Run: `pnpm vitest run packages/image packages/calendar`
Expected: new tests PASS. If any pre-existing case in `packages/image/src/raster.test.ts` asserts contain-fit values in partial edge columns, update that expectation to the new rule ("contain never paints partial columns") — the new rule is the specified behavior, and note the change in the commit body.

- [x] **Step 5: Commit**

```bash
pnpm format
git add packages/calendar packages/image
git commit -m "fix(image): fit contain art inside fully in-range weeks to stop corner clipping

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Image expressibility analyzer

**Files:**

- Create: `packages/image/src/expressibility.ts`
- Modify: `packages/image/src/index.ts` (re-export)
- Test: `packages/image/src/expressibility.test.ts` (new)

**Interfaces:**

- Consumes: `importRasterImage`, `LUMINANCE_BY_INTENSITY`, `RasterImportOptions` (Task 3–5), `fullyInRangeColumnSpan` (Task 5), `fitReportSchema`/`FitReport` (Task 2), `sharp`
- Produces (used by Task 7):
  - `analyzeExpressibility(input: RasterInput, calendar: ContributionCalendar, options?: RasterImportOptions): Promise<FitReport>`

**Design (fixed constants):**

- `aspectEfficiency`: ratio of image aspect to canvas aspect, `min/max` so it is `<= 1`; forced to `1` for `cover`/`stretch` (they fill the canvas by cropping/distorting).
- `edgeSurvival`: per-cell pooled gradient energy comparison. Downscale-import the image (the real pipeline), upscale each cell back to a 4×4 block using `LUMINANCE_BY_INTENSITY`, render the original to the same reference size, then compare per-cell pooled gradient sums with `sum(min(orig, round)) / sum(orig)`. Pooling per cell makes the metric insensitive to sub-cell misalignment.
- `toneSeparability`: Shannon entropy of the in-range intensity histogram normalized by `log2(5)`.
- `score = edgeSurvival * sqrt(aspectEfficiency)`; verdict `good >= 0.6`, `degraded >= 0.35`, else `bad`. Tone separability contributes remedies, not score.

- [x] **Step 1: Write the failing test**

Create `packages/image/src/expressibility.test.ts`:

```ts
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
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/image/src/expressibility.test.ts`
Expected: FAIL — module does not exist.

- [x] **Step 3: Implement**

Create `packages/image/src/expressibility.ts`:

```ts
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
```

In `packages/image/src/index.ts`, add:

```ts
export * from "./expressibility.js";
```

- [x] **Step 4: Run tests**

Run: `pnpm vitest run packages/image`
Expected: PASS. If a verdict assertion fails, print the report in the failing test (`console.log(report)`) and check which signal is off; adjust the FIXTURE (e.g., stronger noise, bigger rectangle) if the fixture is weaker than its name claims. Only change thresholds if a fixture is unambiguous and still misclassified, and record the new threshold in this file's Design block and the commit message.

- [x] **Step 5: Commit**

```bash
pnpm format
git add packages/image
git commit -m "feat(image): add expressibility analyzer producing fit reports

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Core image import — fit report and force gate

**Files:**

- Modify: `packages/core/src/project.ts` (`importImage` at :213, `importImageBuffer` at :249)
- Modify: `apps/cli/src/program.ts:212-224` (minimal call-site fix; full UX in Task 13)
- Modify: `apps/web/src/server.ts:426-443` (minimal call-site fix; full UX in Task 14)
- Test: `packages/core/src/import-image-report.test.ts` (new); update existing `packages/core/src/project.test.ts` expectations if they destructure the old return type

**Interfaces:**

- Consumes: `analyzeExpressibility` (Task 6), `FitReport` (Task 2)
- Produces (used by Tasks 13–14):
  - `export interface ImageImportOptions extends RasterImportOptions { force?: boolean }`
  - `importImage(projectDirectory, imageFile, options?: ImageImportOptions, now?): Promise<ImageImportResult>`
  - `importImageBuffer(projectDirectory, fileName, buffer, options?: ImageImportOptions, now?): Promise<ImageImportResult>`
  - `export interface ImageImportResult { project: MosaicProject; report: FitReport }`
  - Core defaults `normalize` to `true` when the caller does not set it.
  - `report.verdict === "bad"` without `force: true` throws `GitMosaicError("LOW_EXPRESSIBILITY", ...)` BEFORE any file is written.

- [x] **Step 1: Write the failing test**

Create `packages/core/src/import-image-report.test.ts`:

```ts
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { GitMosaicError } from "@git-mosaic/schemas";

import { importImageBuffer, initializeProject } from "./project.js";

async function projectDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "gm-fit-"));
  await initializeProject(directory, {
    name: "fit-test",
    period: { from: "2023-01-01", to: "2023-12-30" },
    timezone: "UTC",
  });
  return directory;
}

async function silhouettePng(): Promise<Buffer> {
  const width = 520;
  const height = 70;
  const pixels = new Uint8Array(width * height).fill(255);
  for (let y = 10; y < 60; y += 1) {
    pixels.fill(0, y * width + 100, y * width + 420);
  }
  return sharp(pixels, { raw: { width, height, channels: 1 } })
    .png()
    .toBuffer();
}

async function noisePng(): Promise<Buffer> {
  const width = 520;
  const height = 70;
  const pixels = new Uint8Array(width * height);
  let state = 42;
  for (let index = 0; index < pixels.length; index += 1) {
    state = (state * 1103515245 + 12345) % 2147483648;
    pixels[index] = state % 2 === 0 ? 0 : 255;
  }
  return sharp(pixels, { raw: { width, height, channels: 1 } })
    .png()
    .toBuffer();
}

describe("importImageBuffer fit gate", () => {
  it("returns the project and a fit report for good art", async () => {
    const directory = await projectDirectory();
    const { project, report } = await importImageBuffer(
      directory,
      "art.png",
      await silhouettePng(),
    );
    expect(project.source.type).toBe("image");
    expect(report.verdict).toBe("good");
    if (project.source.type === "image") {
      expect(project.source.normalize).toBe(true);
      expect(project.source.mode).toBe("levels");
    }
  });

  it("refuses bad art without force and writes nothing", async () => {
    const directory = await projectDirectory();
    await expect(
      importImageBuffer(directory, "noise.png", await noisePng()),
    ).rejects.toMatchObject({ code: "GM018" });
    const stored = JSON.parse(
      await readFile(path.join(directory, "mosaic.json"), "utf8"),
    ) as { source: { type: string } };
    expect(stored.source.type).not.toBe("image");
  });

  it("imports bad art with force: true", async () => {
    const directory = await projectDirectory();
    const { report } = await importImageBuffer(
      directory,
      "noise.png",
      await noisePng(),
      {
        force: true,
      },
    );
    expect(report.verdict).toBe("bad");
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/core/src/import-image-report.test.ts`
Expected: FAIL — return value has no `report`; no gate.

- [x] **Step 3: Implement**

In `packages/core/src/project.ts`:

1. Extend imports from `@git-mosaic/image`: add `analyzeExpressibility`; from `@git-mosaic/schemas`: add `type FitReport`.
2. Define next to the import functions:

```ts
export interface ImageImportOptions extends RasterImportOptions {
  /** Import even when the expressibility verdict is `bad`. */
  force?: boolean;
}

export interface ImageImportResult {
  project: MosaicProject;
  report: FitReport;
}

function withCoreImageDefaults(
  options: ImageImportOptions,
): RasterImportOptions {
  const { force: _force, ...raster } = options;
  return { normalize: true, ...raster };
}

function assertExpressible(report: FitReport, force: boolean): void {
  if (report.verdict === "bad" && !force) {
    throw new GitMosaicError(
      "LOW_EXPRESSIBILITY",
      "The image will not survive the contribution grid",
      {
        hint:
          report.remedies.length > 0
            ? `${report.remedies.join("; ")} (or pass force to import anyway)`
            : "Pass force to import anyway",
      },
    );
  }
}
```

3. Change `importImage` (project.ts:213) to:
   - accept `options: ImageImportOptions = {}`,
   - compute `const rasterOptions = withCoreImageDefaults(options);`,
   - call `const report = await analyzeExpressibility(sourcePath, calendar, rasterOptions);` and `assertExpressible(report, options.force === true);` BEFORE `copyFile`,
   - pass `rasterOptions` to `importRasterImage`,
   - persist the real option values in `source`:

```ts
    source: {
      type: "image",
      path: relativeAssetPath.split(path.sep).join("/"),
      fit: rasterOptions.fit ?? "contain",
      invert: rasterOptions.invert ?? false,
      dithering: rasterOptions.dithering ?? false,
      mode: rasterOptions.mode ?? "levels",
      normalize: rasterOptions.normalize ?? true,
    },
```

- return `{ project: updated, report }` with return type `Promise<ImageImportResult>`.

4. Apply the same transformation to `importImageBuffer` (project.ts:249) — analyze from `buffer`, gate before `writeFile`, persist real option values, return `{ project: updated, report }`.

Minimal call-site fixes so the workspace still compiles (full UX comes later):

- `apps/cli/src/program.ts` `import image` action (line ~212): change `const project = await importImage(...)` to `const { project } = await importImage(...)`.
- `apps/web/src/server.ts` `/api/image/import` (line ~435): change `const project = await importImageBuffer(...)` to `const { project, report } = await importImageBuffer(...)` and respond `sendJson(response, 200, { project, report });`.

- [x] **Step 4: Run tests and typecheck**

Run: `pnpm vitest run packages/core apps && pnpm typecheck`
Expected: new test PASS. Update any existing expectation in `packages/core/src/project.test.ts` and `apps/web/src/server.test.ts` that used the old `importImage`/`importImageBuffer` return shape: destructure `{ project }` and, where a test imports an image fixture that now scores `bad`, pass `{ force: true }`. Do not weaken assertions otherwise.

- [x] **Step 5: Commit**

```bash
pnpm format
git add packages/core apps
git commit -m "feat(core): gate image imports behind expressibility fit reports

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 8: `@git-mosaic/text` package — pixel fonts

**Files:**

- Create: `packages/text/package.json`, `packages/text/tsconfig.json`, `packages/text/tsconfig.build.json` (copy the two tsconfig files from `packages/calendar/` verbatim)
- Create: `packages/text/src/index.ts`, `packages/text/src/fonts.ts`
- Modify: `vitest.config.ts` (alias for `@git-mosaic/text`)
- Test: `packages/text/src/fonts.test.ts` (new)

**Interfaces:**

- Consumes: `@git-mosaic/schemas` (`FontTier`)
- Produces (used by Tasks 9–10):
  - `interface PixelFont { tier: FontTier; height: number; startRow: number; glyphs: Record<string, readonly string[]> }`
  - `FONTS: readonly PixelFont[]` ordered largest-first (`5x7`, `4x5`, `3x5`)
  - `CHARSET: ReadonlySet<string>` — `A-Z`, `0-9`, space, `. ! ? - :`
  - Glyph encoding: array of strings, one per row, `#` = on, `.` = off; all rows of one glyph share one width; widths vary per glyph.
  - `startRow` is where the glyph block sits vertically on the 7-row canvas (0 for 7-row font, 1 for 5-row fonts, leaving Sunday and Saturday rows blank).

- [x] **Step 1: Scaffold the package**

`packages/text/package.json`:

```json
{
  "name": "@git-mosaic/text",
  "version": "0.1.0",
  "description": "Pixel-font text layout for git-mosaic contribution canvases",
  "license": "MIT",
  "type": "module",
  "files": ["dist"],
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "engines": {
    "node": ">=22"
  },
  "publishConfig": {
    "access": "public",
    "provenance": true
  },
  "sideEffects": false,
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "clean": "node ../../scripts/clean-package.mjs",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@git-mosaic/calendar": "workspace:*",
    "@git-mosaic/schemas": "workspace:*"
  }
}
```

Copy tsconfigs verbatim (they are path-independent — they extend `../../tsconfig.base.json` and carry no `references` array):

```bash
cp packages/calendar/tsconfig.json packages/calendar/tsconfig.build.json packages/text/
```

In `vitest.config.ts`, add to the `alias` map (before the `@git-mosaic/schemas` entries to keep longest-prefix clarity):

```ts
      "@git-mosaic/text": fileURLToPath(
        new URL("./packages/text/src/index.ts", import.meta.url),
      ),
```

`packages/text/src/index.ts` (for now):

```ts
export * from "./fonts.js";
```

Run: `pnpm install` (links the new workspace package).

- [x] **Step 2: Write the failing test**

Create `packages/text/src/fonts.test.ts`:

```ts
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
```

- [x] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run packages/text/src/fonts.test.ts`
Expected: FAIL — `./fonts.js` does not exist.

- [x] **Step 4: Implement the fonts**

Create `packages/text/src/fonts.ts` with exactly this content (glyphs are hand-designed; the aesthetics may be tuned later, but every structural test above must hold):

```ts
import type { FontTier } from "@git-mosaic/schemas";

export interface PixelFont {
  tier: FontTier;
  /** Glyph height in rows. */
  height: number;
  /** First canvas row the glyph block occupies (7-row canvas). */
  startRow: number;
  /** Rows of '#' (on) and '.' (off); widths vary per glyph. */
  glyphs: Record<string, readonly string[]>;
}

const FONT_5X7: PixelFont = {
  tier: "5x7",
  height: 7,
  startRow: 0,
  glyphs: {
    A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
    B: ["####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."],
    C: [".###.", "#...#", "#....", "#....", "#....", "#...#", ".###."],
    D: ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
    E: ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
    F: ["#####", "#....", "#....", "####.", "#....", "#....", "#...."],
    G: [".###.", "#...#", "#....", "#.###", "#...#", "#...#", ".###."],
    H: ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
    I: ["###", ".#.", ".#.", ".#.", ".#.", ".#.", "###"],
    J: ["....#", "....#", "....#", "....#", "....#", "#...#", ".###."],
    K: ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"],
    L: ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
    M: ["#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"],
    N: ["#...#", "##..#", "#.#.#", "#..##", "#...#", "#...#", "#...#"],
    O: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
    P: ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."],
    Q: [".###.", "#...#", "#...#", "#...#", "#.#.#", "#..#.", ".##.#"],
    R: ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
    S: [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
    T: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
    U: ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
    V: ["#...#", "#...#", "#...#", "#...#", "#...#", ".#.#.", "..#.."],
    W: ["#...#", "#...#", "#...#", "#.#.#", "#.#.#", "##.##", "#...#"],
    X: ["#...#", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "#...#"],
    Y: ["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."],
    Z: ["#####", "....#", "...#.", "..#..", ".#...", "#....", "#####"],
    "0": [".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."],
    "1": ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
    "2": [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
    "3": [".###.", "#...#", "....#", "..##.", "....#", "#...#", ".###."],
    "4": ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
    "5": ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
    "6": [".###.", "#....", "#....", "####.", "#...#", "#...#", ".###."],
    "7": ["#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."],
    "8": [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
    "9": [".###.", "#...#", "#...#", ".####", "....#", "....#", ".###."],
    " ": ["..", "..", "..", "..", "..", "..", ".."],
    ".": ["..", "..", "..", "..", "..", "##", "##"],
    "!": ["#", "#", "#", "#", "#", ".", "#"],
    "?": [".###.", "#...#", "....#", "...#.", "..#..", ".....", "..#.."],
    "-": ["....", "....", "....", "####", "....", "....", "...."],
    ":": [".", ".", "#", ".", ".", "#", "."],
  },
};

const FONT_4X5: PixelFont = {
  tier: "4x5",
  height: 5,
  startRow: 1,
  glyphs: {
    A: [".##.", "#..#", "####", "#..#", "#..#"],
    B: ["###.", "#..#", "###.", "#..#", "###."],
    C: [".###", "#...", "#...", "#...", ".###"],
    D: ["###.", "#..#", "#..#", "#..#", "###."],
    E: ["####", "#...", "###.", "#...", "####"],
    F: ["####", "#...", "###.", "#...", "#..."],
    G: [".###", "#...", "#.##", "#..#", ".###"],
    H: ["#..#", "#..#", "####", "#..#", "#..#"],
    I: ["###", ".#.", ".#.", ".#.", "###"],
    J: ["...#", "...#", "...#", "#..#", ".##."],
    K: ["#..#", "#.#.", "##..", "#.#.", "#..#"],
    L: ["#...", "#...", "#...", "#...", "####"],
    M: ["#...#", "##.##", "#.#.#", "#...#", "#...#"],
    N: ["#..#", "##.#", "#.##", "#..#", "#..#"],
    O: [".##.", "#..#", "#..#", "#..#", ".##."],
    P: ["###.", "#..#", "###.", "#...", "#..."],
    Q: [".##.", "#..#", "#..#", "#.#.", ".#.#"],
    R: ["###.", "#..#", "###.", "#.#.", "#..#"],
    S: [".###", "#...", ".##.", "...#", "###."],
    T: ["###", ".#.", ".#.", ".#.", ".#."],
    U: ["#..#", "#..#", "#..#", "#..#", ".##."],
    V: ["#...#", "#...#", ".#.#.", ".#.#.", "..#.."],
    W: ["#...#", "#...#", "#.#.#", "##.##", "#...#"],
    X: ["#..#", "#..#", ".##.", "#..#", "#..#"],
    Y: ["#...#", ".#.#.", "..#..", "..#..", "..#.."],
    Z: ["####", "..#.", ".#..", "#...", "####"],
    "0": [".##.", "#.##", "##.#", "#..#", ".##."],
    "1": [".#.", "##.", ".#.", ".#.", "###"],
    "2": [".##.", "#..#", "..#.", ".#..", "####"],
    "3": ["###.", "...#", ".##.", "...#", "###."],
    "4": ["#..#", "#..#", "####", "...#", "...#"],
    "5": ["####", "#...", "###.", "...#", "###."],
    "6": [".##.", "#...", "###.", "#..#", ".##."],
    "7": ["####", "...#", "..#.", ".#..", ".#.."],
    "8": [".##.", "#..#", ".##.", "#..#", ".##."],
    "9": [".##.", "#..#", ".###", "...#", ".##."],
    " ": ["..", "..", "..", "..", ".."],
    ".": [".", ".", ".", ".", "#"],
    "!": ["#", "#", "#", ".", "#"],
    "?": ["###.", "...#", "..#.", "....", "..#."],
    "-": ["...", "...", "###", "...", "..."],
    ":": [".", "#", ".", "#", "."],
  },
};

const FONT_3X5: PixelFont = {
  tier: "3x5",
  height: 5,
  startRow: 1,
  glyphs: {
    A: [".#.", "#.#", "###", "#.#", "#.#"],
    B: ["##.", "#.#", "##.", "#.#", "##."],
    C: [".##", "#..", "#..", "#..", ".##"],
    D: ["##.", "#.#", "#.#", "#.#", "##."],
    E: ["###", "#..", "##.", "#..", "###"],
    F: ["###", "#..", "##.", "#..", "#.."],
    G: [".##", "#..", "#.#", "#.#", ".##"],
    H: ["#.#", "#.#", "###", "#.#", "#.#"],
    I: ["###", ".#.", ".#.", ".#.", "###"],
    J: ["..#", "..#", "..#", "#.#", ".#."],
    K: ["#.#", "##.", "#..", "##.", "#.#"],
    L: ["#..", "#..", "#..", "#..", "###"],
    M: ["#.#", "###", "###", "#.#", "#.#"],
    N: ["#.#", "###", "#.#", "#.#", "#.#"],
    O: [".#.", "#.#", "#.#", "#.#", ".#."],
    P: ["##.", "#.#", "##.", "#..", "#.."],
    Q: [".#.", "#.#", "#.#", ".#.", "..#"],
    R: ["##.", "#.#", "##.", "#.#", "#.#"],
    S: [".##", "#..", ".#.", "..#", "##."],
    T: ["###", ".#.", ".#.", ".#.", ".#."],
    U: ["#.#", "#.#", "#.#", "#.#", "###"],
    V: ["#.#", "#.#", "#.#", "#.#", ".#."],
    W: ["#.#", "#.#", "###", "###", "#.#"],
    X: ["#.#", "#.#", ".#.", "#.#", "#.#"],
    Y: ["#.#", "#.#", ".#.", ".#.", ".#."],
    Z: ["###", "..#", ".#.", "#..", "###"],
    "0": ["###", "#.#", "#.#", "#.#", "###"],
    "1": [".#.", "##.", ".#.", ".#.", "###"],
    "2": ["##.", "..#", ".#.", "#..", "###"],
    "3": ["##.", "..#", ".#.", "..#", "##."],
    "4": ["#.#", "#.#", "###", "..#", "..#"],
    "5": ["###", "#..", "##.", "..#", "##."],
    "6": [".##", "#..", "###", "#.#", "###"],
    "7": ["###", "..#", ".#.", ".#.", ".#."],
    "8": ["###", "#.#", "###", "#.#", "###"],
    "9": ["###", "#.#", "###", "..#", "##."],
    " ": ["..", "..", "..", "..", ".."],
    ".": [".", ".", ".", ".", "#"],
    "!": ["#", "#", "#", ".", "#"],
    "?": ["##.", "..#", ".#.", "...", ".#."],
    "-": ["...", "...", "###", "...", "..."],
    ":": [".", "#", ".", "#", "."],
  },
};

/** Largest tier first; the layout ladder walks this order. */
export const FONTS: readonly PixelFont[] = [FONT_5X7, FONT_4X5, FONT_3X5];

export const CHARSET: ReadonlySet<string> = new Set(
  Object.keys(FONT_3X5.glyphs),
);
```

- [x] **Step 5: Run tests and eyeball the glyphs**

Run: `pnpm vitest run packages/text`
Expected: PASS.

Then render the whole charset for a human check (this is a required step, not optional — structural tests cannot judge legibility):

```bash
pnpm --filter @git-mosaic/text build
node --input-type=module -e '
import { FONTS } from "/home/default/projects/git-mosaic/packages/text/dist/fonts.js";
for (const font of FONTS) {
  console.log(`\n=== ${font.tier} ===`);
  const chars = Object.keys(font.glyphs).filter((c) => c !== " ");
  for (let start = 0; start < chars.length; start += 10) {
    const group = chars.slice(start, start + 10);
    for (let row = 0; row < font.height; row += 1) {
      console.log(
        group
          .map((c) => font.glyphs[c][row].replaceAll(".", " ").replaceAll("#", "█"))
          .join("  "),
      );
    }
    console.log(group.map((c) => c.padEnd(font.glyphs[c][0].length + 2)).join(""));
    console.log("");
  }
}'
```

Read the output: every letter and digit must be recognizable at a glance. Fix any glyph that is not (edit `fonts.ts`, rebuild, re-render, re-run the structural tests) before committing.

- [x] **Step 6: Commit**

```bash
pnpm format
git add packages/text vitest.config.ts pnpm-lock.yaml
git commit -m "feat(text): add @git-mosaic/text package with three pixel font tiers

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Text measurement and the font-size ladder

**Files:**

- Create: `packages/text/src/layout.ts`
- Modify: `packages/text/src/index.ts` (re-export)
- Test: `packages/text/src/layout.test.ts` (new)

**Interfaces:**

- Consumes: `FONTS`, `CHARSET`, `PixelFont` (Task 8); `GitMosaicError` from `@git-mosaic/schemas`
- Produces (used by Task 10):
  - `measureText(content: string, font: PixelFont): number` — total columns: glyph widths + 1 blank column between glyphs
  - `interface TextLayout { tier: FontTier; width: number; height: number; startRow: number; cells: boolean[][] }` (`cells` is `height` rows × `width` columns)
  - `layoutText(content: string, availableColumns: number): TextLayout` — walks the ladder largest-first, returns the largest tier that fits; throws `GitMosaicError("UNSUPPORTED_TEXT")` for characters outside the charset and `GitMosaicError("TEXT_DOES_NOT_FIT")` with exact numbers when even `3x5` overflows
  - Content is uppercased before lookup (`content.toUpperCase()`); empty/whitespace-only content throws `UNSUPPORTED_TEXT`.

- [x] **Step 1: Write the failing test**

Create `packages/text/src/layout.test.ts`:

```ts
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
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/text/src/layout.test.ts`
Expected: FAIL — `./layout.js` does not exist.

- [x] **Step 3: Implement**

Create `packages/text/src/layout.ts`:

```ts
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
  return glyphWidths.reduce((sum, width) => sum + width, 0) + chars.length - 1;
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
```

Update `packages/text/src/index.ts`:

```ts
export * from "./fonts.js";
export * from "./layout.js";
```

- [x] **Step 4: Run tests**

Run: `pnpm vitest run packages/text`
Expected: PASS. The ladder expectations depend on the exact glyph widths in Task 8 (the per-case comments show the arithmetic); if one fails, recompute the width by hand with `measureText` semantics before touching anything — the fix is choosing a test string that genuinely lands in that tier, not bending `measureText`.

- [x] **Step 5: Commit**

```bash
pnpm format
git add packages/text
git commit -m "feat(text): add text measurement and largest-fit font ladder

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: Stamp text onto the calendar with a fit report

**Files:**

- Create: `packages/text/src/stamp.ts`
- Modify: `packages/text/src/index.ts` (re-export)
- Test: `packages/text/src/stamp.test.ts` (new)

**Interfaces:**

- Consumes: `layoutText` (Task 9), `fullyInRangeColumnSpan` (Task 5), `fitReportSchema` (Task 2), `validateIntensityMap` from `@git-mosaic/calendar`
- Produces (used by Task 11):
  - `type TextAlign = "left" | "center" | "right"`
  - `stampTextOnCalendar(content: string, calendar: ContributionCalendar, options?: { align?: TextAlign }): { map: IntensityMap; report: FitReport; tier: FontTier }`
  - On-pixels become intensity `4`, everything else `0`; text never touches partial edge columns.
  - Report: `5x7` → verdict `good`, score `1`; `4x5` → `good`, `0.85`; `3x5` → `degraded`, `0.6` with the remedy `"shorten the text to use a larger font tier"`.

- [x] **Step 1: Write the failing test**

Create `packages/text/src/stamp.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { buildCalendar } from "@git-mosaic/calendar";

import { stampTextOnCalendar } from "./stamp.js";

// 2025: partial first and last weeks; fully in-range span is columns 1..51.
const calendar2025 = () =>
  buildCalendar({ from: "2025-01-01", to: "2025-12-31" }, "UTC");

describe("stampTextOnCalendar", () => {
  it("centers 'HI' at 5x7 inside the in-range span", () => {
    const { map, report, tier } = stampTextOnCalendar("HI", calendar2025());
    expect(tier).toBe("5x7");
    // 'H' 5 wide + gap + 'I' 3 wide = 9 columns; span 1..51 (51 columns).
    // centered: start = 1 + floor((51 - 9) / 2) = 22.
    expect(map[0]?.[22]).toBe(4); // H top-left
    expect(map[3]?.[22]).toBe(4); // H crossbar row
    expect(map[0]?.[21]).toBe(0);
    // Partial edge columns stay empty.
    expect(map.map((row) => row[0])).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(map.map((row) => row[52])).toEqual([0, 0, 0, 0, 0, 0, 0]);
    // Only 0 and 4 appear.
    expect([...new Set(map.flat())].sort()).toEqual([0, 4]);
    expect(report.verdict).toBe("good");
    expect(report.signals.fontTier).toBe("5x7");
    expect(report.signals.columnsUsed).toBe(9);
    expect(report.signals.columnsAvailable).toBe(51);
  });

  it("respects left and right alignment", () => {
    const left = stampTextOnCalendar("HI", calendar2025(), { align: "left" });
    const right = stampTextOnCalendar("HI", calendar2025(), { align: "right" });
    // Left: 'H' top-left lands on the span start (column 1).
    expect(left.map[0]?.[1]).toBe(4);
    // Right: width 9, so the block starts at 51 - 9 + 1 = 43 ('H' left edge)
    // and 'I' (top row fully on) ends exactly at the span end (column 51).
    expect(right.map[0]?.[43]).toBe(4);
    expect(right.map[0]?.[51]).toBe(4);
  });

  it("degrades the verdict at the 3x5 floor", () => {
    // "LOADING... OK" at 4x5 needs 52 columns; the 2025 span has 51 — a
    // deliberate one-column boundary that forces the 3x5 floor.
    const { report, tier } = stampTextOnCalendar(
      "LOADING... OK",
      calendar2025(),
    );
    expect(tier).toBe("3x5");
    expect(report.verdict).toBe("degraded");
    expect(report.remedies.join(" ")).toContain("shorten");
  });

  it("keeps Sunday and Saturday rows empty for 5-row fonts", () => {
    // "STARTING..." needs 54 columns at 5x7 (> 51) and 42 at 4x5 -> 5-row font.
    const { map, tier } = stampTextOnCalendar("STARTING...", calendar2025());
    expect(tier).toBe("4x5");
    expect(map[0]?.every((value) => value === 0)).toBe(true);
    expect(map[6]?.every((value) => value === 0)).toBe(true);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/text/src/stamp.test.ts`
Expected: FAIL — `./stamp.js` does not exist.

- [x] **Step 3: Implement**

Create `packages/text/src/stamp.ts`:

```ts
import {
  fullyInRangeColumnSpan,
  validateIntensityMap,
  type ContributionCalendar,
} from "@git-mosaic/calendar";
import {
  fitReportSchema,
  type FitReport,
  type FontTier,
  type IntensityMap,
} from "@git-mosaic/schemas";

import { layoutText } from "./layout.js";

export type TextAlign = "left" | "center" | "right";

export interface StampResult {
  map: IntensityMap;
  report: FitReport;
  tier: FontTier;
}

const TIER_QUALITY: Record<
  FontTier,
  { verdict: "good" | "degraded"; score: number }
> = {
  "5x7": { verdict: "good", score: 1 },
  "4x5": { verdict: "good", score: 0.85 },
  "3x5": { verdict: "degraded", score: 0.6 },
};

/**
 * Render text directly onto the intensity grid. Glyphs are stamped as cells,
 * never resampled through an image pipeline, so strokes stay crisp.
 */
export function stampTextOnCalendar(
  content: string,
  calendar: ContributionCalendar,
  options: { align?: TextAlign } = {},
): StampResult {
  const span = fullyInRangeColumnSpan(calendar);
  const available = span.end - span.start + 1;
  const layout = layoutText(content, available);

  const align = options.align ?? "center";
  const startColumn =
    align === "left"
      ? span.start
      : align === "right"
        ? span.end - layout.width + 1
        : span.start + Math.floor((available - layout.width) / 2);

  const map: IntensityMap = Array.from({ length: 7 }, (_, row) =>
    Array.from({ length: calendar.columns }, (_, column) => {
      const layoutRow = row - layout.startRow;
      const layoutColumn = column - startColumn;
      if (
        layoutRow < 0 ||
        layoutRow >= layout.height ||
        layoutColumn < 0 ||
        layoutColumn >= layout.width
      ) {
        return 0;
      }
      return layout.cells[layoutRow]?.[layoutColumn] === true ? 4 : 0;
    }),
  );
  validateIntensityMap(map, calendar);

  const quality = TIER_QUALITY[layout.tier];
  const report = fitReportSchema.parse({
    verdict: quality.verdict,
    score: quality.score,
    signals: {
      fontTier: layout.tier,
      columnsUsed: layout.width,
      columnsAvailable: available,
    },
    survives: [`every character at the ${layout.tier} pixel font`],
    lost:
      quality.verdict === "degraded"
        ? ["stroke detail: 3x5 is the legibility floor"]
        : [],
    remedies:
      quality.verdict === "degraded"
        ? ["shorten the text to use a larger font tier"]
        : [],
  });

  return { map, report, tier: layout.tier };
}
```

Update `packages/text/src/index.ts`:

```ts
export * from "./fonts.js";
export * from "./layout.js";
export * from "./stamp.js";
```

- [x] **Step 4: Run tests**

Run: `pnpm vitest run packages/text`
Expected: PASS. The centered-start assertion (`22`) is derived, not guessed: span 1..51 → 51 columns; "HI" at 5x7 = 5 + 1 + 3 = 9; `1 + floor((51 - 9) / 2) = 22`. If it fails, check `fullyInRangeColumnSpan` for 2025 first (Task 5 asserts `{start: 1, end: 51}`).

- [x] **Step 5: Commit**

```bash
pnpm format
git add packages/text
git commit -m "feat(text): stamp pixel-font text onto the calendar with fit reports

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 11: Core `importText`

**Files:**

- Modify: `packages/core/src/project.ts`, `packages/core/package.json` (add `"@git-mosaic/text": "workspace:*"` to dependencies)
- Test: `packages/core/src/import-text.test.ts` (new)

**Interfaces:**

- Consumes: `stampTextOnCalendar`, `TextAlign` (Task 10), `textSourceSchema` (Task 2), existing `readProject`/`writeProject`/`buildCalendar`
- Produces (used by Tasks 13–14):
  - `importText(projectDirectory: string, content: string, options?: { align?: TextAlign }, now?: string): Promise<{ project: MosaicProject; report: FitReport }>`
  - Persists `source: { type: "text", content, font: <chosen tier>, align }` and the stamped `intensityMap`. No asset file is written.

- [x] **Step 1: Write the failing test**

Create `packages/core/src/import-text.test.ts`:

```ts
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { importText, initializeProject, readProject } from "./project.js";

async function projectDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "gm-text-"));
  await initializeProject(directory, {
    name: "text-test",
    period: { from: "2025-01-01", to: "2025-12-31" },
    timezone: "UTC",
  });
  return directory;
}

describe("importText", () => {
  it("stamps text, persists the source, and returns a report", async () => {
    const directory = await projectDirectory();
    const { project, report } = await importText(directory, "Loading...");
    expect(project.source).toEqual({
      type: "text",
      content: "Loading...",
      font: "5x7",
      align: "center",
    });
    expect(report.signals.fontTier).toBe("5x7");
    expect(new Set(project.intensityMap.flat())).toEqual(new Set([0, 4]));
    const reloaded = await readProject(directory);
    expect(reloaded.source).toEqual(project.source);
  });

  it("propagates TEXT_DOES_NOT_FIT without modifying the project", async () => {
    const directory = await projectDirectory();
    await expect(
      importText(directory, "lorem ipsum dolor".repeat(5)),
    ).rejects.toMatchObject({ code: "GM016" });
    const reloaded = await readProject(directory);
    expect(reloaded.source.type).toBe("empty");
  });

  it("honors alignment", async () => {
    const directory = await projectDirectory();
    const { project } = await importText(directory, "HI", { align: "left" });
    expect(project.intensityMap[0]?.[1]).toBe(4);
  });
});
```

("Loading..." at 5x7: letters 5+5+5+5+3+5+5 = 33, dots 3×2 = 6, gaps 9 → 48 ≤ 51 span columns → tier `5x7`.)

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/core/src/import-text.test.ts`
Expected: FAIL — `importText` is not exported.

- [x] **Step 3: Implement**

Add `"@git-mosaic/text": "workspace:*"` to `packages/core/package.json` dependencies and run `pnpm install`.

In `packages/core/src/project.ts`, import `stampTextOnCalendar, type TextAlign` from `@git-mosaic/text` and add after `importImageBuffer`:

```ts
export async function importText(
  projectDirectory: string,
  content: string,
  options: { align?: TextAlign } = {},
  now = new Date().toISOString(),
): Promise<{ project: MosaicProject; report: FitReport }> {
  const project = await readProject(projectDirectory);
  const calendar = buildCalendar(project.period, project.timezone);
  const { map, report, tier } = stampTextOnCalendar(content, calendar, options);
  const updated = mosaicProjectSchema.parse({
    ...project,
    updatedAt: now,
    source: {
      type: "text",
      content,
      font: tier,
      align: options.align ?? "center",
    },
    intensityMap: map,
  });
  await writeProject(projectDirectory, updated);
  return { project: updated, report };
}
```

- [x] **Step 4: Run tests**

Run: `pnpm vitest run packages/core && pnpm typecheck`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
pnpm format
git add packages/core pnpm-lock.yaml
git commit -m "feat(core): add importText writing stamped text sources

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 12: WYSIWYG preview by default, quartile estimate opt-in

**Files:**

- Modify: `packages/calendar/src/levels.ts` (new strategy)
- Modify: `packages/core/src/preview.ts:12` (default strategy)
- Modify: `packages/core/src/render.ts` (mode parameter)
- Modify: `apps/cli/src/program.ts` preview command (`--estimate` flag)
- Test: `packages/calendar/src/levels-artistic.test.ts` (new); update `packages/core/src/preview.test.ts` expectations

**Interfaces:**

- Consumes: `ContributionLevelStrategy`, `CalendarCell` from `packages/calendar/src/levels.ts` / `index.ts`
- Produces:
  - `ArtisticIntensityStrategy` exported from `@git-mosaic/calendar`: level = drawn intensity, one-to-one (`0→NONE, 1→FIRST_QUARTILE, … 4→FOURTH_QUARTILE`), ignoring counts
  - `type PreviewMode = "artistic" | "estimate"` exported from `@git-mosaic/core`
  - `renderProjectTerminal(projectDirectory, options?, mode?: PreviewMode)` and `renderProjectSvg(projectDirectory, options?, mode?: PreviewMode)`, default `"artistic"`
  - `gm preview --estimate` switches to the quartile simulation
  - Snapshot semantics unchanged: OBSERVED days keep GitHub's own level (the existing override in `buildPreviewCalendar` runs after the strategy in both modes).

- [x] **Step 1: Write the failing test**

Create `packages/calendar/src/levels-artistic.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { ArtisticIntensityStrategy } from "./levels.js";
import type { CalendarCell } from "./index.js";

function cell(overrides: Partial<CalendarCell>): CalendarCell {
  return {
    date: "2025-06-01",
    row: 0,
    column: 0,
    inRange: true,
    intensity: 0,
    existingCount: 0,
    plannedCount: 0,
    finalCount: 0,
    level: "NONE",
    confidence: "ESTIMATED",
    ...overrides,
  };
}

describe("ArtisticIntensityStrategy", () => {
  it("maps drawn intensity one-to-one regardless of counts", () => {
    const strategy = new ArtisticIntensityStrategy();
    const result = strategy.calculate([
      cell({ intensity: 0 }),
      cell({ intensity: 1, finalCount: 1 }),
      cell({ intensity: 2, finalCount: 4 }),
      cell({ intensity: 3, finalCount: 10 }),
      cell({ intensity: 4, finalCount: 20 }),
    ]);
    expect(result.map((day) => day.level)).toEqual([
      "NONE",
      "FIRST_QUARTILE",
      "SECOND_QUARTILE",
      "THIRD_QUARTILE",
      "FOURTH_QUARTILE",
    ]);
  });

  it("keeps out-of-range and zero-intensity cells at NONE even with observed counts", () => {
    const strategy = new ArtisticIntensityStrategy();
    const result = strategy.calculate([
      cell({ inRange: false, intensity: 4 }),
      cell({ intensity: 0, existingCount: 12, finalCount: 12 }),
    ]);
    expect(result.map((day) => day.level)).toEqual(["NONE", "NONE"]);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/calendar/src/levels-artistic.test.ts`
Expected: FAIL — `ArtisticIntensityStrategy` not exported.

- [x] **Step 3: Implement**

In `packages/calendar/src/levels.ts`, add:

```ts
const LEVEL_BY_INTENSITY = [
  "NONE",
  "FIRST_QUARTILE",
  "SECOND_QUARTILE",
  "THIRD_QUARTILE",
  "FOURTH_QUARTILE",
] as const;

/**
 * WYSIWYG strategy: the preview level is exactly the drawn intensity. This is
 * what the artist meant; the quartile strategy remains the GitHub estimate.
 */
export class ArtisticIntensityStrategy implements ContributionLevelStrategy {
  calculate(days: CalendarCell[]): CalendarCell[] {
    return days.map((day) => ({
      ...day,
      level:
        day.inRange && day.intensity > 0
          ? LEVEL_BY_INTENSITY[day.intensity]
          : "NONE",
    }));
  }
}
```

In `packages/core/src/preview.ts`, change the default parameter (line 12):

```ts
  strategy: ContributionLevelStrategy = new ArtisticIntensityStrategy(),
```

(adding `ArtisticIntensityStrategy` to the `@git-mosaic/calendar` import).

In `packages/core/src/render.ts`:

```ts
import {
  ArtisticIntensityStrategy,
  QuartileApproximationStrategy,
  type ContributionLevelStrategy,
} from "@git-mosaic/calendar";

export type PreviewMode = "artistic" | "estimate";

function strategyFor(mode: PreviewMode): ContributionLevelStrategy {
  return mode === "estimate"
    ? new QuartileApproximationStrategy()
    : new ArtisticIntensityStrategy();
}

export async function renderProjectTerminal(
  projectDirectory: string,
  options: TerminalRenderOptions = {},
  mode: PreviewMode = "artistic",
): Promise<string> {
  const project = await readProject(projectDirectory);
  return renderTerminal(
    buildPreviewCalendar(project, strategyFor(mode)),
    options,
  ).content;
}

export async function renderProjectSvg(
  projectDirectory: string,
  options: SvgRenderOptions = {},
  mode: PreviewMode = "artistic",
): Promise<string> {
  const project = await readProject(projectDirectory);
  return renderSvg(buildPreviewCalendar(project, strategyFor(mode)), options);
}
```

In `apps/cli/src/program.ts` preview command: add `.option("--estimate", "rank levels like GitHub's quartile estimate instead of showing drawn intensities")`, add `estimate?: boolean` to the action's options type, and pass `options.estimate === true ? "estimate" : "artistic"` as the third argument to both `renderProjectSvg` and `renderProjectTerminal` calls.

- [x] **Step 4: Run tests and update existing expectations**

Run: `pnpm vitest run packages/calendar packages/core apps/cli`
Expected: the new test PASSES. Tests that asserted quartile levels through the DEFAULT preview path will fail — for each failing case in `packages/core/src/preview.test.ts` (and any CLI preview snapshot in `apps/cli/src/program.test.ts`):

- if the case is ABOUT quartile ranking, keep it by passing `new QuartileApproximationStrategy()` explicitly to `buildPreviewCalendar` (import it in the test);
- if the case is about snapshot/OBSERVED/MIXED semantics, update the expected levels to the artistic mapping (level = drawn intensity; OBSERVED days keep the observed level).
  Then add one new case to `packages/core/src/preview.test.ts` asserting the default is artistic: a project whose `intensityMap` contains one cell each of intensities 1–4 must produce levels `FIRST..FOURTH_QUARTILE` respectively regardless of `commitLevelMap` values.

- [x] **Step 5: Commit**

```bash
pnpm format
git add packages/calendar packages/core apps/cli
git commit -m "feat(preview): show drawn intensities by default, quartile estimate behind --estimate

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 13: CLI — `gm import text`, fit-report output, force flag

**Files:**

- Modify: `apps/cli/src/program.ts` (import image action ~:190-225; new `import text` subcommand; shared report formatter)
- Test: extend `apps/cli/src/program.test.ts`

**Interfaces:**

- Consumes: `importText`, `ImageImportOptions` (Tasks 7, 11), `renderProjectTerminal` (Task 12), `FitReport` (Task 2)
- Produces: user-facing CLI behavior:
  - `gm import image <input> --project <path> [--fit contain|cover|stretch] [--mode levels|binary] [--invert] [--contrast <n>] [--no-normalize] [--dither] [--force]`
  - `gm import text <content> --project <path> [--align left|center|right]`
  - Both print the fit report and then the terminal preview so the user immediately sees what they got.

- [x] **Step 1: Write the failing tests**

Append to `apps/cli/src/program.test.ts` (it already imports `mkdtemp`, `readFile`, `writeFile`, `tmpdir`, `path`, `vi`, and pushes temp dirs onto `temporaryDirectories`; add `import sharp from "sharp"` at the top and `"sharp": "^0.34.1"` to `apps/cli/package.json` devDependencies, then `pnpm install`).

Errors propagate out of `parseAsync` (see `apps/cli/src/index.ts`, which catches them and sets `process.exitCode`), so error paths assert on the rejection.

```ts
async function cliProject(year: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "git-mosaic-fit-"));
  temporaryDirectories.push(root);
  const target = path.join(root, "fit-project");
  await createProgram().parseAsync([
    "node",
    "git-mosaic",
    "init",
    "fit-project",
    "--directory",
    target,
    "--year",
    year,
    "--timezone",
    "UTC",
  ]);
  return target;
}

/** Deterministic per-pixel noise: detail far below one calendar cell. */
async function writeNoisePng(filePath: string): Promise<string> {
  const width = 520;
  const height = 70;
  const pixels = new Uint8Array(width * height);
  let state = 42;
  for (let index = 0; index < pixels.length; index += 1) {
    state = (state * 1103515245 + 12345) % 2147483648;
    pixels[index] = state % 2 === 0 ? 0 : 255;
  }
  await sharp(pixels, { raw: { width, height, channels: 1 } })
    .png()
    .toFile(filePath);
  return filePath;
}

describe("import text", () => {
  it("imports text, prints the fit report, and previews it", async () => {
    const target = await cliProject("2025");
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    await createProgram().parseAsync([
      "node",
      "git-mosaic",
      "import",
      "text",
      "Loading...",
      "--project",
      target,
    ]);

    const output = stdout.mock.calls.map((call) => String(call[0])).join("");
    expect(output).toContain("Imported text into fit-project");
    expect(output).toContain("Fit: GOOD");
    expect(output).toContain("Legend:");

    const project = JSON.parse(
      await readFile(path.join(target, "mosaic.json"), "utf8"),
    ) as { source: Record<string, unknown> };
    expect(project.source).toEqual({
      type: "text",
      content: "Loading...",
      font: "5x7",
      align: "center",
    });
  });

  it("refuses text that cannot fit at the smallest legible font", async () => {
    const target = await cliProject("2025");
    await expect(
      createProgram().parseAsync([
        "node",
        "git-mosaic",
        "import",
        "text",
        "lorem ipsum dolor".repeat(5),
        "--project",
        target,
      ]),
    ).rejects.toMatchObject({ code: "GM016" });

    const project = JSON.parse(
      await readFile(path.join(target, "mosaic.json"), "utf8"),
    ) as { source: { type: string } };
    expect(project.source.type).toBe("empty");
  });
});

describe("import image fit gate", () => {
  it("rejects low-expressibility images and accepts them with --force", async () => {
    const target = await cliProject("2025");
    const noisePath = await writeNoisePng(
      path.join(path.dirname(target), "noise.png"),
    );

    await expect(
      createProgram().parseAsync([
        "node",
        "git-mosaic",
        "import",
        "image",
        noisePath,
        "--project",
        target,
      ]),
    ).rejects.toMatchObject({ code: "GM018" });

    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    await createProgram().parseAsync([
      "node",
      "git-mosaic",
      "import",
      "image",
      noisePath,
      "--project",
      target,
      "--force",
    ]);
    const output = stdout.mock.calls.map((call) => String(call[0])).join("");
    expect(output).toContain("Imported image into fit-project");
    expect(output).toContain("Fit: BAD");
    expect(output).toContain("Try:");
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run apps/cli`
Expected: FAIL — unknown command `text`, unknown options.

- [x] **Step 3: Implement**

In `apps/cli/src/program.ts`:

1. Extend the core import: add `importText` to the existing `@git-mosaic/core` import list.
2. Add a module-level formatter near `writeOutput`:

```ts
function formatFitReport(report: FitReport): string {
  const lines = [
    `Fit: ${report.verdict.toUpperCase()} (score ${report.score.toFixed(2)})`,
  ];
  if (report.survives.length > 0)
    lines.push(`Survives: ${report.survives.join("; ")}`);
  if (report.lost.length > 0) lines.push(`Lost: ${report.lost.join("; ")}`);
  if (report.remedies.length > 0)
    lines.push(`Try: ${report.remedies.join("; ")}`);
  return `${lines.join("\n")}\n`;
}
```

(import `type FitReport` from `@git-mosaic/schemas`.)

3. Rework the `import image` action:

```ts
importCommand
  .command("image")
  .description("import a PNG, JPEG, or WebP image")
  .argument("<input>", "image file")
  .requiredOption("--project <path>", "mosaic project directory")
  .addOption(
    new Option("--fit <mode>", "image fitting mode")
      .choices(["contain", "cover", "stretch"])
      .default("contain"),
  )
  .addOption(
    new Option("--mode <mode>", "quantization mode")
      .choices(["levels", "binary"])
      .default("levels"),
  )
  .option("--invert", "invert intensity levels")
  .option("--contrast <multiplier>", "contrast multiplier", Number)
  .option(
    "--no-normalize",
    "keep the original histogram instead of stretching it",
  )
  .option("--dither", "diffuse quantization error for smooth gradients")
  .option("--force", "import even when the fit verdict is bad")
  .action(
    async (
      input: string,
      options: {
        project: string;
        fit: "contain" | "cover" | "stretch";
        mode: "levels" | "binary";
        invert?: boolean;
        contrast?: number;
        normalize: boolean;
        dither?: boolean;
        force?: boolean;
      },
    ) => {
      const projectDirectory = path.resolve(options.project);
      const { project, report } = await importImage(
        projectDirectory,
        path.resolve(input),
        {
          fit: options.fit,
          mode: options.mode,
          invert: options.invert ?? false,
          normalize: options.normalize,
          dithering: options.dither ?? false,
          force: options.force ?? false,
          ...(options.contrast === undefined
            ? {}
            : { contrast: options.contrast }),
        },
      );
      writeOutput(program, `Imported image into ${project.name}\n`);
      writeOutput(program, formatFitReport(report));
      writeOutput(
        program,
        await renderProjectTerminal(projectDirectory, {
          color: process.stdout.isTTY === true,
        }),
      );
    },
  );
```

(commander turns `--no-normalize` into `normalize: boolean` defaulting to `true` — exactly the core default.)

4. Add the text subcommand after `import image`:

```ts
importCommand
  .command("text")
  .description("render text onto the calendar with a built-in pixel font")
  .argument("<content>", "text to render (A-Z, 0-9, space, . ! ? - :)")
  .requiredOption("--project <path>", "mosaic project directory")
  .addOption(
    new Option("--align <align>", "horizontal alignment")
      .choices(["left", "center", "right"])
      .default("center"),
  )
  .action(
    async (
      content: string,
      options: { project: string; align: "left" | "center" | "right" },
    ) => {
      const projectDirectory = path.resolve(options.project);
      const { project, report } = await importText(projectDirectory, content, {
        align: options.align,
      });
      writeOutput(program, `Imported text into ${project.name}\n`);
      writeOutput(program, formatFitReport(report));
      writeOutput(
        program,
        await renderProjectTerminal(projectDirectory, {
          color: process.stdout.isTTY === true,
        }),
      );
    },
  );
```

5. Update the `import` group description to `"import an image, text, or intensity matrix"`.

- [x] **Step 4: Run tests**

Run: `pnpm vitest run apps/cli && pnpm typecheck`
Expected: PASS.

- [x] **Step 5: Manual smoke test (required)**

```bash
cd /tmp && rm -rf gm-smoke && mkdir gm-smoke && cd gm-smoke
node /home/default/projects/git-mosaic/apps/cli/dist/index.js --help >/dev/null 2>&1 || (cd /home/default/projects/git-mosaic && pnpm build)
alias gm='node /home/default/projects/git-mosaic/apps/cli/dist/index.js'
gm init demo --year 2025 --timezone UTC
gm import text "Loading..." --project ./demo
gm preview --project ./demo
gm preview --project ./demo --estimate
```

Expected: "Loading..." is READABLE in the first preview (this was the original bug); `--estimate` may look different and that is fine. If the text is not readable, stop and fix before committing.

- [x] **Step 6: Commit**

```bash
pnpm format
git add apps/cli
git commit -m "feat(cli): add import text command and fit-report output with force gate

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 14: Web editor — text import, fit reports, estimate toggle

**Files:**

- Modify: `apps/web/src/server.ts` (extend `imageOptions` ~:217; new `/api/text/import` route next to `/api/image/import` ~:426)
- Modify: `apps/web/src/contracts.ts` (`WebApi.importImage` return type; new `importText`)
- Modify: `apps/web/src/api.ts` (importImage return shape; new `importText`)
- Modify: `apps/web/src/App.tsx` (text input UI, fit-report status, force retry; `importImage` at :351)
- Test: extend `apps/web/src/server.test.ts` and `apps/web/src/api.test.ts` following their existing patterns

**Interfaces:**

- Consumes: `importText`, `ImageImportOptions` (core), `FitReport`
- Produces:
  - `POST /api/text/import` body `{ path, content, options?: { align? } }` → `{ project, report }`
  - `POST /api/image/import` response becomes `{ project, report }`; `options` accepts `mode`, `normalize`, `dithering`, `force`
  - `WebApi.importImage` returns `Promise<{ project: MosaicProject; report: FitReport }>`; `WebApi.importText(projectPath, content, options?)` mirrors it
  - App shows the report verdict in the status line; a `bad` image verdict surfaces the remedies and offers a confirm-to-force retry.

- [x] **Step 1: Write the failing server tests**

Append to `apps/web/src/server.test.ts`. It already has `temporaryDirectory`, `startServer`, `session`, and `post` helpers and imports `initializeProject` from `@git-mosaic/core`; add `import sharp from "sharp";` at the top (sharp is already reachable through the workspace; if the typecheck complains, add `"sharp": "^0.34.1"` to `apps/web/package.json` devDependencies and `pnpm install`).

```ts
async function textProject(): Promise<string> {
  const directory = await temporaryDirectory("git-mosaic-web-fit-");
  await initializeProject(directory, {
    name: "web-fit",
    period: { from: "2025-01-01", to: "2025-12-31" },
    timezone: "UTC",
  });
  return directory;
}

async function noiseBase64(): Promise<string> {
  const width = 520;
  const height = 70;
  const pixels = new Uint8Array(width * height);
  let state = 42;
  for (let index = 0; index < pixels.length; index += 1) {
    state = (state * 1103515245 + 12345) % 2147483648;
    pixels[index] = state % 2 === 0 ? 0 : 255;
  }
  const png = await sharp(pixels, { raw: { width, height, channels: 1 } })
    .png()
    .toBuffer();
  return png.toString("base64");
}

describe("text import over the local API", () => {
  it("imports text and returns the project with its fit report", async () => {
    const directory = await textProject();
    const { baseUrl } = await startServer();
    const token = await session(baseUrl);

    const response = await post(baseUrl, token, "/api/text/import", {
      path: directory,
      content: "Loading...",
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      project: { source: { type: string; font: string } };
      report: { verdict: string; signals: { fontTier: string } };
    };
    expect(body.project.source).toMatchObject({ type: "text", font: "5x7" });
    expect(body.report.verdict).toBe("good");
    expect(body.report.signals.fontTier).toBe("5x7");
  });

  it("reports text that cannot fit as a GM016 error", async () => {
    const directory = await textProject();
    const { baseUrl } = await startServer();
    const token = await session(baseUrl);

    const response = await post(baseUrl, token, "/api/text/import", {
      path: directory,
      content: "lorem ipsum dolor".repeat(5),
    });
    expect(response.ok).toBe(false);
    const body = (await response.json()) as {
      error: { code: string; message: string; hint?: string };
    };
    expect(body.error.code).toBe("GM016");
    expect(body.error.message).toMatch(/columns/);
  });
});

describe("image import fit gate over the local API", () => {
  it("blocks a low-expressibility image and honors force", async () => {
    const directory = await textProject();
    const { baseUrl } = await startServer();
    const token = await session(baseUrl);
    const dataBase64 = await noiseBase64();

    const blocked = await post(baseUrl, token, "/api/image/import", {
      path: directory,
      fileName: "noise.png",
      dataBase64,
    });
    expect(blocked.ok).toBe(false);
    expect(
      ((await blocked.json()) as { error: { code: string } }).error.code,
    ).toBe("GM018");

    const forced = await post(baseUrl, token, "/api/image/import", {
      path: directory,
      fileName: "noise.png",
      dataBase64,
      options: { force: true },
    });
    expect(forced.status).toBe(200);
    const body = (await forced.json()) as {
      project: { source: { type: string } };
      report: { verdict: string; remedies: string[] };
    };
    expect(body.project.source.type).toBe("image");
    expect(body.report.verdict).toBe("bad");
    expect(body.report.remedies.length).toBeGreaterThan(0);
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run apps/web/src/server.test.ts`
Expected: FAIL — 404 for `/api/text/import`; no `report` in image import response.

- [x] **Step 3: Implement the server**

In `apps/web/src/server.ts`:

1. Import `importText` from `@git-mosaic/core` and change the `RasterImportOptions` import to `ImageImportOptions` (also from core).
2. Extend `imageOptions` (return type `ImageImportOptions`): after the existing `contrast` validation add:

```ts
const mode = options.mode;
if (mode !== undefined && mode !== "levels" && mode !== "binary") {
  throw new HttpError(400, "options.mode is invalid");
}
const normalize = optionalBoolean(options, "normalize");
const dithering = optionalBoolean(options, "dithering");
const force = optionalBoolean(options, "force");
```

and add to the returned object:

```ts
    ...(mode === undefined ? {} : { mode }),
    ...(normalize === undefined ? {} : { normalize }),
    ...(dithering === undefined ? {} : { dithering }),
    ...(force === undefined ? {} : { force }),
```

3. The `/api/image/import` handler already returns `{ project, report }` after Task 7.
4. Add after the `/api/image/debug` handler:

```ts
if (url.pathname === "/api/text/import") {
  const content = requiredString(body, "content");
  const rawOptions = body.options === undefined ? {} : objectBody(body.options);
  const align = rawOptions.align;
  if (
    align !== undefined &&
    align !== "left" &&
    align !== "center" &&
    align !== "right"
  ) {
    throw new HttpError(400, "options.align is invalid");
  }
  const { project, report } = await importText(
    projectPath(body),
    content,
    align === undefined ? {} : { align },
  );
  sendJson(response, 200, { project, report });
  return;
}
```

(Match the surrounding handlers exactly for how `body`/`objectBody`/`projectPath` are used — read them before editing. `GitMosaicError` instances already flow through the server's existing error mapping to `{ error: { code, message, hint } }`.)

- [x] **Step 4: Client and UI**

In `apps/web/src/contracts.ts`: add `import type { FitReport } from "@git-mosaic/schemas";`, define

```ts
export interface ImportOutcome {
  project: MosaicProject;
  report: FitReport;
}
```

change `importImage` to return `Promise<ImportOutcome>` and accept `options?: RasterImportOptions & { force?: boolean }`, and add:

```ts
  importText(
    projectPath: string,
    content: string,
    options?: { align?: "left" | "center" | "right" },
  ): Promise<ImportOutcome>;
```

In `apps/web/src/api.ts`, update `importImage` to return the full body and add `importText`:

```ts
    async importImage(projectPath, file, options = {}) {
      return post<ImportOutcome>("/api/image/import", {
        path: projectPath,
        fileName: file.name,
        dataBase64: bufferToBase64(await file.arrayBuffer()),
        options,
      });
    },
    async importText(projectPath, content, options = {}) {
      return post<ImportOutcome>("/api/text/import", {
        path: projectPath,
        content,
        options,
      });
    },
```

In `apps/web/src/App.tsx`:

1. Update the `importImage` callback (line 351) for the new shape:

```ts
const [outcome, debug] = await Promise.all([
  api.importImage(targetPath, file),
  api.debugImage(file),
]);
externalProject.current = outcome.project;
editor.replaceProject(outcome.project);
```

and set the status to include the verdict: `setStatus(`${t("imported")} — fit ${outcome.report.verdict}`);`. On a rejection whose message starts with `GM018`, show `window.confirm(`${t("fitBadConfirm")}\n\n${message}`)` and, if confirmed, retry `api.importImage(targetPath, file, { force: true })`.

2. Add a text-import control next to the image drop zone: a text input + import button + align select, calling a new `importText(content, align)` callback that mirrors the `importImage` callback (`api.importText`, replace project, set status with verdict; on `GM016`/`GM017` errors the thrown message already contains code + hint and lands in the existing error status path).

3. Add UI strings to BOTH language maps (`en` around line 39, `pt` around line 94):

```ts
    textImport: "Write text",            // pt: "Escrever texto"
    textPlaceholder: "Loading...",       // pt: "Carregando..."
    importTextButton: "Import text",     // pt: "Importar texto"
    fitBadConfirm: "The fit verdict is BAD - import anyway?", // pt: "O veredito de encaixe é RUIM - importar mesmo assim?"
```

Follow the file's existing form/label markup patterns (see the image drop zone around line 721) so styling and accessibility attributes stay consistent.

- [x] **Step 5: Run all web tests**

Run: `pnpm vitest run apps/web && pnpm typecheck`
Expected: PASS, including updated `api.test.ts`/`App.test.tsx` expectations for the new `importImage` return shape (update mocks that stubbed `importImage` to resolve `{ project, report }`).

- [x] **Step 6: Commit**

```bash
pnpm format
git add apps/web
git commit -m "feat(web): text import, fit reports, and force retry in the local editor

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 15: Documentation and full verification

**Files:**

- Modify: `README.md`, `docs/file-formats.md`, `docs/calendar-model.md`, `docs/troubleshooting.md`

**Interfaces:**

- Consumes: everything above
- Produces: accurate docs; a verified, formatted, fully green workspace

- [x] **Step 1: Update documentation**

- `README.md`:
  - In the feature paragraph (line ~13), add text import and fit verdicts to the supported list.
  - In Quick start, after the `gm import image` block, add:

    ```bash
    gm import text "Loading..." --project ./demo
    gm preview --project ./demo            # shows exactly what you drew
    gm preview --project ./demo --estimate # GitHub-style quartile estimate
    ```

  - Rewrite the "What the preview means" section: default preview shows drawn intensities one-to-one (WYSIWYG); `--estimate` ranks final counts into approximate quartiles; GitHub's real rendering can still differ (keep the existing caveat sentences).
  - In Limitations (line ~184): REMOVE "There is no text renderer"; add: "Text supports A-Z, 0-9, space, and `. ! ? - :` at three font sizes; text that cannot fit at the smallest legible font is refused with remedies rather than rendered illegibly."
- `docs/file-formats.md`: document the `text` source object (`content`, `font`, `align`), the new `image` source fields (`mode`, `normalize`, working `dithering`), and the fit report shape returned by imports.
- `docs/calendar-model.md`: in "Intensity and counts", state that the default preview is the drawn intensity and the quartile estimate is opt-in.
- `docs/troubleshooting.md`: add entries for `GM016` (text does not fit — shows needed vs available columns and remedies), `GM017` (unsupported character), `GM018` (low expressibility — what the signals mean, `--force`).

- [x] **Step 2: Full verification**

```bash
cd /home/default/projects/git-mosaic
pnpm format && pnpm check
```

Expected: format, lint, typecheck, tests, and pack-check all green.

- [x] **Step 3: End-to-end acceptance (the original complaint)**

```bash
cd /tmp && rm -rf gm-accept && mkdir gm-accept && cd gm-accept
alias gm='node /home/default/projects/git-mosaic/apps/cli/dist/index.js'
gm init y2025 --year 2025 --timezone America/Sao_Paulo
gm import text "Loading..." --project ./y2025
gm preview --project ./y2025
```

Acceptance: the preview must read "LOADING..." legibly. Then verify the refusal path:

```bash
gm import text "lorem ipsum dolorlorem ipsum dolorlorem ipsum dolorlorem ipsum dolorlorem ipsum dolor" --project ./y2025
```

Acceptance: exit non-zero, message shows needed vs available columns and the shorten/split remedies, and the project still contains "Loading...".

- [x] **Step 4: Commit**

```bash
pnpm format
git add README.md docs PLAN.md
git commit -m "docs: document text import, fit reports, and WYSIWYG preview

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Out of Scope (recorded so nobody "helpfully" adds them)

- Multi-year `--span` auto-split of long text (refuse-with-remedies is the chosen v1 behavior).
- Saliency-based auto-crop for images (the fit report tells the user what to crop).
- Commit-count optimizer matching quartile estimates.
- Lowercase glyphs, comma, or extended punctuation (charset is A-Z 0-9 space `. ! ? - :`).
- Changing the plan/apply pipeline — this plan only touches import, preview, CLI/web surfaces, schemas, and docs.
