import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import {
  ArtisticIntensityStrategy,
  QuartileApproximationStrategy,
} from "@git-mosaic/calendar";
import type { PreviewMode } from "@git-mosaic/core";
import { buildPreviewCalendar } from "@git-mosaic/core/preview";
import {
  DEFAULT_MESSAGE_TEMPLATE,
  defaultReadme,
  previewCommitMessage,
} from "@git-mosaic/core/messages";
import type {
  ContributionLevel,
  FitReport,
  Intensity,
  MosaicProject,
} from "@git-mosaic/schemas";
import type {
  PeriodMode,
  PlanFormInput,
  PublishFormInput,
  WebApi,
} from "./contracts.js";
import { useMosaicEditor } from "./useMosaicEditor.js";

export interface AppProps {
  api: WebApi;
}

type Language = "en" | "pt-BR";
type Theme = "light" | "dark";
type Tone = "info" | "success" | "error";
type MessageKey = keyof typeof messages.en;

interface Message {
  tone: Tone;
  text: string;
}

const messages = {
  en: {
    title: "Git Mosaic",
    subtitle: "Draw it, plan it, then commit it.",
    language: "Language",
    theme: "Toggle dark mode",
    dismiss: "Dismiss",
    createProject: "New mosaic",
    save: "Save mosaic.json",
    export: "Export SVG",
    unsaved: "Unsaved changes",
    brush: "Brush",
    intensity: "Intensity",
    perDay: "commits/day",
    perDayOne: "commit/day",
    zoom: "Zoom",
    zoomIn: "Zoom in",
    zoomOut: "Zoom out",
    values: "Values",
    history: "History",
    undo: "Undo",
    redo: "Redo",
    shortcuts: "Ctrl+Z / Ctrl+Shift+Z to undo · keys 0–4 pick a brush",
    canvas: "Contribution mosaic canvas",
    previewMode: "Preview mode",
    artisticPreview: "Drawn intensities",
    estimatePreview: "GitHub estimate",
    estimated: "Colors are a quartile estimate and may differ from GitHub.",
    artistic: "Colors match the intensities you drew, one to one.",
    totalCommits: "Commits",
    activeDays: "Active days",
    busiestDay: "Busiest day",
    weeks: "Weeks",
    textImport: "Write text",
    textPlaceholder: "Loading...",
    importTextButton: "Import text",
    textAlign: "Text alignment",
    alignLeft: "Left",
    alignCenter: "Center",
    alignRight: "Right",
    textHint: "Stamped on the calendar cells, so the strokes stay crisp.",
    fit: "Fit",
    survives: "Survives",
    lost: "Lost",
    remedies: "Remedies",
    pipeline: "From drawing to commits",
    stepDesign: "Design",
    stepDesignIdle: "Paint the grid or import text to fill the canvas.",
    stepDesignDone: "Canvas has content and is ready to plan.",
    stepPlan: "Plan",
    stepPlanHint:
      "Use the email of the GitHub account that should get the credit. A workspace and repository are created for you.",
    stepReview: "Review",
    stepReviewLocked: "Create a plan to review it here.",
    stepApply: "Apply",
    stepApplyLocked: "Run the dry run before applying.",
    runDryRun: "Run the dry run",
    stepApplyNoPlan: "Create a plan and dry-run it first.",
    authorName: "Author name",
    authorEmail: "Author email",
    createPlan: "Create plan",
    planId: "Plan ID",
    commits: "commits",
    days: "days",
    repository: "Repository",
    branch: "Branch",
    dryRun: "Dry run",
    dryRunPassed: "Dry run passed. Nothing was written.",
    apply: "Apply plan",
    disclosure:
      "I understand this creates artificial-history artwork commits and does not push them.",
    confirmation: 'Type "APPLY" to confirm',
    result: "Execution result",
    warnings: "Warnings",
    created: "Project created and ready.",
    saved: "mosaic.json saved.",
    textImported: "Text imported.",
    exported: "SVG exported.",
    planCreated: "Plan created and ready for review.",
    applied: "Commits written. Nothing was pushed.",
    noProjectTitle: "Start with a mosaic",
    noProject:
      "Name it and choose the stretch of time it should cover. It is written to ./output.",
    projectName: "Project name",
    period: "Time span",
    periodRolling: "Last 12 months",
    periodYear: "Calendar year",
    periodCustom: "Custom range",
    year: "Year",
    from: "From",
    to: "To",
    allowFuture: "Allow future-dated commits",
    allowFutureHint:
      "This span runs past today. GitHub only shows those days once the dates arrive.",
    sameAsDrawn:
      "Only one intensity is in use, so the estimate matches the drawing exactly.",
    stepPublish: "Publish",
    stepPublishLocked: "Apply the plan before publishing.",
    publishHint:
      "The only step that leaves your machine. Nothing is pushed until you confirm.",
    repoName: "GitHub repository",
    repoNamePlaceholder: "you/hire-me",
    visibility: "Visibility",
    private: "Private",
    public: "Public",
    checkPush: "Check push",
    push: "Push to GitHub",
    pushConfirm: 'Type "PUSH" to confirm',
    pushed: "Pushed. Contributions appear once GitHub recatalogs the commits.",
    commitsToPush: "Commits to push",
    willCreate: "Creates the repository",
    yes: "Yes",
    no: "No",
    revertHint: "See docs/publishing.md to undo a push.",
    commitMessage: "Commit message",
    messageHint:
      "Placeholders: {date} {index} {total} {intensity} {project} {timestamp}",
    messagePreview: "Every commit will read",
    readme: "README.md",
    includeReadme: "Commit a README.md",
    readmeHint:
      "Committed with the first commit, so the repository is not an empty shell.",
  },
  "pt-BR": {
    title: "Git Mosaic",
    subtitle: "Desenhe, planeje e então faça os commits.",
    language: "Idioma",
    theme: "Alternar modo escuro",
    dismiss: "Dispensar",
    createProject: "Novo mosaico",
    save: "Salvar mosaic.json",
    export: "Exportar SVG",
    unsaved: "Alterações não salvas",
    brush: "Pincel",
    intensity: "Intensidade",
    perDay: "commits/dia",
    perDayOne: "commit/dia",
    zoom: "Zoom",
    zoomIn: "Aproximar",
    zoomOut: "Afastar",
    values: "Valores",
    history: "Histórico",
    undo: "Desfazer",
    redo: "Refazer",
    shortcuts:
      "Ctrl+Z / Ctrl+Shift+Z para desfazer · teclas 0–4 trocam o pincel",
    canvas: "Canvas do mosaico de contribuições",
    previewMode: "Modo da prévia",
    artisticPreview: "Intensidades desenhadas",
    estimatePreview: "Estimativa do GitHub",
    estimated:
      "As cores são uma estimativa por quartis e podem diferir do GitHub.",
    artistic: "As cores correspondem exatamente às intensidades desenhadas.",
    totalCommits: "Commits",
    activeDays: "Dias ativos",
    busiestDay: "Dia mais cheio",
    weeks: "Semanas",
    textImport: "Escrever texto",
    textPlaceholder: "Carregando...",
    importTextButton: "Importar texto",
    textAlign: "Alinhamento do texto",
    alignLeft: "Esquerda",
    alignCenter: "Centro",
    alignRight: "Direita",
    textHint:
      "O texto é gravado nas células do calendário, mantendo os traços nítidos.",
    fit: "Encaixe",
    survives: "Preservado",
    lost: "Perdido",
    remedies: "Soluções",
    pipeline: "Do desenho aos commits",
    stepDesign: "Desenhar",
    stepDesignIdle:
      "Pinte a grade ou importe um texto para preencher o canvas.",
    stepDesignDone: "O canvas tem conteúdo e está pronto para o plano.",
    stepPlan: "Planejar",
    stepPlanHint:
      "Use o email da conta do GitHub que deve receber o crédito. O workspace e o repositório são criados para você.",
    stepReview: "Revisar",
    stepReviewLocked: "Crie um plano para revisá-lo aqui.",
    stepApply: "Aplicar",
    stepApplyLocked: "Rode a simulação antes de aplicar.",
    runDryRun: "Rodar a simulação",
    stepApplyNoPlan: "Crie um plano e simule-o primeiro.",
    authorName: "Nome do autor",
    authorEmail: "Email do autor",
    createPlan: "Criar plano",
    planId: "ID do plano",
    commits: "commits",
    days: "dias",
    repository: "Repositório",
    branch: "Branch",
    dryRun: "Simular",
    dryRunPassed: "Simulação concluída. Nada foi escrito.",
    apply: "Aplicar plano",
    disclosure:
      "Entendo que isto cria commits de histórico artificial como arte e não faz push.",
    confirmation: 'Digite "APPLY" para confirmar',
    result: "Resultado da execução",
    warnings: "Avisos",
    created: "Projeto criado e pronto.",
    saved: "mosaic.json salvo.",
    textImported: "Texto importado.",
    exported: "SVG exportado.",
    planCreated: "Plano criado e pronto para revisão.",
    applied: "Commits criados. Nada foi enviado por push.",
    noProjectTitle: "Comece com um mosaico",
    noProject:
      "Dê um nome e escolha o período que ele deve cobrir. É gravado em ./output.",
    projectName: "Nome do projeto",
    period: "Período",
    periodRolling: "Últimos 12 meses",
    periodYear: "Ano civil",
    periodCustom: "Intervalo personalizado",
    year: "Ano",
    from: "De",
    to: "Até",
    allowFuture: "Permitir commits com data futura",
    allowFutureHint:
      "Este período passa de hoje. O GitHub só mostra esses dias quando as datas chegarem.",
    sameAsDrawn:
      "Apenas uma intensidade está em uso, então a estimativa é igual ao desenho.",
    stepPublish: "Publicar",
    stepPublishLocked: "Aplique o plano antes de publicar.",
    publishHint:
      "O único passo que sai da sua máquina. Nada é enviado até você confirmar.",
    repoName: "Repositório do GitHub",
    repoNamePlaceholder: "voce/hire-me",
    visibility: "Visibilidade",
    private: "Privado",
    public: "Público",
    checkPush: "Verificar envio",
    push: "Enviar ao GitHub",
    pushConfirm: 'Digite "PUSH" para confirmar',
    pushed: "Enviado. As contribuições aparecem quando o GitHub reprocessar.",
    commitsToPush: "Commits a enviar",
    willCreate: "Cria o repositório",
    yes: "Sim",
    no: "Não",
    revertHint: "Veja docs/publishing.md para desfazer um envio.",
    commitMessage: "Mensagem do commit",
    messageHint:
      "Marcadores: {date} {index} {total} {intensity} {project} {timestamp}",
    messagePreview: "Cada commit vai dizer",
    readme: "README.md",
    includeReadme: "Incluir um README.md",
    readmeHint: "Vai no primeiro commit, para o repositório não ficar vazio.",
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

const INTENSITIES: readonly Intensity[] = [0, 1, 2, 3, 4];
const MIN_ZOOM = 0.6;
const MAX_ZOOM = 2;

const levelNumber: Record<ContributionLevel, Intensity> = {
  NONE: 0,
  FIRST_QUARTILE: 1,
  SECOND_QUARTILE: 2,
  THIRD_QUARTILE: 3,
  FOURTH_QUARTILE: 4,
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function utcDate(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

/** Today as YYYY-MM-DD in the given timezone, so "future" means what the planner means. */
function todayIn(timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

interface SetupInput {
  name: string;
  periodMode: PeriodMode;
  year: number;
  from: string;
  to: string;
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

function prefersDark(): boolean {
  return (
    (
      globalThis as { matchMedia?: (query: string) => { matches: boolean } }
    ).matchMedia?.("(prefers-color-scheme: dark)").matches ?? false
  );
}

type StepState = "done" | "active" | "next" | "locked";

function Step({
  index,
  title,
  state,
  children,
}: {
  index: number;
  title: string;
  state: StepState;
  children: ReactNode;
}) {
  return (
    <li className={`step step--${state}`}>
      <div className="step__head">
        <span className="step__badge" aria-hidden="true">
          {state === "done" ? "✓" : state === "locked" ? "🔒" : index}
        </span>
        <h3>{title}</h3>
      </div>
      <div className="step__body">{children}</div>
    </li>
  );
}

export function App({ api }: AppProps) {
  const [language, setLanguage] = useState<Language>("en");
  const t = (key: MessageKey): string => messages[language][key];
  const [theme, setTheme] = useState<Theme>(() =>
    prefersDark() ? "dark" : "light",
  );
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const [projectPath, setProjectPath] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [planResult, setPlanResult] =
    useState<Awaited<ReturnType<WebApi["createPlan"]>>>();
  const [executionResult, setExecutionResult] =
    useState<Awaited<ReturnType<WebApi["dryRun"]>>>();
  const [fitReport, setFitReport] = useState<FitReport>();
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
  const [showValues, setShowValues] = useState(true);
  const [previewMode, setPreviewMode] = useState<PreviewMode>("artistic");
  const [textContent, setTextContent] = useState("Loading...");
  const [textAlign, setTextAlign] = useState<"left" | "center" | "right">(
    "center",
  );
  const [activeCell, setActiveCell] = useState({ row: 0, column: 0 });
  const painting = useRef(false);
  const [message, setMessage] = useState<Message>();
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
  const [messageTemplate, setMessageTemplate] = useState(
    DEFAULT_MESSAGE_TEMPLATE,
  );
  const [includeReadme, setIncludeReadme] = useState(true);
  const [readme, setReadme] = useState("");
  const [publishInput, setPublishInput] = useState<PublishFormInput>({
    repositoryPath: "",
    branch: "main",
    createName: "",
    visibility: "private",
  });
  const [publishReport, setPublishReport] =
    useState<Awaited<ReturnType<WebApi["publish"]>>>();
  const [pushConfirmation, setPushConfirmation] = useState("");
  const [setup, setSetup] = useState<SetupInput>(() => {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const today = todayIn(timezone);
    const year = Number(today.slice(0, 4));
    return {
      name: "mosaic",
      periodMode: "rolling",
      year,
      from: `${year}-01-01`,
      to: today,
    };
  });

  const preview = useMemo(
    () =>
      buildPreviewCalendar(
        editor.project,
        previewMode === "estimate"
          ? new QuartileApproximationStrategy()
          : new ArtisticIntensityStrategy(),
      ),
    [editor.project, previewMode],
  );

  const stats = useMemo(() => {
    const { intensityMap, commitLevelMap } = editor.project;
    const used = new Set<Intensity>();
    let commits = 0;
    let days = 0;
    let busiest = 0;
    preview.cells.forEach((row, rowIndex) =>
      row.forEach((cell, columnIndex) => {
        if (!cell.inRange) return;
        const intensity = intensityMap[rowIndex]?.[columnIndex] ?? 0;
        const count = commitLevelMap[intensity] ?? 0;
        commits += count;
        if (count > 0) {
          days += 1;
          used.add(intensity);
        }
        if (count > busiest) busiest = count;
      }),
    );
    // With a single positive intensity every active day has the same commit
    // count, so quartile ranking cannot separate them: both previews agree.
    return { commits, days, busiest, distinctIntensities: used.size };
  }, [editor.project, preview]);

  const spanEndsInFuture =
    loaded && editor.project.period.to > todayIn(editor.project.timezone);

  const months = useMemo(() => {
    const format = new Intl.DateTimeFormat(language, {
      month: "short",
      timeZone: "UTC",
    });
    const spans: {
      key: string;
      label: string;
      column: number;
      span: number;
    }[] = [];
    for (
      let column = 0;
      column < editor.project.dimensions.columns;
      column += 1
    ) {
      const cell = preview.cells
        .map((row) => row[column])
        .find((candidate) => candidate?.inRange);
      if (cell === undefined) continue;
      const key = cell.date.slice(0, 7);
      const last = spans.at(-1);
      if (last?.key === key) last.span += 1;
      else
        spans.push({
          key,
          label: format.format(utcDate(cell.date)),
          column,
          span: 1,
        });
    }
    return spans;
  }, [preview, editor.project.dimensions.columns, language]);

  const weekdays = useMemo(() => {
    const format = new Intl.DateTimeFormat(language, {
      weekday: "short",
      timeZone: "UTC",
    });
    return preview.cells.map((row) => {
      const cell = row.find((candidate) => candidate.inRange);
      return cell === undefined ? "" : format.format(utcDate(cell.date));
    });
  }, [preview, language]);

  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    try {
      await operation();
    } catch (error) {
      setMessage({ tone: "error", text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  const useProject = (project: MosaicProject, text: string) => {
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
    setReadme(
      defaultReadme(
        project.name,
        `${project.period.from} to ${project.period.to}`,
      ),
    );
    setMessage({ tone: "success", text });
  };

  const provisionProject = async () => {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const managed = await api.createProject({
      name: setup.name.trim() === "" ? "mosaic" : setup.name.trim(),
      timezone,
      periodMode: setup.periodMode,
      ...(setup.periodMode === "year" ? { year: setup.year } : {}),
      ...(setup.periodMode === "custom"
        ? { from: setup.from, to: setup.to }
        : {}),
    });
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

  const createProject = (event?: FormEvent) => {
    event?.preventDefault();
    void run(async () => {
      setFitReport(undefined);
      await provisionProject();
    });
  };

  /** The topbar action abandons the current mosaic and returns to the setup form. */
  const restart = () => {
    setLoaded(false);
    setFitReport(undefined);
    setPlanResult(undefined);
    setExecutionResult(undefined);
    setMessage(undefined);
  };

  const persist = async (targetPath: string) => {
    const saved = await api.saveProject(targetPath, editor.project);
    externalProject.current = saved;
    editor.replaceProject(saved);
    setDirty(false);
    return saved;
  };

  const saveProject = () =>
    run(async () => {
      const saved = await persist(projectPath);
      const written = await saveWithNativeDialog(
        new Blob([`${JSON.stringify(saved, null, 2)}\n`], {
          type: "application/json",
        }),
        "mosaic.json",
        "application/json",
        ".json",
      );
      if (written) setMessage({ tone: "success", text: t("saved") });
    });

  const importText = () =>
    run(async () => {
      const targetPath = loaded
        ? projectPath
        : (await provisionProject()).projectPath;
      const outcome = await api.importText(targetPath, textContent, {
        align: textAlign,
      });
      useProject(outcome.project, t("textImported"));
      setFitReport(outcome.report);
      setZoom(1);
    });

  const exportSvg = () =>
    run(async () => {
      if (dirty) await persist(projectPath);
      const svg = await api.renderSvg(projectPath, {}, previewMode);
      const name = `${editor.project.name.replaceAll(/[^a-z0-9_-]+/gi, "-") || "mosaic"}.svg`;
      const written = await saveWithNativeDialog(
        new Blob([svg], { type: "image/svg+xml" }),
        name,
        "image/svg+xml",
        ".svg",
      );
      if (written) setMessage({ tone: "success", text: t("exported") });
    });

  const paint = (row: number, column: number) => {
    if (!preview.cells[row]?.[column]?.inRange) return;
    setActiveCell({ row, column });
    editor.paint(row, column);
  };

  const cellKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    row: number,
    column: number,
  ) => {
    if (/^[0-4]$/.test(event.key)) {
      event.preventDefault();
      editor.setSelectedIntensity(Number(event.key) as Intensity);
      return;
    }
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
      if (dirty) await persist(targetPath);
      const created = await api.createPlan(targetPath, {
        ...targetInput,
        messageTemplate,
        ...(includeReadme && readme.trim() !== ""
          ? { files: [{ path: "README.md", content: readme }] }
          : {}),
      });
      setPlanResult(created);
      setExecutionResult(undefined);
      setAcknowledged(false);
      setConfirmation("");
      setMessage({ tone: "success", text: t("planCreated") });
    });
  };

  const dryRunPlan = (plan: NonNullable<typeof planResult>) =>
    run(async () => {
      const result = await api.dryRun(
        plan.planPath,
        plan.plan.repository.mode === "existing",
      );
      setExecutionResult(result);
      setMessage({ tone: "info", text: t("dryRunPassed") });
    });

  const applyPlan = (plan: NonNullable<typeof planResult>) =>
    run(async () => {
      const result = await api.apply(plan.planPath, {
        allowExistingRepository: plan.plan.repository.mode === "existing",
      });
      setExecutionResult(result);
      setMessage({ tone: "success", text: t("applied") });
    });

  const checkPush = (confirmed: boolean) =>
    run(async () => {
      const report = await api.publish({
        ...publishInput,
        repositoryPath: planResult?.plan.repository.path ?? "",
        branch: planResult?.plan.repository.branch ?? "main",
        confirmed,
      });
      setPublishReport(report);
      if (report.status === "published") {
        setMessage({ tone: "success", text: t("pushed") });
      }
    });

  const dryRunPassed = executionResult?.status === "dry-run";
  const applied = executionResult?.status === "complete";
  const pushed = publishReport?.status === "published";
  const designed = stats.commits > 0;
  const designState: StepState = designed ? "done" : "active";
  const planState: StepState = planResult
    ? "done"
    : designed
      ? "active"
      : "next";
  const reviewState: StepState = !planResult
    ? "locked"
    : dryRunPassed || applied
      ? "done"
      : "active";
  const applyState: StepState = applied
    ? "done"
    : dryRunPassed
      ? "active"
      : "locked";

  return (
    <div
      className="app"
      onPointerUp={() => (painting.current = false)}
      onPointerCancel={() => (painting.current = false)}
    >
      <header className="topbar">
        <div className="brand">
          <span className="brand__mark" aria-hidden="true">
            <span /> <span /> <span /> <span />
          </span>
          <span className="brand__text">
            <strong>{t("title")}</strong>
            <small>{t("subtitle")}</small>
          </span>
        </div>

        {loaded && (
          <div className="project-chip">
            <strong>{editor.project.name}</strong>
            <span>
              {editor.project.period.from} → {editor.project.period.to}
            </span>
            {dirty && <em title={t("unsaved")}>{t("unsaved")}</em>}
          </div>
        )}

        <div className="topbar__actions">
          {loaded && (
            <>
              <button
                type="button"
                onClick={() => void saveProject()}
                disabled={busy}
              >
                {t("save")}
              </button>
              <button
                type="button"
                onClick={() => void exportSvg()}
                disabled={busy}
              >
                {t("export")}
              </button>
              <button
                type="button"
                className="primary"
                onClick={restart}
                disabled={busy}
              >
                {t("createProject")}
              </button>
            </>
          )}
          <label className="select-inline">
            <span className="sr-only">{t("language")}</span>
            <select
              value={language}
              onChange={(event) => setLanguage(event.target.value as Language)}
            >
              <option value="en">EN</option>
              <option value="pt-BR">PT</option>
            </select>
          </label>
          <button
            type="button"
            className="icon-button"
            aria-label={t("theme")}
            aria-pressed={theme === "dark"}
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            {theme === "dark" ? "☀" : "☾"}
          </button>
        </div>
      </header>

      {message && (
        <div
          className={`alert alert--${message.tone}`}
          role={message.tone === "error" ? "alert" : "status"}
        >
          <span className="alert__icon" aria-hidden="true">
            {message.tone === "error"
              ? "!"
              : message.tone === "success"
                ? "✓"
                : "i"}
          </span>
          <p>{message.text}</p>
          <button
            type="button"
            className="icon-button"
            aria-label={t("dismiss")}
            onClick={() => setMessage(undefined)}
          >
            ✕
          </button>
        </div>
      )}

      <div className="layout">
        <aside className="rail" aria-label={t("brush")}>
          <section className="rail__section">
            <h2>{t("brush")}</h2>
            <div className="palette" role="radiogroup" aria-label={t("brush")}>
              {INTENSITIES.map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  className={`swatch level-${value} ${editor.selectedIntensity === value ? "swatch--selected" : ""}`}
                  aria-checked={editor.selectedIntensity === value}
                  aria-label={`${t("intensity")} ${value}`}
                  onClick={() => editor.setSelectedIntensity(value)}
                >
                  <span className="swatch__chip" aria-hidden="true">
                    {value}
                  </span>
                  <span className="swatch__meta" aria-hidden="true">
                    {editor.project.commitLevelMap[value]}{" "}
                    {editor.project.commitLevelMap[value] === 1
                      ? t("perDayOne")
                      : t("perDay")}
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section className="rail__section">
            <h2>{t("history")}</h2>
            <div className="button-row">
              <button
                type="button"
                onClick={editor.undo}
                disabled={!editor.canUndo}
              >
                <span aria-hidden="true">↺</span>
                {t("undo")}
              </button>
              <button
                type="button"
                onClick={editor.redo}
                disabled={!editor.canRedo}
              >
                <span aria-hidden="true">↻</span>
                {t("redo")}
              </button>
            </div>
            <p className="hint">{t("shortcuts")}</p>
          </section>

          <section className="rail__section">
            <h2>{t("textImport")}</h2>
            <form
              className="stack"
              onSubmit={(event) => {
                event.preventDefault();
                void importText();
              }}
            >
              <label>
                <span className="sr-only">{t("textImport")}</span>
                <input
                  required
                  maxLength={200}
                  aria-label={t("textImport")}
                  value={textContent}
                  placeholder={t("textPlaceholder")}
                  onChange={(event) => setTextContent(event.target.value)}
                />
              </label>
              <label>
                {t("textAlign")}
                <select
                  value={textAlign}
                  onChange={(event) =>
                    setTextAlign(
                      event.target.value as "left" | "center" | "right",
                    )
                  }
                >
                  <option value="left">{t("alignLeft")}</option>
                  <option value="center">{t("alignCenter")}</option>
                  <option value="right">{t("alignRight")}</option>
                </select>
              </label>
              <button type="submit" disabled={busy}>
                {t("importTextButton")}
              </button>
              {fitReport === undefined ? (
                <p className="hint">{t("textHint")}</p>
              ) : (
                <div className={`fit fit--${fitReport.verdict}`}>
                  <p>
                    <strong>{t("fit")}</strong>
                    <span className="fit__verdict">{fitReport.verdict}</span>
                  </p>
                  {fitReport.lost.length > 0 && (
                    <p>
                      <em>{t("lost")}:</em> {fitReport.lost.join(", ")}
                    </p>
                  )}
                  {fitReport.remedies.length > 0 && (
                    <ul>
                      {fitReport.remedies.map((remedy) => (
                        <li key={remedy}>{remedy}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </form>
          </section>
        </aside>

        <main className="canvas">
          <div className="canvas__toolbar">
            <div
              className="segmented"
              role="group"
              aria-label={t("previewMode")}
            >
              <button
                type="button"
                className={previewMode === "artistic" ? "selected" : ""}
                aria-pressed={previewMode === "artistic"}
                onClick={() => setPreviewMode("artistic")}
              >
                {t("artisticPreview")}
              </button>
              <button
                type="button"
                className={previewMode === "estimate" ? "selected" : ""}
                aria-pressed={previewMode === "estimate"}
                onClick={() => setPreviewMode("estimate")}
              >
                {t("estimatePreview")}
              </button>
            </div>

            <div className="canvas__tools">
              <button
                type="button"
                className={`chip ${showValues ? "selected" : ""}`}
                aria-pressed={showValues}
                onClick={() => setShowValues(!showValues)}
              >
                {t("values")}
              </button>
              <div className="zoom" role="group" aria-label={t("zoom")}>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={t("zoomOut")}
                  disabled={zoom <= MIN_ZOOM}
                  onClick={() =>
                    setZoom((value) => Math.max(MIN_ZOOM, value - 0.2))
                  }
                >
                  −
                </button>
                <output>{Math.round(zoom * 100)}%</output>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={t("zoomIn")}
                  disabled={zoom >= MAX_ZOOM}
                  onClick={() =>
                    setZoom((value) => Math.min(MAX_ZOOM, value + 0.2))
                  }
                >
                  +
                </button>
              </div>
            </div>
          </div>

          <p className="canvas__caption">
            {previewMode === "estimate" ? t("estimated") : t("artistic")}
            {previewMode === "estimate" &&
              loaded &&
              stats.distinctIntensities === 1 && <> {t("sameAsDrawn")}</>}
          </p>

          {loaded ? (
            <>
              <div className="canvas__scroller">
                <div
                  className="calendar"
                  style={
                    {
                      "--columns": editor.project.dimensions.columns,
                      "--zoom": zoom,
                    } as CSSProperties
                  }
                >
                  <div className="calendar__corner" aria-hidden="true" />
                  <div className="calendar__months" aria-hidden="true">
                    {months.map((month) => (
                      <span
                        key={month.key}
                        style={{
                          gridColumn: `${month.column + 1} / span ${month.span}`,
                        }}
                      >
                        {month.label}
                      </span>
                    ))}
                  </div>
                  <div className="calendar__weekdays" aria-hidden="true">
                    {weekdays.map((weekday, index) => (
                      <span key={`weekday-${index}`}>
                        {index % 2 === 1 ? weekday : ""}
                      </span>
                    ))}
                  </div>
                  <div
                    className="mosaic-grid"
                    role="grid"
                    aria-label={t("canvas")}
                    aria-rowcount={7}
                    aria-colcount={editor.project.dimensions.columns}
                  >
                    {preview.cells.map((row, rowIndex) =>
                      row.map((cell, columnIndex) => {
                        const intensity = levelNumber[cell.level];
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
                            aria-disabled={!cell.inRange}
                            disabled={!cell.inRange}
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
                              cellKeyDown(event, rowIndex, columnIndex)
                            }
                          >
                            {showValues && cell.inRange && intensity > 0 && (
                              <span>{intensity}</span>
                            )}
                          </button>
                        );
                      }),
                    )}
                  </div>
                </div>
              </div>

              <dl className="stats">
                <div>
                  <dt>{t("totalCommits")}</dt>
                  <dd>{stats.commits}</dd>
                </div>
                <div>
                  <dt>{t("activeDays")}</dt>
                  <dd>{stats.days}</dd>
                </div>
                <div>
                  <dt>{t("busiestDay")}</dt>
                  <dd>{stats.busiest}</dd>
                </div>
                <div>
                  <dt>{t("weeks")}</dt>
                  <dd>{editor.project.dimensions.columns}</dd>
                </div>
              </dl>
            </>
          ) : (
            <div className="empty">
              <div className="empty__grid" aria-hidden="true">
                {Array.from({ length: 7 * 20 }, (_, index) => (
                  <span key={index} data-level={(index * 7) % 5} />
                ))}
              </div>
              <h2>{t("noProjectTitle")}</h2>
              <p>{t("noProject")}</p>

              <form className="setup" onSubmit={createProject}>
                <label className="setup__name">
                  {t("projectName")}
                  <input
                    required
                    maxLength={60}
                    value={setup.name}
                    onChange={(event) =>
                      setSetup({ ...setup, name: event.target.value })
                    }
                  />
                </label>

                <label>
                  {t("period")}
                  <select
                    value={setup.periodMode}
                    onChange={(event) =>
                      setSetup({
                        ...setup,
                        periodMode: event.target.value as PeriodMode,
                      })
                    }
                  >
                    <option value="rolling">{t("periodRolling")}</option>
                    <option value="year">{t("periodYear")}</option>
                    <option value="custom">{t("periodCustom")}</option>
                  </select>
                </label>

                {setup.periodMode === "year" && (
                  <label>
                    {t("year")}
                    <input
                      required
                      type="number"
                      min={1970}
                      max={2100}
                      value={setup.year}
                      onChange={(event) =>
                        setSetup({ ...setup, year: Number(event.target.value) })
                      }
                    />
                  </label>
                )}

                {setup.periodMode === "custom" && (
                  <>
                    <label>
                      {t("from")}
                      <input
                        required
                        type="date"
                        value={setup.from}
                        onChange={(event) =>
                          setSetup({ ...setup, from: event.target.value })
                        }
                      />
                    </label>
                    <label>
                      {t("to")}
                      <input
                        required
                        type="date"
                        value={setup.to}
                        onChange={(event) =>
                          setSetup({ ...setup, to: event.target.value })
                        }
                      />
                    </label>
                  </>
                )}

                <button type="submit" className="primary" disabled={busy}>
                  {t("createProject")}
                </button>
              </form>
            </div>
          )}
        </main>

        <aside className="pipeline" aria-label={t("pipeline")}>
          <h2>{t("pipeline")}</h2>
          <ol className="steps">
            <Step index={1} title={t("stepDesign")} state={designState}>
              <p className="hint">
                {designState === "done"
                  ? t("stepDesignDone")
                  : t("stepDesignIdle")}
              </p>
              {designState === "done" && (
                <p className="summary-line">
                  <strong>{stats.commits}</strong> {t("commits")} ·{" "}
                  <strong>{stats.days}</strong> {t("days")}
                </p>
              )}
            </Step>

            <Step index={2} title={t("stepPlan")} state={planState}>
              <form className="stack" onSubmit={submitPlan}>
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
                {spanEndsInFuture && (
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={planInput.allowFuture === true}
                      onChange={(event) =>
                        setPlanInput({
                          ...planInput,
                          allowFuture: event.target.checked,
                        })
                      }
                    />
                    <span>
                      {t("allowFuture")}
                      <small className="hint">{t("allowFutureHint")}</small>
                    </span>
                  </label>
                )}
                <label>
                  {t("commitMessage")}
                  <input
                    required
                    className="mono"
                    value={messageTemplate}
                    onChange={(event) => setMessageTemplate(event.target.value)}
                  />
                </label>
                <p className="hint">{t("messageHint")}</p>
                <p className="message-preview">
                  <span>{t("messagePreview")}</span>
                  <code>
                    {previewCommitMessage(
                      messageTemplate === "" ? " " : messageTemplate,
                      {
                        project: loaded ? editor.project.name : "my-mosaic",
                        total: stats.commits,
                      },
                    )}
                  </code>
                </p>

                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={includeReadme}
                    onChange={(event) => setIncludeReadme(event.target.checked)}
                  />
                  <span>{t("includeReadme")}</span>
                </label>
                {includeReadme && (
                  <>
                    <label>
                      <span className="sr-only">{t("readme")}</span>
                      <textarea
                        aria-label={t("readme")}
                        className="mono"
                        rows={6}
                        value={readme}
                        onChange={(event) => setReadme(event.target.value)}
                      />
                    </label>
                    <p className="hint">{t("readmeHint")}</p>
                  </>
                )}

                <p className="hint">{t("stepPlanHint")}</p>
                <button type="submit" className="primary" disabled={busy}>
                  {t("createPlan")}
                </button>
              </form>
            </Step>

            <Step index={3} title={t("stepReview")} state={reviewState}>
              {planResult === undefined ? (
                <p className="hint">{t("stepReviewLocked")}</p>
              ) : (
                <>
                  <dl className="facts">
                    <div>
                      <dt>{t("planId")}</dt>
                      <dd className="mono">{planResult.plan.planId}</dd>
                    </div>
                    <div>
                      <dt>{t("commits")}</dt>
                      <dd>{planResult.plan.totals.commits}</dd>
                    </div>
                    <div>
                      <dt>{t("days")}</dt>
                      <dd>{planResult.plan.totals.days}</dd>
                    </div>
                    <div>
                      <dt>{t("branch")}</dt>
                      <dd className="mono">
                        {planResult.plan.repository.branch}
                      </dd>
                    </div>
                    <div className="facts__wide">
                      <dt>{t("repository")}</dt>
                      <dd className="mono">
                        {planResult.plan.repository.path}
                      </dd>
                    </div>
                  </dl>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void dryRunPlan(planResult)}
                  >
                    {t("dryRun")}
                  </button>
                </>
              )}
            </Step>

            <Step index={4} title={t("stepApply")} state={applyState}>
              {planResult === undefined ? (
                <p className="hint">{t("stepApplyNoPlan")}</p>
              ) : !dryRunPassed && !applied ? (
                // A locked step offers the action that unlocks it, never a form
                // that cannot submit.
                <>
                  <p className="hint">{t("stepApplyLocked")}</p>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void dryRunPlan(planResult)}
                  >
                    {t("runDryRun")}
                  </button>
                </>
              ) : (
                <div className="danger-zone">
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={acknowledged}
                      onChange={(event) =>
                        setAcknowledged(event.target.checked)
                      }
                    />
                    <span>{t("disclosure")}</span>
                  </label>
                  <label>
                    {t("confirmation")}
                    <input
                      className="mono"
                      value={confirmation}
                      onChange={(event) => setConfirmation(event.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    className="danger"
                    disabled={
                      busy ||
                      !acknowledged ||
                      confirmation !== "APPLY" ||
                      applied
                    }
                    onClick={() => void applyPlan(planResult)}
                  >
                    {t("apply")}
                  </button>
                </div>
              )}
            </Step>
            <Step
              index={5}
              title={t("stepPublish")}
              state={pushed ? "done" : applied ? "active" : "locked"}
            >
              {!applied ? (
                <p className="hint">{t("stepPublishLocked")}</p>
              ) : (
                <div className="publish">
                  <p className="hint">{t("publishHint")}</p>
                  <label>
                    {t("repoName")}
                    <input
                      className="mono"
                      placeholder={t("repoNamePlaceholder")}
                      value={publishInput.createName ?? ""}
                      onChange={(event) =>
                        setPublishInput({
                          ...publishInput,
                          createName: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    {t("visibility")}
                    <select
                      value={publishInput.visibility ?? "private"}
                      onChange={(event) =>
                        setPublishInput({
                          ...publishInput,
                          visibility: event.target.value as
                            "public" | "private",
                        })
                      }
                    >
                      <option value="private">{t("private")}</option>
                      <option value="public">{t("public")}</option>
                    </select>
                  </label>

                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void checkPush(false)}
                  >
                    {t("checkPush")}
                  </button>

                  {publishReport && (
                    <dl className="facts">
                      <div>
                        <dt>{t("commitsToPush")}</dt>
                        <dd>{publishReport.commitsToPush}</dd>
                      </div>
                      <div>
                        <dt>{t("willCreate")}</dt>
                        <dd>
                          {publishReport.willCreateRepository
                            ? t("yes")
                            : t("no")}
                        </dd>
                      </div>
                    </dl>
                  )}

                  {publishReport && !pushed && (
                    <div className="danger-zone">
                      <label>
                        {t("pushConfirm")}
                        <input
                          className="mono"
                          value={pushConfirmation}
                          onChange={(event) =>
                            setPushConfirmation(event.target.value)
                          }
                        />
                      </label>
                      <button
                        type="button"
                        className="danger"
                        disabled={busy || pushConfirmation !== "PUSH"}
                        onClick={() => void checkPush(true)}
                      >
                        {t("push")}
                      </button>
                    </div>
                  )}

                  {pushed && (
                    <p className="summary-line">
                      <strong>{publishReport?.remoteUrl}</strong>
                      <br />
                      <span className="hint">{t("revertHint")}</span>
                    </p>
                  )}
                </div>
              )}
            </Step>
          </ol>

          {executionResult && (
            <div className="result" role="status">
              <h3>{t("result")}</h3>
              <p>
                <strong>{executionResult.status}</strong> ·{" "}
                {executionResult.createdCommits} {t("commits")} ·{" "}
                {executionResult.applicationState}
              </p>
              {executionResult.warnings.length > 0 && (
                <>
                  <h4>{t("warnings")}</h4>
                  <ul>
                    {executionResult.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
