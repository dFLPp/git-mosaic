import type { PreviewMode } from "@git-mosaic/core";
import type { ExecutionResult, PublishReport } from "@git-mosaic/git";
import type { SvgRenderOptions } from "@git-mosaic/renderer";
import type { CommitPlan, MosaicProject } from "@git-mosaic/schemas";
import type {
  CreateProjectInput,
  ImportOutcome,
  PlanFormInput,
  PublishFormInput,
  WebApi,
} from "./contracts.js";

interface ErrorResponse {
  error?: { code?: string; message?: string; hint?: string };
}

async function parseResponse<T>(response: Response): Promise<T> {
  const value = (await response.json()) as T & ErrorResponse;
  if (!response.ok) {
    const prefix = value.error?.code ? `${value.error.code} ` : "";
    const hint = value.error?.hint ? `\n${value.error.hint}` : "";
    throw new Error(
      `${prefix}${value.error?.message ?? `Request failed (${response.status})`}${hint}`,
    );
  }
  return value;
}

export function createWebApi(baseUrl = ""): WebApi {
  let sessionPromise: Promise<string> | undefined;
  const session = (): Promise<string> => {
    sessionPromise ??= fetch(`${baseUrl}/api/session`)
      .then((response) => parseResponse<{ session: string }>(response))
      .then((value) => value.session);
    return sessionPromise;
  };
  const post = async <T>(route: string, body: unknown): Promise<T> =>
    parseResponse<T>(
      await fetch(`${baseUrl}${route}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Git-Mosaic-Session": await session(),
        },
        body: JSON.stringify(body),
      }),
    );

  return {
    async createProject(input: CreateProjectInput) {
      return post<{
        project: MosaicProject;
        projectPath: string;
        repositoryPath: string;
      }>("/api/project/create", { input });
    },
    async loadProject(projectPath) {
      return (
        await post<{ project: MosaicProject }>("/api/project/load", {
          path: projectPath,
        })
      ).project;
    },
    async saveProject(projectPath, project) {
      return (
        await post<{ project: MosaicProject }>("/api/project/save", {
          path: projectPath,
          project,
        })
      ).project;
    },
    async importText(projectPath, content, options = {}) {
      return post<ImportOutcome>("/api/text/import", {
        path: projectPath,
        content,
        options,
      });
    },
    async renderSvg(
      projectPath,
      options: SvgRenderOptions = {},
      mode: PreviewMode = "artistic",
    ) {
      return (
        await post<{ svg: string }>("/api/preview/svg", {
          path: projectPath,
          options,
          mode,
        })
      ).svg;
    },
    async createPlan(projectPath, input: PlanFormInput) {
      return post<{ plan: CommitPlan; planPath: string }>("/api/plan/create", {
        path: projectPath,
        input,
      });
    },
    async dryRun(planPath, allowExistingRepository = false) {
      return (
        await post<{ result: ExecutionResult }>("/api/plan/dry-run", {
          planPath,
          allowExistingRepository,
        })
      ).result;
    },
    async apply(planPath, options) {
      return (
        await post<{ result: ExecutionResult }>("/api/plan/apply", {
          planPath,
          confirmed: true,
          ...options,
        })
      ).result;
    },
    async publish(input: PublishFormInput) {
      return (await post<{ report: PublishReport }>("/api/publish", { input }))
        .report;
    },
  };
}
