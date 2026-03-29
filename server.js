import { config as loadEnv } from "dotenv";

// Load .env, then .env.local, then .env.<NODE_ENV>.local (later files win)
loadEnv();
loadEnv({ path: ".env.local", override: true });
loadEnv({ path: `.env.${process.env.NODE_ENV ?? "development"}.local`, override: true });

import http from "http";
import compression from "compression";
import express from "express";
import morgan from "morgan";

const BUILD_PATH = "./build/server/index.js";
const DEVELOPMENT = process.env.NODE_ENV === "development";
const PORT = Number.parseInt(process.env.PORT || "3000", 10);

const app = express();
const httpServer = http.createServer(app);

app.use(compression());
app.disable("x-powered-by");

if (DEVELOPMENT) {
  console.log("Starting development server");
  const vite = await import("vite");
  const viteDevServer = await vite.createServer({
    server: {
      middlewareMode: true,
      hmr: { server: httpServer },
    },
  });
  app.use(viteDevServer.middlewares);
  app.use(async (req, res, next) => {
    try {
      const source = await viteDevServer.ssrLoadModule("./server/app.ts");
      await source.app(req, res, next);
    } catch (error) {
      if (typeof error === "object" && error instanceof Error) {
        viteDevServer.ssrFixStacktrace(error);
      }
      next(error);
    }
  });

  // Mount WebSocket server in dev (load via vite to get TS support)
  const chatSource = await viteDevServer.ssrLoadModule("./lib/chatServer.ts");
  chatSource.createChatServer(httpServer);
} else {
  console.log("Starting production server");
  app.use(
    "/assets",
    express.static("build/client/assets", { immutable: true, maxAge: "1y" })
  );
  app.use(morgan("tiny"));
  app.use(express.static("build/client", { maxAge: "1h" }));
  const mod = await import(BUILD_PATH);
  app.use(mod.app);

  const { createChatServer } = await import("./lib/chatServer.js");
  createChatServer(httpServer);
}

httpServer.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
