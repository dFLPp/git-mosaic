import { useEffect, useReducer, useRef } from "react";

import { buildCalendar } from "@git-mosaic/calendar";
import type { Intensity, MosaicProject } from "@git-mosaic/schemas";

import type { MosaicEditorState } from "./contracts.js";

interface EditorHistory {
  project: MosaicProject;
  selectedIntensity: Intensity;
  past: MosaicProject[];
  future: MosaicProject[];
}

type EditorAction =
  | { type: "set-intensity"; value: Intensity }
  | { type: "paint"; row: number; column: number }
  | { type: "replace-project"; project: MosaicProject }
  | { type: "undo" }
  | { type: "redo" };

export interface MosaicEditorKeyboardActions {
  undo(): void;
  redo(): void;
}

export interface MosaicEditorKeyboardEvent {
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly key: string;
  readonly target?: EventTarget | null;
  preventDefault(): void;
}

interface KeyboardDocument {
  addEventListener(
    type: "keydown",
    listener: (event: MosaicEditorKeyboardEvent) => void,
  ): void;
  removeEventListener(
    type: "keydown",
    listener: (event: MosaicEditorKeyboardEvent) => void,
  ): void;
}

function getKeyboardDocument(): KeyboardDocument | undefined {
  return (globalThis as { document?: KeyboardDocument }).document;
}

function isIntensity(value: number): value is Intensity {
  return Number.isInteger(value) && value >= 0 && value <= 4;
}

function reducer(state: EditorHistory, action: EditorAction): EditorHistory {
  switch (action.type) {
    case "set-intensity":
      return isIntensity(action.value)
        ? { ...state, selectedIntensity: action.value }
        : state;

    case "paint": {
      if (!Number.isInteger(action.row) || !Number.isInteger(action.column)) {
        return state;
      }
      const calendar = buildCalendar(
        state.project.period,
        state.project.timezone,
      );
      const cell = calendar.cells[action.row]?.[action.column];
      const currentRow = state.project.intensityMap[action.row];
      if (
        cell?.inRange !== true ||
        currentRow === undefined ||
        currentRow[action.column] === undefined ||
        currentRow[action.column] === state.selectedIntensity
      ) {
        return state;
      }

      const intensityMap = state.project.intensityMap.map((row, rowIndex) =>
        rowIndex === action.row
          ? row.map((value, columnIndex) =>
              columnIndex === action.column ? state.selectedIntensity : value,
            )
          : row,
      );
      const project: MosaicProject = { ...state.project, intensityMap };
      return {
        ...state,
        project,
        past: [...state.past, state.project],
        future: [],
      };
    }

    case "replace-project":
      return {
        ...state,
        project: action.project,
        past: [],
        future: [],
      };

    case "undo": {
      const project = state.past.at(-1);
      if (project === undefined) return state;
      return {
        ...state,
        project,
        past: state.past.slice(0, -1),
        future: [state.project, ...state.future],
      };
    }

    case "redo": {
      const project = state.future[0];
      if (project === undefined) return state;
      return {
        ...state,
        project,
        past: [...state.past, state.project],
        future: state.future.slice(1),
      };
    }
  }
}

export function handleMosaicEditorKeyboardShortcut(
  event: MosaicEditorKeyboardEvent,
  actions: MosaicEditorKeyboardActions,
): boolean {
  const target = event.target as
    | (EventTarget & { tagName?: string; isContentEditable?: boolean })
    | null
    | undefined;
  const tagName = target?.tagName?.toUpperCase();
  if (
    event.altKey ||
    target?.isContentEditable === true ||
    tagName === "INPUT" ||
    tagName === "TEXTAREA" ||
    tagName === "SELECT" ||
    (!event.ctrlKey && !event.metaKey) ||
    event.key.toLowerCase() !== "z"
  ) {
    return false;
  }

  event.preventDefault();
  if (event.shiftKey) actions.redo();
  else actions.undo();
  return true;
}

export function useMosaicEditor(
  initialProject: MosaicProject,
  onChange?: (project: MosaicProject) => void,
): MosaicEditorState {
  const [state, dispatch] = useReducer(reducer, {
    project: initialProject,
    selectedIntensity: 1,
    past: [],
    future: [],
  });
  const onChangeRef = useRef(onChange);
  const reportedProjectRef = useRef(initialProject);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (reportedProjectRef.current === state.project) return;
    reportedProjectRef.current = state.project;
    onChangeRef.current?.(state.project);
  }, [state.project]);

  useEffect(() => {
    const keyboardDocument = getKeyboardDocument();
    if (keyboardDocument === undefined) return;
    const listener = (event: MosaicEditorKeyboardEvent) => {
      handleMosaicEditorKeyboardShortcut(event, {
        undo: () => dispatch({ type: "undo" }),
        redo: () => dispatch({ type: "redo" }),
      });
    };
    keyboardDocument.addEventListener("keydown", listener);
    return () => keyboardDocument.removeEventListener("keydown", listener);
  }, []);

  return {
    project: state.project,
    selectedIntensity: state.selectedIntensity,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    setSelectedIntensity: (value) => dispatch({ type: "set-intensity", value }),
    paint: (row, column) => dispatch({ type: "paint", row, column }),
    replaceProject: (project) => dispatch({ type: "replace-project", project }),
    undo: () => dispatch({ type: "undo" }),
    redo: () => dispatch({ type: "redo" }),
  };
}
