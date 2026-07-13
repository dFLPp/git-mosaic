import { describe, expect, it } from "vitest";
import sharp from "sharp";

import { buildCalendar, type ContributionCalendar } from "@git-mosaic/calendar";
import { GitMosaicError } from "@git-mosaic/schemas";

import {
  importRasterImage,
  quantizeRasterForDebug,
  type RasterFit,
} from "./raster.js";

function oneWeek(): ContributionCalendar {
  return buildCalendar(
    { from: "2026-01-04", to: "2026-01-10" },
    "America/Los_Angeles",
  );
}

async function solidFixture(
  format: "png" | "jpeg" | "webp",
  value: number,
): Promise<Buffer> {
  return sharp({
    create: {
      width: 3,
      height: 3,
      channels: 3,
      background: { r: value, g: value, b: value },
    },
  })
    .toFormat(format, format === "jpeg" ? { quality: 100 } : undefined)
    .toBuffer();
}

async function rawFixture(
  width: number,
  height: number,
  pixels: number[],
): Promise<Buffer> {
  return sharp(Buffer.from(pixels), {
    raw: { width, height, channels: 3 },
  })
    .png()
    .toBuffer();
}

describe("importRasterImage", () => {
  it.each(["png", "jpeg", "webp"] as const)(
    "imports deterministic %s data and quantizes black as 4",
    async (format) => {
      const fixture = await solidFixture(format, 0);
      const first = await importRasterImage(fixture, oneWeek(), {
        fit: "stretch",
      });
      const second = await importRasterImage(fixture, oneWeek(), {
        fit: "stretch",
      });

      expect(first).toEqual(Array.from({ length: 7 }, () => [4]));
      expect(second).toEqual(first);
    },
  );

  it("uses the documented luminance boundaries and supports inversion", async () => {
    const boundaries = [
      [0, 4],
      [51, 3],
      [102, 2],
      [153, 1],
      [204, 0],
    ] as const;

    for (const [luminance, expected] of boundaries) {
      const fixture = await solidFixture("png", luminance);
      const normal = await importRasterImage(fixture, oneWeek(), {
        fit: "stretch",
      });
      const inverted = await importRasterImage(fixture, oneWeek(), {
        fit: "stretch",
        invert: true,
      });

      expect(normal[0]?.[0]).toBe(expected);
      expect(inverted[0]?.[0]).toBe(4 - expected);
    }
  });

  it.each(["contain", "cover", "stretch"] satisfies RasterFit[])(
    "produces a valid expected matrix with %s fit",
    async (fit) => {
      const fixture = await rawFixture(2, 1, [0, 0, 0, 255, 255, 255]);
      const calendar = buildCalendar(
        { from: "2026-01-04", to: "2026-01-17" },
        "UTC",
      );
      const map = await importRasterImage(fixture, calendar, { fit });

      expect(map).toHaveLength(7);
      expect(map.every((row) => row.length === 2)).toBe(true);
      expect(map.flat().every((value) => value >= 0 && value <= 4)).toBe(true);
      if (fit === "contain") {
        expect(map[0]).toEqual([0, 0]);
      } else {
        expect(map[0]?.[0]).toBeGreaterThan(map[0]?.[1] ?? 4);
      }
    },
  );

  it("normalizes EXIF orientation before resizing", async () => {
    const fixture = await sharp(Buffer.from([0, 0, 0, 255, 255, 255]), {
      raw: { width: 2, height: 1, channels: 3 },
    })
      .jpeg({ quality: 100 })
      .withMetadata({ orientation: 6 })
      .toBuffer();

    const map = await importRasterImage(fixture, oneWeek(), { fit: "stretch" });
    expect(map[0]?.[0]).toBe(4);
    expect(map[6]?.[0]).toBe(0);
  });

  it("applies an optional contrast multiplier around middle gray", async () => {
    const fixture = await solidFixture("png", 170);
    const unchanged = await importRasterImage(fixture, oneWeek(), {
      fit: "stretch",
    });
    const contrasted = await importRasterImage(fixture, oneWeek(), {
      contrast: 2,
      fit: "stretch",
    });

    expect(unchanged[0]?.[0]).toBe(1);
    expect(contrasted[0]?.[0]).toBe(0);
  });

  it("forces OUT_OF_RANGE cells to zero", async () => {
    const calendar = buildCalendar(
      { from: "2026-01-05", to: "2026-01-16" },
      "UTC",
    );
    const map = await importRasterImage(
      await solidFixture("png", 0),
      calendar,
      { fit: "stretch" },
    );

    expect(map[0]?.[0]).toBe(0);
    expect(map[6]?.[1]).toBe(0);
    expect(map[1]?.[0]).toBe(4);
  });

  it("reports corrupt and unsupported input as GM015", async () => {
    const unsupported = await sharp({
      create: {
        width: 1,
        height: 1,
        channels: 3,
        background: "black",
      },
    })
      .tiff()
      .toBuffer();

    for (const input of [Buffer.from("not an image"), unsupported]) {
      await expect(importRasterImage(input, oneWeek())).rejects.toMatchObject({
        code: "GM015",
      });
    }
  });

  it("reports an invalid calendar as GM004 before reading input", async () => {
    const invalid = { ...oneWeek(), columns: 2 } as ContributionCalendar;
    await expect(
      importRasterImage(Buffer.from("not an image"), invalid),
    ).rejects.toMatchObject({ code: "GM004" });
  });

  it("does not mutate the calendar when import fails", async () => {
    const calendar = oneWeek();
    const before = structuredClone(calendar);

    await expect(
      importRasterImage(Buffer.from("broken"), calendar),
    ).rejects.toBeInstanceOf(GitMosaicError);
    expect(calendar).toEqual(before);
  });
});

describe("quantizeRasterForDebug", () => {
  it("preserves all 854 source columns instead of shrinking to 53 weeks", async () => {
    const fixture = await sharp({
      create: {
        width: 854,
        height: 480,
        channels: 3,
        background: { r: 90, g: 90, b: 90 },
      },
    })
      .png()
      .toBuffer();

    const debug = await quantizeRasterForDebug(fixture);

    expect(debug.width).toBe(854);
    expect(debug.height).toBe(480);
    expect(debug.intensities).toHaveLength(854 * 480);
    expect(new Set(debug.intensities)).toEqual(new Set([3]));
  });
});
