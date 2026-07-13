import path from "node:path";
import {
  writeContributionSnapshot,
  type GitHubContributionProvider,
} from "@git-mosaic/github";
import { mosaicProjectSchema, type MosaicProject } from "@git-mosaic/schemas";
import { readProject, writeProject } from "./project.js";

export async function importGitHubContributions(
  projectDirectory: string,
  username: string,
  provider: GitHubContributionProvider,
  fetchedAt?: string,
): Promise<MosaicProject> {
  const project = await readProject(projectDirectory);
  const snapshot = await provider.fetchCalendar({
    username,
    period: project.period,
    ...(fetchedAt === undefined ? {} : { fetchedAt }),
  });
  const snapshotPath = path.join(
    path.resolve(projectDirectory),
    "snapshot.github.json",
  );
  await writeContributionSnapshot(snapshotPath, snapshot);
  const updated = mosaicProjectSchema.parse({
    ...project,
    updatedAt: fetchedAt ?? snapshot.fetchedAt,
    existingContributions: snapshot,
  });
  await writeProject(projectDirectory, updated);
  return updated;
}
