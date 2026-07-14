import { z } from "zod";

export * from "./errors.js";

export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected an ISO date in YYYY-MM-DD format")
  .refine((value) => {
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year ?? 0, (month ?? 0) - 1, day ?? 0));
    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === (month ?? 0) - 1 &&
      date.getUTCDate() === day
    );
  }, "Expected a valid Gregorian calendar date");

export const dateRangeSchema = z
  .object({
    from: isoDateSchema,
    to: isoDateSchema,
  })
  .superRefine((range, context) => {
    if (range.from > range.to) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "The start date must not be later than the end date",
        path: ["from"],
      });
    }
  });

export const intensitySchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
]);

export const intensityMapSchema = z.array(z.array(intensitySchema));

export const commitLevelMapSchema = z.object({
  0: z.literal(0),
  1: z.number().int().nonnegative(),
  2: z.number().int().nonnegative(),
  3: z.number().int().nonnegative(),
  4: z.number().int().nonnegative(),
});

export const matrixSourceSchema = z.object({
  type: z.literal("matrix"),
  path: z.string().optional(),
});

export const fontTierSchema = z.enum(["5x7", "4x5", "3x5"]);

export const textSourceSchema = z.object({
  type: z.literal("text"),
  content: z.string().min(1).max(200),
  font: fontTierSchema,
  align: z.enum(["left", "center", "right"]).default("center"),
});

export const emptySourceSchema = z.object({ type: z.literal("empty") });

export const mosaicSourceSchema = z.discriminatedUnion("type", [
  emptySourceSchema,
  matrixSourceSchema,
  textSourceSchema,
]);

export const fitVerdictSchema = z.enum(["good", "degraded"]);

export const fitReportSchema = z.object({
  verdict: fitVerdictSchema,
  score: z.number().min(0).max(1),
  signals: z.object({
    fontTier: fontTierSchema.optional(),
    columnsUsed: z.number().int().nonnegative().optional(),
    columnsAvailable: z.number().int().positive().optional(),
  }),
  survives: z.array(z.string()),
  lost: z.array(z.string()),
  remedies: z.array(z.string()),
});

export const contributionLevelSchema = z.enum([
  "NONE",
  "FIRST_QUARTILE",
  "SECOND_QUARTILE",
  "THIRD_QUARTILE",
  "FOURTH_QUARTILE",
]);

export const confidenceSchema = z.enum(["OBSERVED", "ESTIMATED", "MIXED"]);

export const contributionSnapshotDaySchema = z.object({
  date: isoDateSchema,
  contributionCount: z.number().int().nonnegative(),
  contributionLevel: contributionLevelSchema,
  color: z.string().optional(),
});

export const contributionSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  username: z.string().min(1),
  period: dateRangeSchema,
  fetchedAt: z.string().datetime(),
  days: z.array(contributionSnapshotDaySchema),
});

export const mosaicProjectSchema = z.object({
  schemaVersion: z.literal(1),
  name: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  period: dateRangeSchema,
  timezone: z.string().min(1),
  weekStartsOn: z.literal(0),
  dimensions: z.object({
    rows: z.literal(7),
    columns: z.number().int().positive(),
  }),
  source: mosaicSourceSchema,
  intensityMap: intensityMapSchema,
  commitLevelMap: commitLevelMapSchema,
  existingContributions: contributionSnapshotSchema.optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const plannedCommitSchema = z.object({
  index: z.number().int().positive(),
  timestamp: z.string().min(1),
  message: z.string().min(1),
});

export const plannedDaySchema = z.object({
  date: isoDateSchema,
  intensity: intensitySchema,
  existingCount: z.number().int().nonnegative(),
  commitsToCreate: z.number().int().positive(),
  expectedFinalCount: z.number().int().positive(),
  expectedLevel: contributionLevelSchema,
  commits: z.array(plannedCommitSchema).min(1),
});

export const commitPlanSchema = z
  .object({
    schemaVersion: z.literal(1),
    planId: z.string().regex(/^[a-f0-9]{16}$/),
    projectName: z.string().min(1),
    generatedAt: z.string().datetime(),
    timezone: z.string().min(1),
    repository: z.object({
      path: z.string().min(1),
      branch: z.string().min(1),
      mode: z.enum(["new", "existing"]),
      expectedHead: z
        .string()
        .regex(/^[a-f0-9]{40,64}$/)
        .optional(),
    }),
    author: z.object({ name: z.string().min(1), email: z.string().email() }),
    committer: z.object({ name: z.string().min(1), email: z.string().email() }),
    strategy: z.object({
      commitMode: z.enum(["empty", "file"]),
      filePath: z.string().min(1).optional(),
      levelMap: commitLevelMapSchema,
      messageTemplate: z.string().min(1),
    }),
    totals: z.object({
      days: z.number().int().nonnegative(),
      commits: z.number().int().nonnegative(),
      maximumCommitsPerDay: z.number().int().nonnegative(),
    }),
    /**
     * Files materialized into the plan's first commit, so the repository is not
     * an empty shell. They add no extra commit and change no day's count.
     */
    files: z
      .array(
        z.object({
          path: z.string().min(1).max(255),
          content: z.string().max(64 * 1024),
        }),
      )
      .max(10)
      .optional(),
    days: z.array(plannedDaySchema),
    checksum: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .superRefine((plan, context) => {
    if (
      plan.repository.mode === "existing" &&
      plan.repository.expectedHead === undefined
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["repository", "expectedHead"],
        message: "Existing repository plans require expectedHead",
      });
    }
    if (
      plan.strategy.commitMode === "file" &&
      plan.strategy.filePath === undefined
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["strategy", "filePath"],
        message: "File commit mode requires filePath",
      });
    }
    const totalCommits = plan.days.reduce(
      (sum, day) => sum + day.commitsToCreate,
      0,
    );
    const maximum = plan.days.reduce(
      (current, day) => Math.max(current, day.commitsToCreate),
      0,
    );
    if (plan.totals.days !== plan.days.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["totals", "days"],
        message: "Day total is inconsistent",
      });
    }
    if (plan.totals.commits !== totalCommits) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["totals", "commits"],
        message: "Commit total is inconsistent",
      });
    }
    if (plan.totals.maximumCommitsPerDay !== maximum) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["totals", "maximumCommitsPerDay"],
        message: "Maximum commits per day is inconsistent",
      });
    }
    let previousDate: string | undefined;
    for (const [dayIndex, day] of plan.days.entries()) {
      if (previousDate !== undefined && day.date <= previousDate) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["days", dayIndex, "date"],
          message: "Planned days must be unique and chronologically ordered",
        });
      }
      previousDate = day.date;
      if (day.commits.length !== day.commitsToCreate) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["days", dayIndex, "commits"],
          message: "Commit list length does not match commitsToCreate",
        });
      }
      if (day.expectedFinalCount !== day.existingCount + day.commitsToCreate) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["days", dayIndex, "expectedFinalCount"],
          message: "Expected final count is inconsistent",
        });
      }
      day.commits.forEach((commit, commitIndex) => {
        if (commit.index !== commitIndex + 1) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["days", dayIndex, "commits", commitIndex, "index"],
            message: "Commit indices must be contiguous and one-based",
          });
        }
        if (!commit.timestamp.startsWith(`${day.date}T`)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["days", dayIndex, "commits", commitIndex, "timestamp"],
            message: "Commit timestamp must fall on its planned local date",
          });
        }
      });
    }
  });

export type DateRange = z.infer<typeof dateRangeSchema>;
export type Intensity = z.infer<typeof intensitySchema>;
export type IntensityMap = z.infer<typeof intensityMapSchema>;
export type CommitLevelMap = z.infer<typeof commitLevelMapSchema>;
export type FontTier = z.infer<typeof fontTierSchema>;
export type FitVerdict = z.infer<typeof fitVerdictSchema>;
export type FitReport = z.infer<typeof fitReportSchema>;
export type TextSource = z.infer<typeof textSourceSchema>;
export type MosaicSource = z.infer<typeof mosaicSourceSchema>;
export type ContributionLevel = z.infer<typeof contributionLevelSchema>;
export type Confidence = z.infer<typeof confidenceSchema>;
export type ContributionSnapshot = z.infer<typeof contributionSnapshotSchema>;
export type MosaicProject = z.infer<typeof mosaicProjectSchema>;
export type PlannedCommit = z.infer<typeof plannedCommitSchema>;
export type PlannedDay = z.infer<typeof plannedDaySchema>;
export type CommitPlan = z.infer<typeof commitPlanSchema>;
