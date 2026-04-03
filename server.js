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

  // Mount WebSocket servers in dev (load via vite to get TS support)
  const gameSource = await viteDevServer.ssrLoadModule("./lib/gameWsServer.ts");
  const { getGameServer } = await viteDevServer.ssrLoadModule("./lib/gameServer.ts");
  const gameServer = getGameServer();
  await gameServer.init();
  const gameWssMap = gameSource.createGameWsServer();

  mountWsRouter(httpServer, gameWssMap);
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

  const { getGameServer } = await import("./lib/gameServer.js");
  const { createGameWsServer } = await import("./lib/gameWsServer.js");
  const gameServer = getGameServer();
  await gameServer.init();
  const gameWssMap = createGameWsServer();

  mountWsRouter(httpServer, gameWssMap);
}

/**
 * Central WebSocket upgrade router.
 *
 * Multiple WebSocketServer instances with path-matching all register upgrade
 * listeners and send 400 for non-matching paths, clobbering each other.
 * The fix: use noServer:true everywhere and route manually here.
 */
/**
 * @param {import("http").Server} server
 * @param {Map<string, import("ws").WebSocketServer>} gameWssMap
 */
function mountWsRouter(server, gameWssMap) {
  server.on("upgrade", (/** @type {import("http").IncomingMessage} */ req, /** @type {import("stream").Duplex} */ socket, /** @type {Buffer} */ head) => {
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;

    const gameWss = gameWssMap.get(pathname);
    if (gameWss) {
      gameWss.handleUpgrade(req, socket, head, (/** @type {import("ws").WebSocket} */ ws) => {
        gameWss.emit("connection", ws, req);
      });
      return;
    }

    // Unknown path — let Vite's HMR handler claim it (it registered first)
    // Do not destroy — Vite's own upgrade listener handles /@vite/hmr etc.
  });
}

httpServer.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
