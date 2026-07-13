import type { RequestListener, Server as HttpServer } from "node:http";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin, type ViteDevServer } from "vite";

const root = fileURLToPath(new URL("../..", import.meta.url));
const source = (relativePath: string) => `${root}/${relativePath}`;

function localApiPlugin(): Plugin {
  let apiHandler: RequestListener | undefined;
  let viteServer: ViteDevServer | undefined;

  const loadApi = async () => {
    if (viteServer === undefined) return;
    const module = (await viteServer.ssrLoadModule("/src/server.ts")) as {
      createLocalServer(options?: {
        allowedOrigins?: readonly string[];
      }): HttpServer;
    };
    const localServer = module.createLocalServer();
    const handler = localServer.listeners("request")[0];
    if (typeof handler !== "function") {
      throw new Error("Local API did not provide a request handler");
    }
    apiHandler = handler as RequestListener;
  };

  return {
    name: "git-mosaic-local-api",
    async configureServer(server) {
      viteServer = server;
      await loadApi();
      server.middlewares.use((request, response, next) => {
        if (!request.url?.startsWith("/api/")) {
          next();
          return;
        }
        if (apiHandler === undefined) {
          response.statusCode = 503;
          response.end("Local API is reloading");
          return;
        }
        apiHandler(request, response);
      });
    },
    async handleHotUpdate(context) {
      const isBackendChange =
        context.file.endsWith("/apps/web/src/server.ts") ||
        context.file.includes("/packages/");
      if (isBackendChange) {
        await loadApi();
        context.server.ws.send({ type: "full-reload" });
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), localApiPlugin()],
  resolve: {
    alias: [
      {
        find: "@git-mosaic/core/preview",
        replacement: source("packages/core/src/preview.ts"),
      },
      {
        find: "@git-mosaic/calendar",
        replacement: source("packages/calendar/src/index.ts"),
      },
      {
        find: "@git-mosaic/core",
        replacement: source("packages/core/src/index.ts"),
      },
      {
        find: "@git-mosaic/git",
        replacement: source("packages/git/src/index.ts"),
      },
      {
        find: "@git-mosaic/github",
        replacement: source("packages/github/src/index.ts"),
      },
      {
        find: "@git-mosaic/image",
        replacement: source("packages/image/src/index.ts"),
      },
      {
        find: "@git-mosaic/renderer",
        replacement: source("packages/renderer/src/index.ts"),
      },
      {
        find: "@git-mosaic/schemas",
        replacement: source("packages/schemas/src/index.ts"),
      },
    ],
  },
  build: { outDir: "dist/public", emptyOutDir: true },
  server: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
  },
});
