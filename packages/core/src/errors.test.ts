import { describe, expect, it } from "vitest";
import { GitMosaicError, errorCodes, isGitMosaicError } from "./errors.js";

describe("GitMosaicError", () => {
  it("formats a stable error code and corrective hint", () => {
    const error = new GitMosaicError("INVALID_PROJECT", "Project is invalid", {
      hint: "Check mosaic.json",
    });

    expect(error.code).toBe(errorCodes.INVALID_PROJECT);
    expect(error.format()).toBe(
      "GM001 Project is invalid\nHint: Check mosaic.json",
    );
    expect(isGitMosaicError(error)).toBe(true);
  });
});
