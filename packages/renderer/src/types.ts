export type PreviewTheme = "light" | "dark";

export interface RenderOptions {
  theme?: PreviewTheme;
  showMonths?: boolean;
  showWeekdays?: boolean;
  showLegend?: boolean;
  cellSize?: number;
  cellGap?: number;
  color?: boolean;
}

export interface RenderResult {
  content: string;
  mediaType: "text/plain" | "image/svg+xml";
}

export interface PreviewRenderer<
  TOptions extends RenderOptions = RenderOptions,
> {
  render(options?: TOptions): RenderResult;
}
