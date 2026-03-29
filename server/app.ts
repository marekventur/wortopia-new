import "react-router";
import { createRequestHandler } from "@react-router/express";
import express from "express";
import { getDb } from "../lib/db.js";
import { startWordSyncScheduler } from "../lib/wordSync.js";

declare module "react-router" {
  interface AppLoadContext {
    db: ReturnType<typeof getDb>;
  }
}

export const app = express();

startWordSyncScheduler();

app.use(
  createRequestHandler({
    build: () => import("virtual:react-router/server-build"),
    getLoadContext() {
      return {
        db: getDb(),
      };
    },
  })
);
