import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { buildPreviewCalendar } from "@git-mosaic/core/preview";
import type { Intensity, MosaicProject } from "@git-mosaic/schemas";
import type { ImageDebugResult, PlanFormInput, WebApi } from "./contracts.js";
import { useMosaicEditor } from "./useMosaicEditor.js";

export interface AppProps {
  api: WebApi;
}

type Language = "en" | "pt-BR";
type MessageKey = keyof typeof messages.en;

const messages = {
  en: {
    title: "Git Mosaic Studio",
    subtitle: "Design, review, and safely materialize a contribution mosaic.",
    language: "Language",
    createProject: "New mosaic",
    save: "Save mosaic.json",
    export: "Export SVG",
    editor: "Mosaic editor",
    palette: "Intensity palette",
    intensity: "Intensity",
    zoom: "Zoom",
    undo: "Undo",
    redo: "Redo",
    drop: "Drop an image here or choose a file",
    choose: "Choose image",
    planning: "Plan and review",
    authorName: "Author name",
    authorEmail: "Author email",
    commitMode: "Commit mode",
    emptyCommits: "Empty commits",
    fileCommits: "File commits",
    filePath: "Commit file path",
    createPlan: "Create plan",
    dryRun: "Dry run",
    apply: "Apply plan",
    planSummary: "Plan summary",
    commits: "commits",
    days: "days",
    disclosure:
      "I understand this creates artificial-history artwork commits and does not push them.",
    confirmation: 'Type "APPLY" to confirm',
    result: "Execution result",
    created: "Project created and ready.",
    saved: "mosaic.json saved.",
    imported: "Image imported.",
    exported: "SVG exported.",
    planCreated: "Plan created and ready for review.",
    estimated: "Preview colors are estimates and may differ from GitHub.",
    canvas: "Contribution mosaic canvas",
    debugOriginal: "Original-pixel debug",
    contributionPreview: "Contribution preview",
    sourcePixels: "source pixels",
    noProjectTitle: "Start with a project",
    noProject: "Create a mosaic or choose an image. No folder paths required.",
    projectRequired:
      "Create a mosaic first. Its workspace and Git repository are managed automatically.",
  },
  "pt-BR": {
    title: "Git Mosaic Studio",
    subtitle:
      "Desenhe, revise e materialize um mosaico de contribuições com segurança.",
    language: "Idioma",
    createProject: "Novo mosaico",
    save: "Salvar mosaic.json",
    export: "Exportar SVG",
    editor: "Editor de mosaico",
    palette: "Paleta de intensidade",
    intensity: "Intensidade",
    zoom: "Zoom",
    undo: "Desfazer",
    redo: "Refazer",
    drop: "Solte uma imagem aqui ou escolha um arquivo",
    choose: "Escolher imagem",
    planning: "Plano e revisão",
    authorName: "Nome do autor",
    authorEmail: "Email do autor",
    commitMode: "Modo de commit",
    emptyCommits: "Commits vazios",
    fileCommits: "Commits em arquivo",
    filePath: "Caminho do arquivo",
    createPlan: "Criar plano",
    dryRun: "Simular",
    apply: "Aplicar plano",
    planSummary: "Resumo do plano",
    commits: "commits",
    days: "dias",
    disclosure:
      "Entendo que isto cria commits de histórico artificial como arte e não faz push.",
    confirmation: 'Digite "APPLY" para confirmar',
    result: "Resultado da execução",
    created: "Projeto criado e pronto.",
    saved: "mosaic.json salvo.",
    imported: "Imagem importada.",
    exported: "SVG exportado.",
    planCreated: "Plano criado e pronto para revisão.",
    estimated: "As cores são estimativas e podem diferir do GitHub.",
    canvas: "Canvas do mosaico de contribuições",
    debugOriginal: "Debug dos pixels originais",
    contributionPreview: "Prévia de contribuições",
    sourcePixels: "pixels de origem",
    noProjectTitle: "Comece com um projeto",
    noProject:
      "Crie um mosaico ou escolha uma imagem. Nenhum caminho é necessário.",
    projectRequired:
      "Crie um mosaico primeiro. O workspace e o repositório Git são gerenciados automaticamente.",
  },
} as const;

const emptyMap = Array.from({ length: 7 }, () => [0 as Intensity]);
const INITIAL_PROJECT: MosaicProject = {
  schemaVersion: 1,
  name: "Untitled",
  createdAt: "1970-01-01T00:00:00.000Z",
  updatedAt: "1970-01-01T00:00:00.000Z",
  period: { from: "1970-01-04", to: "1970-01-10" },
  timezone: "UTC",
  weekStartsOn: 0,
  dimensions: { rows: 7, columns: 1 },
  source: { type: "empty" },
  intensityMap: emptyMap,
  commitLevelMap: { 0: 0, 1: 1, 2: 4, 3: 10, 4: 20 },
};

const intensityColors = ["#ebedf0", "#9be9a8", "#40c463", "#30a14e", "#216e39"];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function DebugCanvas({
  debug,
  zoom,
}: {
  debug: ImageDebugResult;
  zoom: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (debug.intensitiesBase64 === "") return;
    if (canvas === null) return;
    const context = canvas.getContext("2d");
    if (context === null) return;
    const binary = atob(debug.intensitiesBase64);
    const image = context.createImageData(debug.width, debug.height);
    const palette = [
      [235, 237, 240],
      [155, 233, 168],
      [64, 196, 99],
      [48, 161, 78],
      [33, 110, 57],
    ] as const;
    for (let index = 0; index < binary.length; index += 1) {
      const color = palette[binary.charCodeAt(index)] ?? palette[0];
      const offset = index * 4;
      image.data[offset] = color[0];
      image.data[offset + 1] = color[1];
      image.data[offset + 2] = color[2];
      image.data[offset + 3] = 255;
    }
    context.putImageData(image, 0, 0);
  }, [debug]);
  return (
    <canvas
      ref={canvasRef}
      className="debug-canvas"
      width={debug.width}
      height={debug.height}
      style={{
        width: `${debug.width * zoom}px`,
        height: `${debug.height * zoom}px`,
      }}
      aria-label={`Quantized source image, ${debug.width} × ${debug.height} pixels`}
    />
  );
}

interface WritableFileHandle {
  createWritable(): Promise<{
    write(data: Blob): Promise<void>;
    close(): Promise<void>;
  }>;
}

async function saveWithNativeDialog(
  blob: Blob,
  suggestedName: string,
  mime: string,
  extension: string,
): Promise<boolean> {
  const picker = (
    window as unknown as {
      showSaveFilePicker?: (options: unknown) => Promise<WritableFileHandle>;
    }
  ).showSaveFilePicker;
  try {
    if (picker !== undefined) {
      const handle = await picker.call(window, {
        suggestedName,
        types: [
          { description: suggestedName, accept: { [mime]: [extension] } },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return true;
    }
    const createObjectUrl = URL.createObjectURL?.bind(URL);
    const url = createObjectUrl?.(blob) ?? "";
    const link = document.createElement("a");
    link.href = url;
    link.download = suggestedName;
    link.click();
    if (url !== "") URL.revokeObjectURL(url);
    return true;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError")
      return false;
    throw error;
  }
}

export function App({ api }: AppProps) {
  const [language, setLanguage] = useState<Language>("en");
  const t = (key: MessageKey): string => messages[language][key];
  const [projectPath, setProjectPath] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [planResult, setPlanResult] =
    useState<Awaited<ReturnType<WebApi["createPlan"]>>>();
  const [executionResult, setExecutionResult] =
    useState<Awaited<ReturnType<WebApi["dryRun"]>>>();
  const externalProject = useRef<MosaicProject | undefined>(undefined);
  const markDirty = useCallback((project: MosaicProject) => {
    if (externalProject.current === project) {
      externalProject.current = undefined;
      setDirty(false);
    } else {
      setDirty(true);
      setPlanResult(undefined);
      setExecutionResult(undefined);
    }
  }, []);
  const editor = useMosaicEditor(INITIAL_PROJECT, markDirty);
  const [zoom, setZoom] = useState(1);
  const [debugImage, setDebugImage] = useState<ImageDebugResult>();
  const [viewMode, setViewMode] = useState<"debug" | "contributions">(
    "contributions",
  );
  const [activeCell, setActiveCell] = useState({ row: 0, column: 0 });
  const painting = useRef(false);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [planInput, setPlanInput] = useState<PlanFormInput>({
    repositoryPath: "",
    branch: "main",
    repositoryMode: "new",
    authorName: "",
    authorEmail: "",
    commitMode: "empty",
  });
  const preview = useMemo(
    () => buildPreviewCalendar(editor.project),
    [editor.project],
  );

  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    setStatus("");
    try {
      await operation();
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const useProject = (project: MosaicProject, message: string) => {
    externalProject.current = project;
    editor.replaceProject(project);
    const firstCell = buildPreviewCalendar(project)
      .cells.flat()
      .find((cell) => cell.inRange);
    if (firstCell !== undefined) {
      setActiveCell({ row: firstCell.row, column: firstCell.column });
    }
    setLoaded(true);
    setDirty(false);
    setPlanResult(undefined);
    setExecutionResult(undefined);
    setStatus(message);
  };

  const provisionProject = async () => {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const managed = await api.createProject({ name: "mosaic", timezone });
    setProjectPath(managed.projectPath);
    setPlanInput((current) => ({
      ...current,
      repositoryPath: managed.repositoryPath,
      repositoryMode: "new",
      branch: "main",
    }));
    useProject(managed.project, t("created"));
    return managed;
  };

  const createProject = () => {
    void run(async () => {
      setLoaded(false);
      await provisionProject();
    });
  };

  const saveProject = () =>
    run(async () => {
      const saved = await api.saveProject(projectPath, editor.project);
      externalProject.current = saved;
      editor.replaceProject(saved);
      setDirty(false);
      const written = await saveWithNativeDialog(
        new Blob([`${JSON.stringify(saved, null, 2)}\n`], {
          type: "application/json",
        }),
        "mosaic.json",
        "application/json",
        ".json",
      );
      if (written) setStatus(t("saved"));
    });

  const importImage = (file: File) =>
    run(async () => {
      const targetPath = loaded
        ? projectPath
        : (await provisionProject()).projectPath;
      const [project, debug] = await Promise.all([
        api.importImage(targetPath, file),
        api.debugImage(file),
      ]);
      externalProject.current = project;
      editor.replaceProject(project);
      setDebugImage(debug);
      setViewMode("debug");
      setZoom(1);
      setDirty(false);
      setPlanResult(undefined);
      setExecutionResult(undefined);
      setStatus(t("imported"));
    });

  const exportSvg = () =>
    run(async () => {
      if (dirty) {
        const saved = await api.saveProject(projectPath, editor.project);
        externalProject.current = saved;
        editor.replaceProject(saved);
        setDirty(false);
      }
      const svg = await api.renderSvg(projectPath);
      const name = `${editor.project.name.replaceAll(/[^a-z0-9_-]+/gi, "-") || "mosaic"}.svg`;
      const written = await saveWithNativeDialog(
        new Blob([svg], { type: "image/svg+xml" }),
        name,
        "image/svg+xml",
        ".svg",
      );
      if (written) setStatus(t("exported"));
    });

  const moveFocus = (
    event: KeyboardEvent<HTMLButtonElement>,
    row: number,
    column: number,
  ) => {
    const movement: Record<string, readonly [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    const delta = movement[event.key];
    if (delta === undefined) return;
    event.preventDefault();
    let nextRow = row + delta[0];
    let nextColumn = column + delta[1];
    while (
      nextRow >= 0 &&
      nextRow < 7 &&
      nextColumn >= 0 &&
      nextColumn < editor.project.dimensions.columns
    ) {
      const candidate = preview.cells[nextRow]?.[nextColumn];
      if (candidate?.inRange) {
        setActiveCell({ row: nextRow, column: nextColumn });
        document
          .getElementById(`mosaic-cell-${nextRow}-${nextColumn}`)
          ?.focus();
        return;
      }
      nextRow += delta[0];
      nextColumn += delta[1];
    }
  };

  const paint = (row: number, column: number) => {
    if (!preview.cells[row]?.[column]?.inRange) return;
    setActiveCell({ row, column });
    editor.paint(row, column);
  };

  const pointerDown = (
    event: PointerEvent<HTMLButtonElement>,
    row: number,
    column: number,
  ) => {
    event.preventDefault();
    painting.current = true;
    paint(row, column);
  };

  const submitPlan = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      let targetPath = projectPath;
      let targetInput = planInput;
      if (!loaded) {
        const managed = await provisionProject();
        targetPath = managed.projectPath;
        targetInput = {
          ...planInput,
          repositoryPath: managed.repositoryPath,
          repositoryMode: "new",
          branch: "main",
        };
      }
      if (dirty) {
        const saved = await api.saveProject(targetPath, editor.project);
        externalProject.current = saved;
        editor.replaceProject(saved);
        setDirty(false);
      }
      const created = await api.createPlan(targetPath, targetInput);
      setPlanResult(created);
      setExecutionResult(undefined);
      setAcknowledged(false);
      setConfirmation("");
      setStatus(t("planCreated"));
    });
  };

  return (
    <div
      className="app-shell"
      onPointerUp={() => (painting.current = false)}
      onPointerCancel={() => (painting.current = false)}
    >
      <header className="app-header">
        <div>
          <h1>{t("title")}</h1>
          <p>{t("subtitle")}</p>
        </div>
        <label className="language-picker">
          {t("language")}
          <select
            value={language}
            onChange={(event) => setLanguage(event.target.value as Language)}
          >
            <option value="en">English</option>
            <option value="pt-BR">Português (Brasil)</option>
          </select>
        </label>
      </header>

      <main>
        <section
          className="panel project-bar"
          aria-labelledby="project-heading"
        >
          <h2 id="project-heading" className="sr-only">
            Project
          </h2>
          <div className="project-summary">
            <strong>
              {loaded ? editor.project.name : t("noProjectTitle")}
            </strong>
            <span>
              {loaded
                ? `${editor.project.period.from} — ${editor.project.period.to}`
                : t("noProject")}
            </span>
          </div>
          <div className="project-actions">
            <button
              type="button"
              className="primary"
              onClick={createProject}
              disabled={busy}
            >
              {t("createProject")}
            </button>
            <button
              type="button"
              onClick={() => void saveProject()}
              disabled={!loaded || busy}
            >
              {t("save")}
            </button>
            <button
              type="button"
              onClick={() => void exportSvg()}
              disabled={!loaded || busy}
            >
              {t("export")}
            </button>
          </div>
        </section>

        {status && (
          <p className="status" role="status">
            {status}
          </p>
        )}

        <div className="workspace">
          <section
            className="panel editor-panel"
            aria-labelledby="editor-heading"
          >
            <div className="section-heading">
              <div>
                <h2 id="editor-heading">{t("editor")}</h2>
                <p>{t("estimated")}</p>
              </div>
              <div className="history-actions">
                <button
                  type="button"
                  onClick={editor.undo}
                  disabled={!editor.canUndo}
                >
                  {t("undo")}
                </button>
                <button
                  type="button"
                  onClick={editor.redo}
                  disabled={!editor.canRedo}
                >
                  {t("redo")}
                </button>
              </div>
            </div>

            {!loaded ? (
              <div className="empty-state">
                <div className="empty-state-mark" aria-hidden="true">
                  +
                </div>
                <h3>{t("noProjectTitle")}</h3>
                <p>{t("noProject")}</p>
              </div>
            ) : (
              <>
                <fieldset className="palette">
                  <legend>{t("palette")}</legend>
                  {[0, 1, 2, 3, 4].map((value) => (
                    <button
                      key={value}
                      type="button"
                      className={
                        editor.selectedIntensity === value ? "selected" : ""
                      }
                      style={
                        {
                          "--level-color": intensityColors[value],
                        } as CSSProperties
                      }
                      aria-pressed={editor.selectedIntensity === value}
                      aria-label={`${t("intensity")} ${value}`}
                      onClick={() =>
                        editor.setSelectedIntensity(value as Intensity)
                      }
                    >
                      <span aria-hidden="true" />
                      {value}
                    </button>
                  ))}
                </fieldset>

                {debugImage !== undefined && (
                  <div className="view-switcher" role="group" aria-label="View">
                    <button
                      type="button"
                      className={viewMode === "debug" ? "selected" : ""}
                      aria-pressed={viewMode === "debug"}
                      onClick={() => setViewMode("debug")}
                    >
                      {t("debugOriginal")}
                    </button>
                    <button
                      type="button"
                      className={viewMode === "contributions" ? "selected" : ""}
                      aria-pressed={viewMode === "contributions"}
                      onClick={() => setViewMode("contributions")}
                    >
                      {t("contributionPreview")}
                    </button>
                    <span>
                      {debugImage.width} × {debugImage.height}{" "}
                      {t("sourcePixels")}
                    </span>
                  </div>
                )}

                <label className="zoom-control">
                  {t("zoom")}: {Math.round(zoom * 100)}%
                  <input
                    type="range"
                    min={viewMode === "debug" ? "0.1" : "0.65"}
                    max={viewMode === "debug" ? "8" : "1.8"}
                    step="0.05"
                    value={zoom}
                    onChange={(event) => setZoom(Number(event.target.value))}
                  />
                </label>

                <div
                  className={`canvas-scroller ${viewMode === "debug" && debugImage !== undefined ? "debug-workspace" : ""}`}
                >
                  {viewMode === "debug" && debugImage !== undefined ? (
                    <DebugCanvas debug={debugImage} zoom={zoom} />
                  ) : (
                    <div
                      className="mosaic-grid"
                      role="grid"
                      aria-label={t("canvas")}
                      aria-rowcount={7}
                      aria-colcount={editor.project.dimensions.columns}
                      style={
                        {
                          "--columns": editor.project.dimensions.columns,
                          "--zoom": zoom,
                        } as CSSProperties
                      }
                    >
                      {preview.cells.map((row, rowIndex) =>
                        row.map((cell, columnIndex) => {
                          const intensity =
                            editor.project.intensityMap[rowIndex]?.[
                              columnIndex
                            ] ?? 0;
                          return (
                            <button
                              id={`mosaic-cell-${rowIndex}-${columnIndex}`}
                              key={`${rowIndex}-${columnIndex}`}
                              type="button"
                              role="gridcell"
                              className={
                                cell.inRange
                                  ? `mosaic-cell level-${intensity}`
                                  : "mosaic-cell out-of-range"
                              }
                              style={{
                                gridRow: rowIndex + 1,
                                gridColumn: columnIndex + 1,
                              }}
                              aria-label={`${cell.date}, ${cell.inRange ? `${t("intensity")} ${intensity}` : "outside range"}`}
                              aria-disabled={!cell.inRange || !loaded}
                              disabled={!cell.inRange || !loaded}
                              tabIndex={
                                cell.inRange &&
                                activeCell.row === rowIndex &&
                                activeCell.column === columnIndex
                                  ? 0
                                  : -1
                              }
                              onClick={() => paint(rowIndex, columnIndex)}
                              onPointerDown={(event) =>
                                pointerDown(event, rowIndex, columnIndex)
                              }
                              onPointerEnter={() => {
                                if (painting.current)
                                  paint(rowIndex, columnIndex);
                              }}
                              onKeyDown={(event) =>
                                moveFocus(event, rowIndex, columnIndex)
                              }
                            >
                              <span>{cell.inRange ? intensity : "×"}</span>
                            </button>
                          );
                        }),
                      )}
                    </div>
                  )}
                </div>
              </>
            )}

            <label
              className="drop-zone"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event: DragEvent<HTMLLabelElement>) => {
                event.preventDefault();
                const file = event.dataTransfer.files[0];
                if (file !== undefined) void importImage(file);
              }}
            >
              <strong>{t("drop")}</strong>
              <span>{t("choose")}</span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                disabled={busy}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file !== undefined) void importImage(file);
                  event.target.value = "";
                }}
              />
            </label>
          </section>

          <section className="panel plan-panel" aria-labelledby="plan-heading">
            <h2 id="plan-heading">{t("planning")}</h2>
            {!loaded && <p className="panel-note">{t("noProject")}</p>}
            <form className="plan-form" onSubmit={submitPlan}>
              <label>
                {t("authorName")}
                <input
                  required
                  value={planInput.authorName}
                  onChange={(event) =>
                    setPlanInput({
                      ...planInput,
                      authorName: event.target.value,
                    })
                  }
                />
              </label>
              <label>
                {t("authorEmail")}
                <input
                  required
                  type="email"
                  value={planInput.authorEmail}
                  onChange={(event) =>
                    setPlanInput({
                      ...planInput,
                      authorEmail: event.target.value,
                    })
                  }
                />
              </label>
              <button type="submit" className="primary" disabled={busy}>
                {t("createPlan")}
              </button>
            </form>

            {planResult && (
              <div className="plan-review" aria-live="polite">
                <h3>{t("planSummary")}</h3>
                <dl>
                  <div>
                    <dt>ID</dt>
                    <dd>{planResult.plan.planId}</dd>
                  </div>
                  <div>
                    <dt>{t("commits")}</dt>
                    <dd>{planResult.plan.totals.commits}</dd>
                  </div>
                  <div>
                    <dt>{t("days")}</dt>
                    <dd>{planResult.plan.totals.days}</dd>
                  </div>
                </dl>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void run(async () =>
                      setExecutionResult(
                        await api.dryRun(
                          planResult.planPath,
                          planResult.plan.repository.mode === "existing",
                        ),
                      ),
                    )
                  }
                >
                  {t("dryRun")}
                </button>
                <div className="apply-confirmation">
                  <label>
                    <input
                      type="checkbox"
                      checked={acknowledged}
                      onChange={(event) =>
                        setAcknowledged(event.target.checked)
                      }
                    />
                    {t("disclosure")}
                  </label>
                  <label>
                    {t("confirmation")}
                    <input
                      value={confirmation}
                      onChange={(event) => setConfirmation(event.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    className="danger"
                    disabled={
                      busy ||
                      executionResult?.status !== "dry-run" ||
                      !acknowledged ||
                      confirmation !== "APPLY"
                    }
                    onClick={() =>
                      void run(async () =>
                        setExecutionResult(
                          await api.apply(planResult.planPath, {
                            allowExistingRepository:
                              planResult.plan.repository.mode === "existing",
                          }),
                        ),
                      )
                    }
                  >
                    {t("apply")}
                  </button>
                </div>
              </div>
            )}

            {executionResult && (
              <div className="execution-result" role="status">
                <h3>{t("result")}</h3>
                <p>
                  <strong>{executionResult.status}</strong> ·{" "}
                  {executionResult.createdCommits} {t("commits")} ·{" "}
                  {executionResult.applicationState}
                </p>
                {executionResult.warnings.length > 0 && (
                  <ul>
                    {executionResult.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
