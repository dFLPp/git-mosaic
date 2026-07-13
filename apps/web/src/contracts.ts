import type { ExecutionResult } from "@git-mosaic/git";
import type { RasterImportOptions } from "@git-mosaic/image";
import type { SvgRenderOptions } from "@git-mosaic/renderer";
import type { CommitPlan, Intensity, MosaicProject } from "@git-mosaic/schemas";

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
}

export interface CreateProjectInput {
  name: string;
  timezone: string;
}

export interface CreateProjectResult {
  project: MosaicProject;
  projectPath: string;
  repositoryPath: string;
}

export interface ImageDebugResult {
  width: number;
  height: number;
  intensitiesBase64: string;
}

export interface WebApi {
  createProject(input: CreateProjectInput): Promise<CreateProjectResult>;
  loadProject(projectPath: string): Promise<MosaicProject>;
  saveProject(
    projectPath: string,
    project: MosaicProject,
  ): Promise<MosaicProject>;
  importImage(
    projectPath: string,
    file: File,
    options?: RasterImportOptions,
  ): Promise<MosaicProject>;
  debugImage(
    file: File,
    options?: RasterImportOptions,
  ): Promise<ImageDebugResult>;
  renderSvg(projectPath: string, options?: SvgRenderOptions): Promise<string>;
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
