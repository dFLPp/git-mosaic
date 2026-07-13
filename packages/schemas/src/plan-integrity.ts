import { createHash } from "node:crypto";
import { GitMosaicError } from "./errors.js";
import { commitPlanSchema, type CommitPlan } from "./index.js";

function canonicalize(value: unknown): string {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new TypeError("Canonical JSON cannot contain non-finite numbers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
      .join(",")}}`;
  }
  throw new TypeError(`Unsupported canonical JSON value: ${typeof value}`);
}

export function calculatePlanChecksum(
  plan: Omit<CommitPlan, "checksum" | "planId"> | CommitPlan,
): string {
  const payload: Record<string, unknown> = { ...plan };
  delete payload.checksum;
  delete payload.planId;
  delete payload.generatedAt;
  return createHash("sha256")
    .update(canonicalize(payload), "utf8")
    .digest("hex");
}

export function verifyCommitPlan(value: unknown): CommitPlan {
  const parsed = commitPlanSchema.safeParse(value);
  if (!parsed.success) {
    throw new GitMosaicError(
      "INVALID_PROJECT",
      "Commit plan schema is invalid",
      {
        hint: parsed.error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("; "),
        cause: parsed.error,
      },
    );
  }
  const expected = calculatePlanChecksum(parsed.data);
  if (
    parsed.data.checksum !== expected ||
    parsed.data.planId !== expected.slice(0, 16)
  ) {
    throw new GitMosaicError(
      "CHECKSUM_MISMATCH",
      "Commit plan checksum does not match its content",
    );
  }
  return parsed.data;
}
