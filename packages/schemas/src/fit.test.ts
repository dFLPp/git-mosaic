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
