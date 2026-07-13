import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  contributionSnapshotSchema,
  GitMosaicError,
  type ContributionSnapshot,
} from "@git-mosaic/schemas";

export async function writeContributionSnapshot(
  filePath: string,
  snapshot: ContributionSnapshot,
): Promise<void> {
  const parsed = contributionSnapshotSchema.safeParse(snapshot);
  if (!parsed.success) {
    throw new GitMosaicError(
      "INVALID_PROJECT",
      "Cannot write an invalid GitHub snapshot",
      {
        cause: parsed.error,
      },
    );
  }
  const target = path.resolve(filePath);
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp`;
  await writeFile(
    temporary,
    `${JSON.stringify(parsed.data, null, 2)}\n`,
    "utf8",
  );
  await rename(temporary, target);
}

export async function readContributionSnapshot(
  filePath: string,
): Promise<ContributionSnapshot> {
  try {
    const value = JSON.parse(
      await readFile(path.resolve(filePath), "utf8"),
    ) as unknown;
    const parsed = contributionSnapshotSchema.safeParse(value);
    if (!parsed.success) {
      throw new GitMosaicError(
        "INVALID_PROJECT",
        "GitHub snapshot schema is invalid",
        {
          cause: parsed.error,
        },
      );
    }
    return parsed.data;
  } catch (cause) {
    if (cause instanceof GitMosaicError) throw cause;
    throw new GitMosaicError(
      "INVALID_PROJECT",
      `Could not read GitHub snapshot: ${filePath}`,
      {
        cause,
      },
    );
  }
}
