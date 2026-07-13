// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Intensity, MosaicProject } from "@git-mosaic/schemas";

import {
  handleMosaicEditorKeyboardShortcut,
  type MosaicEditorKeyboardEvent,
  useMosaicEditor,
} from "./useMosaicEditor.js";

interface KeyboardEventOptions {
  key: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  cancelable?: boolean;
}

interface TestBrowser {
  document: { dispatchEvent(event: MosaicEditorKeyboardEvent): boolean };
  KeyboardEvent: new (
    type: string,
    options: KeyboardEventOptions,
  ) => MosaicEditorKeyboardEvent & { readonly defaultPrevented: boolean };
}

function browser(): TestBrowser {
  return globalThis as unknown as TestBrowser;
}

function keydown(options: KeyboardEventOptions) {
  const BrowserKeyboardEvent = browser().KeyboardEvent;
  return new BrowserKeyboardEvent("keydown", options);
}

function project(
  name = "editor",
  intensityMap: Intensity[][] = Array.from({ length: 7 }, () => [0, 0]),
): MosaicProject {
  return {
    schemaVersion: 1,
    name,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    period: { from: "2026-01-01", to: "2026-01-10" },
    timezone: "UTC",
    weekStartsOn: 0,
    dimensions: { rows: 7, columns: 2 },
    source: { type: "empty" },
    intensityMap,
    commitLevelMap: { 0: 0, 1: 1, 2: 4, 3: 10, 4: 20 },
  };
}

describe("useMosaicEditor", () => {
  it("paints valid cells immutably and reports the change", () => {
    const initial = project();
    const originalMap = initial.intensityMap.map((row) => [...row]);
    const onChange = vi.fn();
    const { result } = renderHook(() => useMosaicEditor(initial, onChange));

    act(() => {
      result.current.setSelectedIntensity(4);
      result.current.paint(4, 0); // 2026-01-01
    });

    expect(result.current.project).not.toBe(initial);
    expect(result.current.project.intensityMap[4]?.[0]).toBe(4);
    expect(initial.intensityMap).toEqual(originalMap);
    expect(result.current.canUndo).toBe(true);
    expect(onChange).toHaveBeenLastCalledWith(result.current.project);
  });

  it("ignores out-of-range, invalid, and no-op paint operations", () => {
    const initial = project();
    const { result } = renderHook(() => useMosaicEditor(initial));

    act(() => {
      result.current.paint(0, 0); // 2025-12-28, outside the period
      result.current.paint(-1, 0);
      result.current.paint(4, 99);
      result.current.paint(4, 0); // selected intensity starts at 1
      result.current.paint(4, 0); // no-op at the same intensity
    });

    expect(result.current.project.intensityMap[0]?.[0]).toBe(0);
    expect(result.current.project.intensityMap[4]?.[0]).toBe(1);
    act(() => result.current.undo());
    expect(result.current.project).toBe(initial);
    expect(result.current.canUndo).toBe(false);
  });

  it("undoes, redoes, and clears redo after a new paint", () => {
    const { result } = renderHook(() => useMosaicEditor(project()));

    act(() => result.current.paint(4, 0));
    act(() => {
      result.current.setSelectedIntensity(3);
      result.current.paint(0, 1); // 2026-01-04
    });
    expect(result.current.project.intensityMap[0]?.[1]).toBe(3);

    act(() => result.current.undo());
    expect(result.current.project.intensityMap[0]?.[1]).toBe(0);
    expect(result.current.canRedo).toBe(true);
    act(() => result.current.redo());
    expect(result.current.project.intensityMap[0]?.[1]).toBe(3);

    act(() => result.current.undo());
    act(() => {
      result.current.setSelectedIntensity(2);
      result.current.paint(1, 1);
    });
    expect(result.current.canRedo).toBe(false);
  });

  it("replaces the project and resets both history stacks", () => {
    const { result } = renderHook(() => useMosaicEditor(project()));
    act(() => result.current.paint(4, 0));
    act(() => result.current.undo());
    expect(result.current.canRedo).toBe(true);

    const replacement = project("replacement");
    act(() => result.current.replaceProject(replacement));

    expect(result.current.project).toBe(replacement);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
    act(() => {
      result.current.undo();
      result.current.redo();
    });
    expect(result.current.project).toBe(replacement);
  });

  it("keeps selected intensity within zero through four", () => {
    const { result } = renderHook(() => useMosaicEditor(project()));
    act(() => result.current.setSelectedIntensity(0));
    expect(result.current.selectedIntensity).toBe(0);
    act(() => result.current.setSelectedIntensity(9 as Intensity));
    expect(result.current.selectedIntensity).toBe(0);
  });

  it("handles Ctrl/Cmd+Z and Shift+Ctrl/Cmd+Z through the document effect", () => {
    const { result, unmount } = renderHook(() => useMosaicEditor(project()));
    act(() => result.current.paint(4, 0));

    act(() =>
      browser().document.dispatchEvent(keydown({ key: "z", ctrlKey: true })),
    );
    expect(result.current.project.intensityMap[4]?.[0]).toBe(0);

    act(() =>
      browser().document.dispatchEvent(
        keydown({
          key: "Z",
          metaKey: true,
          shiftKey: true,
        }),
      ),
    );
    expect(result.current.project.intensityMap[4]?.[0]).toBe(1);

    const input = document.createElement("input");
    document.body.append(input);
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "z",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(result.current.project.intensityMap[4]?.[0]).toBe(1);
    input.remove();

    unmount();
    browser().document.dispatchEvent(keydown({ key: "z", ctrlKey: true }));
  });
});

describe("handleMosaicEditorKeyboardShortcut", () => {
  it("prevents handled events and ignores unrelated keys", () => {
    const actions = { undo: vi.fn(), redo: vi.fn() };
    const undoEvent = keydown({
      key: "z",
      ctrlKey: true,
      cancelable: true,
    });
    expect(handleMosaicEditorKeyboardShortcut(undoEvent, actions)).toBe(true);
    expect(undoEvent.defaultPrevented).toBe(true);
    expect(actions.undo).toHaveBeenCalledOnce();

    const unrelated = keydown({
      key: "z",
      altKey: true,
      ctrlKey: true,
    });
    expect(handleMosaicEditorKeyboardShortcut(unrelated, actions)).toBe(false);
    expect(actions.redo).not.toHaveBeenCalled();
  });
});
