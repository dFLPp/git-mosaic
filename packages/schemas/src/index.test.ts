import { describe, expect, it } from "vitest";
import {
  dateRangeSchema,
  intensityMapSchema,
  mosaicProjectSchema,
} from "./index.js";

describe("dateRangeSchema", () => {
  it("accepts an inclusive valid range", () => {
    expect(
      dateRangeSchema.parse({ from: "2028-02-29", to: "2028-02-29" }),
    ).toEqual({
      from: "2028-02-29",
      to: "2028-02-29",
    });
  });

  it("rejects invalid calendar dates and inverted ranges", () => {
    expect(
      dateRangeSchema.safeParse({ from: "2027-02-29", to: "2027-03-01" })
        .success,
    ).toBe(false);
    expect(
      dateRangeSchema.safeParse({ from: "2027-03-02", to: "2027-03-01" })
        .success,
    ).toBe(false);
  });
});

describe("intensityMapSchema", () => {
  it("only accepts levels zero through four", () => {
    expect(intensityMapSchema.safeParse([[0, 1, 2, 3, 4]]).success).toBe(true);
    expect(intensityMapSchema.safeParse([[5]]).success).toBe(false);
  });
});

describe("mosaicProjectSchema", () => {
  it("returns a useful path for an invalid project", () => {
    const result = mosaicProjectSchema.safeParse({ schemaVersion: 1 });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(
        result.error.issues.some((issue) => issue.path[0] === "name"),
      ).toBe(true);
  });
});
