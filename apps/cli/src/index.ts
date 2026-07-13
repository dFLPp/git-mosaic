#!/usr/bin/env node

import { createLogger, isGitMosaicError } from "@git-mosaic/core";
import { createProgram } from "./program.js";

async function main(): Promise<void> {
  try {
    await createProgram().parseAsync(process.argv);
  } catch (error) {
    const logger = createLogger("error");
    if (isGitMosaicError(error)) {
      logger.error(error.format());
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}

await main();
