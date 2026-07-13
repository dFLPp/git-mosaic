export type LogLevel = "silent" | "error" | "warn" | "info" | "debug" | "trace";

const priorities: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
  trace: 5,
};

export interface Logger {
  error(message: string): void;
  warn(message: string): void;
  info(message: string): void;
  debug(message: string): void;
  trace(message: string): void;
}

export function createLogger(level: LogLevel = "info"): Logger {
  const emit = (
    messageLevel: Exclude<LogLevel, "silent">,
    message: string,
  ): void => {
    if (priorities[level] < priorities[messageLevel]) return;
    const output =
      messageLevel === "error" || messageLevel === "warn"
        ? process.stderr
        : process.stdout;
    output.write(`${message}\n`);
  };

  return {
    error: (message) => emit("error", message),
    warn: (message) => emit("warn", message),
    info: (message) => emit("info", message),
    debug: (message) => emit("debug", message),
    trace: (message) => emit("trace", message),
  };
}
