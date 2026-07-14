import type { PreviewMode } from "@git-mosaic/core";
import type { ExecutionResult, PublishReport } from "@git-mosaic/git";
import type { SvgRenderOptions } from "@git-mosaic/renderer";
import type {
  CommitPlan,
  FitReport,
  Intensity,
  MosaicProject,
} from "@git-mosaic/schemas";

export interface PlanFormInput {
  repositoryPath: string;
  branch: string;
  repositoryMode: "new" | "existing";
  expectedHead?: string;
  authorName: string;
  authorEmail: string;
  commitMode: "empty" | "file";
  filePath?: string;
  allowFuture?: boolean;
  messageTemplate?: string;
  /** Files committed into the plan's first commit, e.g. a README.md. */
  files?: { path: string; content: string }[];
}

export type PeriodMode = "year" | "custom" | "rolling";

export interface CreateProjectInput {
  name: string;
  timezone: string;
  periodMode: PeriodMode;
  /** Required when periodMode is "year". */
  year?: number;
  /** Both required when periodMode is "custom". */
  from?: string;
  to?: string;
}

export interface CreateProjectResult {
  project: MosaicProject;
  projectPath: string;
  repositoryPath: string;
}

export interface ImportOutcome {
  project: MosaicProject;
  report: FitReport;
}

export interface PublishFormInput {
  repositoryPath: string;
  branch: string;
  /** Create the repository with the GitHub CLI, e.g. "octocat/art". */
  createName?: string;
  visibility?: "public" | "private";
  /** Push to a repository the user already created. */
  remoteUrl?: string;
  confirmed?: boolean;
}

export interface WebApi {
  createProject(input: CreateProjectInput): Promise<CreateProjectResult>;
  loadProject(projectPath: string): Promise<MosaicProject>;
  saveProject(
    projectPath: string,
    project: MosaicProject,
  ): Promise<MosaicProject>;
  importText(
    projectPath: string,
    content: string,
    options?: { align?: "left" | "center" | "right" },
  ): Promise<ImportOutcome>;
  renderSvg(
    projectPath: string,
    options?: SvgRenderOptions,
    mode?: PreviewMode,
  ): Promise<string>;
  createPlan(
    projectPath: string,
    input: PlanFormInput,
  ): Promise<{ plan: CommitPlan; planPath: string }>;
  dryRun(
    planPath: string,
    allowExistingRepository?: boolean,
  ): Promise<ExecutionResult>;
  apply(
    planPath: string,
    options: {
      allowExistingRepository?: boolean;
      allowRepositoryWithRemotes?: boolean;
    },
  ): Promise<ExecutionResult>;
  publish(input: PublishFormInput): Promise<PublishReport>;
}

export interface MosaicEditorState {
  project: MosaicProject;
  selectedIntensity: Intensity;
  canUndo: boolean;
  canRedo: boolean;
  setSelectedIntensity(value: Intensity): void;
  paint(row: number, column: number): void;
  replaceProject(project: MosaicProject): void;
  undo(): void;
  redo(): void;
}
