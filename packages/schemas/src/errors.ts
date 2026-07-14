export const errorCodes = {
  INVALID_PROJECT: "GM001",
  INVALID_DATE_RANGE: "GM002",
  INVALID_TIMEZONE: "GM003",
  INVALID_INTENSITY_MAP: "GM004",
  GIT_NOT_FOUND: "GM005",
  REPOSITORY_DIRTY: "GM006",
  EXISTING_REPOSITORY_NOT_ALLOWED: "GM007",
  INVALID_AUTHOR: "GM008",
  PLAN_TOO_LARGE: "GM009",
  PLAN_ALREADY_APPLIED: "GM010",
  GITHUB_AUTH_FAILED: "GM011",
  GITHUB_RATE_LIMITED: "GM012",
  CHECKSUM_MISMATCH: "GM013",
  FUTURE_DATE_NOT_ALLOWED: "GM014",
  TEXT_DOES_NOT_FIT: "GM016",
  UNSUPPORTED_TEXT: "GM017",
  PUBLISH_NOT_CONFIRMED: "GM018",
  PUBLISH_TARGET_MISSING: "GM019",
  GITHUB_CLI_UNAVAILABLE: "GM020",
} as const;

export type ErrorName = keyof typeof errorCodes;
export type ErrorCode = (typeof errorCodes)[ErrorName];

export class GitMosaicError extends Error {
  readonly code: ErrorCode;
  readonly hint: string | undefined;
  override readonly cause: unknown;

  constructor(
    name: ErrorName,
    message: string,
    options: { hint?: string; cause?: unknown } = {},
  ) {
    super(message);
    this.name = "GitMosaicError";
    this.code = errorCodes[name];
    this.hint = options.hint;
    this.cause = options.cause;
  }

  format(): string {
    return this.hint
      ? `${this.code} ${this.message}\nHint: ${this.hint}`
      : `${this.code} ${this.message}`;
  }
}

export function isGitMosaicError(value: unknown): value is GitMosaicError {
  return value instanceof GitMosaicError;
}
