import { randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, stat } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  createCommitPlan,
  initializeProject,
  importText,
  isGitMosaicError,
  type PreviewMode,
  readCommitPlan,
  readProject,
  renderProjectSvg,
  writeCommitPlan,
  writeProject,
} from "@git-mosaic/core";
import {
  civilYearRange,
  rollingYearRange,
  todayInTimezone,
} from "@git-mosaic/calendar";
import { applyCommitPlan, publishRepository } from "@git-mosaic/git";
import type { SvgRenderOptions } from "@git-mosaic/renderer";
import { mosaicProjectSchema, type DateRange } from "@git-mosaic/schemas";
import type { PlanFormInput } from "./contracts.js";

const SESSION_HEADER = "x-git-mosaic-session";
const DEFAULT_BODY_LIMIT = 12 * 1024 * 1024;
const DEFAULT_STATIC_ROOT = fileURLToPath(
  new URL("../dist/public", import.meta.url),
);

export interface LocalServerOptions {
  staticRoot?: string;
  sessionToken?: string;
  maximumBodyBytes?: number;
  /** Explicit local frontend origins trusted when requests arrive through a dev proxy. */
  allowedOrigins?: readonly string[];
  /** Directory that holds generated projects. Defaults to `<workspace>/output`. */
  outputRoot?: string;
}

/** Walks up from this module to the workspace root so projects land in `./output`. */
function findWorkspaceRoot(): string {
  let directory = fileURLToPath(new URL(".", import.meta.url));
  for (let depth = 0; depth < 8; depth += 1) {
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
    if (path.basename(directory) === "git-mosaic") return directory;
  }
  return process.cwd();
}

const DEFAULT_OUTPUT_ROOT = path.join(findWorkspaceRoot(), "output");

function slugify(name: string): string {
  const slug = name
    .normalize("NFD")
    .replaceAll(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "");
  return slug === "" ? "mosaic" : slug.slice(0, 48);
}

/** Resolves the period the editor asked for, mirroring the CLI's `init` options. */
function resolvePeriod(
  input: Record<string, unknown>,
  timezone: string,
): { period: DateRange; suffix: string } {
  const mode = input.periodMode ?? "rolling";
  if (mode === "year") {
    const year = Number(input.year);
    if (!Number.isInteger(year) || year < 1970 || year > 2100) {
      throw new HttpError(
        400,
        "A four-digit year between 1970 and 2100 is required",
      );
    }
    return { period: civilYearRange(year), suffix: String(year) };
  }
  if (mode === "custom") {
    const from = requiredString(input, "from");
    const to = requiredString(input, "to");
    return { period: { from, to }, suffix: `${from}_${to}` };
  }
  const period = rollingYearRange(todayInTimezone(timezone));
  return { period, suffix: `${period.from}_${period.to}` };
}

/** Never overwrites an existing project: `hire-me-2025`, then `hire-me-2025-2`, ... */
async function uniqueDirectory(root: string, base: string): Promise<string> {
  for (let attempt = 1; attempt < 100; attempt += 1) {
    const candidate = path.join(
      root,
      attempt === 1 ? base : `${base}-${attempt}`,
    );
    try {
      await access(candidate);
    } catch {
      return candidate;
    }
  }
  throw new HttpError(409, `Too many projects named ${base}`);
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function sendJson(
  response: ServerResponse,
  status: number,
  value: unknown,
): void {
  const body = `${JSON.stringify(value)}\n`;
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(body);
}

function safeError(error: unknown): { status: number; body: unknown } {
  if (error instanceof HttpError) {
    return {
      status: error.status,
      body: { error: { message: error.message } },
    };
  }
  if (isGitMosaicError(error)) {
    return {
      status: 400,
      body: {
        error: {
          code: error.code,
          message: error.message,
          ...(error.hint === undefined ? {} : { hint: error.hint }),
        },
      },
    };
  }
  if (isRecord(error) && error.name === "ZodError") {
    return {
      status: 400,
      body: {
        error: {
          message: "Request data does not match the required schema",
          hint: "The local server logged the offending fields",
        },
      },
    };
  }
  // The response stays deliberately vague, but a 500 must never be silent:
  // without this the only clue is "could not complete the request".
  return {
    status: 500,
    body: {
      error: {
        message: "The local server could not complete the request",
        hint: "The local server logged the cause; check the terminal running it",
      },
    },
  };
}

/** Unexpected failures are logged locally so a 500 is diagnosable. */
function logUnexpected(route: string, error: unknown): void {
  if (error instanceof HttpError || isGitMosaicError(error)) return;
  process.stderr.write(
    `git-mosaic: ${route} failed\n${
      error instanceof Error ? (error.stack ?? error.message) : String(error)
    }\n`,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function objectBody(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new HttpError(400, "Expected a JSON object body");
  return value;
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new HttpError(400, `${key} must be a non-empty string`);
  }
  return value;
}

function projectPath(record: Record<string, unknown>): string {
  return requiredString(record, "path");
}

function optionalBoolean(
  record: Record<string, unknown>,
  key: string,
): boolean | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean")
    throw new HttpError(400, `${key} must be a boolean`);
  return value;
}

function equalToken(received: string | undefined, expected: string): boolean {
  if (received === undefined) return false;
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function localOrigin(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError(`Invalid allowed origin: ${value}`);
  }
  if (
    parsed.protocol !== "http:" ||
    (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw new TypeError(`Allowed origin must be a local HTTP origin: ${value}`);
  }
  return parsed.origin;
}

function assertOrigin(
  request: IncomingMessage,
  allowedOrigins: ReadonlySet<string>,
): void {
  const origin = request.headers.origin;
  if (origin === undefined) return;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new HttpError(403, "External origins are not allowed");
  }
  if (parsed.protocol !== "http:") {
    throw new HttpError(403, "External origins are not allowed");
  }
  if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") {
    throw new HttpError(403, "External origins are not allowed");
  }
  if (
    parsed.host !== request.headers.host &&
    !allowedOrigins.has(parsed.origin)
  ) {
    throw new HttpError(403, "External origins are not allowed");
  }
}

async function readJson(
  request: IncomingMessage,
  maximumBytes: number,
): Promise<unknown> {
  const declaredLength = Number(request.headers["content-length"] ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    request.resume();
    throw new HttpError(413, "Request body is too large");
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maximumBytes)
      throw new HttpError(413, "Request body is too large");
    chunks.push(buffer);
  }
  if (chunks.length === 0)
    throw new HttpError(400, "A JSON request body is required");
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new HttpError(400, "Request body is not valid JSON");
  }
}

function previewMode(record: Record<string, unknown>): PreviewMode {
  const mode = record.mode;
  if (mode === undefined) return "artistic";
  if (mode !== "artistic" && mode !== "estimate") {
    throw new HttpError(400, "mode is invalid");
  }
  return mode;
}

function svgOptions(record: Record<string, unknown>): SvgRenderOptions {
  const value = record.options;
  if (value === undefined) return {};
  const options = objectBody(value);
  const result: Record<string, unknown> = {};
  if (options.theme !== undefined) {
    if (options.theme !== "light" && options.theme !== "dark")
      throw new HttpError(400, "options.theme is invalid");
    result.theme = options.theme;
  }
  for (const key of [
    "showMonths",
    "showWeekdays",
    "showLegend",
    "tooltips",
  ] as const) {
    const value = optionalBoolean(options, key);
    if (value !== undefined) result[key] = value;
  }
  for (const key of ["cellSize", "cellGap"] as const) {
    const value = options[key];
    if (value !== undefined) {
      if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        value < 0 ||
        (key === "cellSize" && value === 0)
      ) {
        throw new HttpError(400, `options.${key} is invalid`);
      }
      result[key] = value;
    }
  }
  return result as SvgRenderOptions;
}

function planInput(value: unknown): PlanFormInput {
  const input = objectBody(value);
  const repositoryMode = input.repositoryMode;
  const commitMode = input.commitMode;
  if (repositoryMode !== "new" && repositoryMode !== "existing")
    throw new HttpError(400, "input.repositoryMode is invalid");
  if (commitMode !== "empty" && commitMode !== "file")
    throw new HttpError(400, "input.commitMode is invalid");
  const expectedHead = input.expectedHead;
  const filePath = input.filePath;
  const allowFuture = optionalBoolean(input, "allowFuture");
  if (expectedHead !== undefined && typeof expectedHead !== "string")
    throw new HttpError(400, "input.expectedHead must be a string");
  if (filePath !== undefined && typeof filePath !== "string")
    throw new HttpError(400, "input.filePath must be a string");
  const messageTemplate = input.messageTemplate;
  if (
    messageTemplate !== undefined &&
    (typeof messageTemplate !== "string" || messageTemplate.trim() === "")
  ) {
    throw new HttpError(
      400,
      "input.messageTemplate must be a non-empty string",
    );
  }
  const files = repositoryFiles(input.files);
  return {
    repositoryPath: requiredString(input, "repositoryPath"),
    branch: requiredString(input, "branch"),
    repositoryMode,
    ...(expectedHead === undefined ? {} : { expectedHead }),
    authorName: requiredString(input, "authorName"),
    authorEmail: requiredString(input, "authorEmail"),
    commitMode,
    ...(filePath === undefined ? {} : { filePath }),
    ...(allowFuture === undefined ? {} : { allowFuture }),
    ...(messageTemplate === undefined ? {} : { messageTemplate }),
    ...(files === undefined ? {} : { files }),
  };
}

/** Repository files are user-authored content, so they are validated, not trusted. */
function repositoryFiles(
  value: unknown,
): { path: string; content: string }[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 10)
    throw new HttpError(
      400,
      "input.files must be an array of at most 10 files",
    );
  return value.map((entry) => {
    const file = objectBody(entry);
    const filePath = requiredString(file, "path");
    const content = file.content;
    if (typeof content !== "string" || content.length > 64 * 1024)
      throw new HttpError(400, "input.files[].content must be a string");
    if (path.isAbsolute(filePath) || filePath.split(/[/\\]/).includes(".."))
      throw new HttpError(400, `Unsafe file path: ${filePath}`);
    return { path: filePath, content };
  });
}

async function serveStatic(
  response: ServerResponse,
  pathname: string,
  staticRoot: string,
  headOnly: boolean,
): Promise<void> {
  const decoded = decodeURIComponent(pathname);
  const relative = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const root = path.resolve(staticRoot);
  const target = path.resolve(root, relative);
  if (target !== root && !target.startsWith(`${root}${path.sep}`))
    throw new HttpError(404, "Not found");
  let info;
  try {
    info = await stat(target);
  } catch {
    throw new HttpError(404, "Not found");
  }
  if (!info.isFile()) throw new HttpError(404, "Not found");
  const extension = path.extname(target).toLowerCase();
  const contentType =
    extension === ".html"
      ? "text/html; charset=utf-8"
      : extension === ".js"
        ? "text/javascript; charset=utf-8"
        : extension === ".css"
          ? "text/css; charset=utf-8"
          : extension === ".svg"
            ? "image/svg+xml"
            : "application/octet-stream";
  response.writeHead(200, {
    "content-type": contentType,
    "content-length": info.size,
    "x-content-type-options": "nosniff",
    "content-security-policy":
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    "cross-origin-resource-policy": "same-origin",
    "referrer-policy": "no-referrer",
    "x-frame-options": "DENY",
  });
  if (headOnly) {
    response.end();
    return;
  }
  createReadStream(target).pipe(response);
}

export function createLocalServer(options: LocalServerOptions = {}) {
  const sessionToken =
    options.sessionToken ?? randomBytes(32).toString("base64url");
  const maximumBodyBytes = options.maximumBodyBytes ?? DEFAULT_BODY_LIMIT;
  const staticRoot = options.staticRoot ?? DEFAULT_STATIC_ROOT;
  const outputRoot = options.outputRoot ?? DEFAULT_OUTPUT_ROOT;
  const allowedOrigins = new Set(
    (options.allowedOrigins ?? []).map(localOrigin),
  );
  if (!Number.isSafeInteger(maximumBodyBytes) || maximumBodyBytes <= 0) {
    throw new TypeError("maximumBodyBytes must be a positive safe integer");
  }

  return createServer((request, response) => {
    void (async () => {
      assertOrigin(request, allowedOrigins);
      const url = new URL(
        request.url ?? "/",
        `http://${request.headers.host ?? "127.0.0.1"}`,
      );
      if (request.method === "GET" && url.pathname === "/api/session") {
        sendJson(response, 200, { session: sessionToken });
        return;
      }
      if (request.method === "POST") {
        const received = Array.isArray(request.headers[SESSION_HEADER])
          ? undefined
          : request.headers[SESSION_HEADER];
        if (!equalToken(received, sessionToken))
          throw new HttpError(403, "A valid local session header is required");
        const body = objectBody(await readJson(request, maximumBodyBytes));
        if (url.pathname === "/api/project/create") {
          const input = objectBody(body.input);
          const timezone = requiredString(input, "timezone");
          const name = requiredString(input, "name");
          const { period, suffix } = resolvePeriod(input, timezone);
          const projectPath = await uniqueDirectory(
            outputRoot,
            `${slugify(name)}-${suffix}`,
          );
          const project = await initializeProject(projectPath, {
            name,
            timezone,
            period,
          });
          sendJson(response, 201, {
            project,
            projectPath,
            repositoryPath: path.join(projectPath, "repository"),
          });
          return;
        }
        if (url.pathname === "/api/publish") {
          const input = objectBody(body.input);
          const createName = input.createName;
          const remoteUrl = input.remoteUrl;
          const report = await publishRepository({
            repositoryPath: requiredString(input, "repositoryPath"),
            branch: requiredString(input, "branch"),
            ...(typeof createName === "string" && createName.trim() !== ""
              ? {
                  createRepository: {
                    name: createName,
                    visibility:
                      input.visibility === "public" ? "public" : "private",
                  },
                }
              : {}),
            ...(typeof remoteUrl === "string" && remoteUrl.trim() !== ""
              ? { remoteUrl }
              : {}),
            confirmed: optionalBoolean(input, "confirmed") ?? false,
          });
          sendJson(response, 200, { report });
          return;
        }
        if (url.pathname === "/api/project/load") {
          sendJson(response, 200, {
            project: await readProject(projectPath(body)),
          });
          return;
        }
        if (url.pathname === "/api/project/save") {
          const project = mosaicProjectSchema.parse({
            ...mosaicProjectSchema.parse(body.project),
            updatedAt: new Date().toISOString(),
          });
          await writeProject(projectPath(body), project);
          sendJson(response, 200, { project });
          return;
        }
        if (url.pathname === "/api/text/import") {
          const content = requiredString(body, "content");
          const rawOptions =
            body.options === undefined ? {} : objectBody(body.options);
          const align = rawOptions.align;
          if (
            align !== undefined &&
            align !== "left" &&
            align !== "center" &&
            align !== "right"
          ) {
            throw new HttpError(400, "options.align is invalid");
          }
          const { project, report } = await importText(
            projectPath(body),
            content,
            align === undefined ? {} : { align },
          );
          sendJson(response, 200, { project, report });
          return;
        }
        if (url.pathname === "/api/preview/svg") {
          const svg = await renderProjectSvg(
            projectPath(body),
            svgOptions(body),
            previewMode(body),
          );
          sendJson(response, 200, { svg });
          return;
        }
        if (url.pathname === "/api/plan/create") {
          const targetProjectPath = projectPath(body);
          const input = planInput(body.input);
          const project = await readProject(targetProjectPath);
          const plan = createCommitPlan({
            project,
            repository: {
              path: input.repositoryPath,
              branch: input.branch,
              mode: input.repositoryMode,
              ...(input.expectedHead === undefined
                ? {}
                : { expectedHead: input.expectedHead }),
            },
            author: { name: input.authorName, email: input.authorEmail },
            commitMode: input.commitMode,
            ...(input.filePath === undefined
              ? {}
              : { filePath: input.filePath }),
            ...(input.allowFuture === undefined
              ? {}
              : { allowFuture: input.allowFuture }),
            ...(input.messageTemplate === undefined
              ? {}
              : { messageTemplate: input.messageTemplate }),
            ...(input.files === undefined ? {} : { files: input.files }),
          });
          const planPath = path.join(
            path.resolve(targetProjectPath),
            "plans",
            `${plan.planId}.json`,
          );
          await writeCommitPlan(planPath, plan);
          sendJson(response, 200, { plan, planPath });
          return;
        }
        if (url.pathname === "/api/plan/dry-run") {
          const plan = await readCommitPlan(requiredString(body, "planPath"));
          const allowExistingRepository = optionalBoolean(
            body,
            "allowExistingRepository",
          );
          const result = await applyCommitPlan(plan, {
            dryRun: true,
            ...(allowExistingRepository === undefined
              ? {}
              : { allowExistingRepository }),
          });
          sendJson(response, 200, { result });
          return;
        }
        if (url.pathname === "/api/plan/apply") {
          if (body.confirmed !== true)
            throw new HttpError(
              400,
              "Plan application requires confirmed: true",
            );
          const plan = await readCommitPlan(requiredString(body, "planPath"));
          const allowExistingRepository = optionalBoolean(
            body,
            "allowExistingRepository",
          );
          const allowRepositoryWithRemotes = optionalBoolean(
            body,
            "allowRepositoryWithRemotes",
          );
          const result = await applyCommitPlan(plan, {
            confirmed: true,
            ...(allowExistingRepository === undefined
              ? {}
              : { allowExistingRepository }),
            ...(allowRepositoryWithRemotes === undefined
              ? {}
              : { allowRepositoryWithRemotes }),
          });
          sendJson(response, 200, { result });
          return;
        }
      }
      if (url.pathname.startsWith("/api/"))
        throw new HttpError(404, "API route not found");
      if (request.method !== "GET" && request.method !== "HEAD")
        throw new HttpError(405, "Method not allowed");
      await serveStatic(
        response,
        url.pathname,
        staticRoot,
        request.method === "HEAD",
      );
    })().catch((error: unknown) => {
      logUnexpected(request.url ?? "/", error);
      if (response.headersSent) {
        response.destroy();
        return;
      }
      const safe = safeError(error);
      sendJson(response, safe.status, safe.body);
    });
  });
}

const entrypoint = process.argv[1];
if (
  entrypoint !== undefined &&
  pathToFileURL(path.resolve(entrypoint)).href === import.meta.url
) {
  const port = Number(process.env.PORT ?? 4173);
  const server = createLocalServer();
  server.listen(port, "127.0.0.1", () => {
    const address = server.address();
    const actualPort =
      typeof address === "object" && address !== null ? address.port : port;
    process.stdout.write(
      `git-mosaic web is available at http://127.0.0.1:${actualPort}\n`,
    );
  });
}
