# Default App Template

Starter template: **Node.js**, **React Router v7** (framework mode), **Express**, **Tailwind CSS**, **DaisyUI**, **SQLite**, **TypeScript**, **PM2**.

## Quick start

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Scripts

| Script          | Description                    |
|----------------|--------------------------------|
| `npm run dev`  | Dev server (Vite HMR + Express)|
| `npm run build`| Production build               |
| `npm run start`| Run production server          |
| `npm run typecheck` | Type check + route types  |
| `npm run pm2:start`  | Start with PM2 (after build) |
| `npm run pm2:stop`   | Stop PM2 process              |
| `npm run pm2:restart`| Restart PM2 process           |

## VPS deployment

**Using the deploy scripts (recommended):** Set `NAME` and `PORT` in `app.config`, then from your machine (or a GitHub Action):

```bash
./deploy.sh /path/to/deploy-key
# or: SSH_PRIVATE_KEY=/path/to/key ./deploy.sh
```

This rsyncs the repo to `root@vps3.marekventur.com:/var/www/<NAME>` and runs `post_deploy.sh` on the VPS (npm ci, build, PM2 restart/start).

**Manual deploy:**

1. On the server: clone repo, then `npm ci` and `npm run build`.
2. Set `NAME` and `PORT` in `app.config` (or env):
   - `NODE_ENV=production`
   - Optional: `DATABASE_PATH` (default: `./data/app.db`)
3. Start with PM2:
   ```bash
   ./post_deploy.sh
   ```
   Or: `source app.config && pm2 start ecosystem.config.cjs`.
4. Use a reverse proxy (e.g. Nginx/Caddy) in front of the app and optionally `pm2 save` + `pm2 startup` for persistence.

## Stack

- **React Router v7** – Framework mode, file-based routes, loaders/actions, SSR.
- **Express** – Custom server; use `server/app.ts` and `server.js` to add middleware or routes.
- **Tailwind v4** – Via `@tailwindcss/vite`; styles in `app/app.css`.
- **DaisyUI** – `@plugin "daisyui"` in `app/app.css`; use `data-theme` on `<html>` to switch themes.
- **SQLite** – `better-sqlite3`; DB at `data/app.db` (or `DATABASE_PATH`). Use `context.db` in loaders/actions (see `server/app.ts` and `lib/db.ts`).
- **TypeScript** – App, server, and lib are TypeScript; `server.js` stays JS so `node server.js` works in production.

## Project layout

```
├── app/
│   ├── app.css          # Tailwind + DaisyUI
│   ├── root.tsx         # Root layout, ErrorBoundary
│   ├── routes.ts        # Route config
│   └── routes/         # File-based routes
├── lib/
│   └── db.ts            # SQLite connection (getDb)
├── server/
│   └── app.ts           # Express app + React Router handler
├── server.js            # Entry (dev: Vite middleware, prod: static + build)
├── app.config            # NAME + PORT (deploy & PM2)
├── verify.sh             # Local: npm ci, typecheck, build (run by deploy.sh first)
├── deploy.sh             # Verify, then rsync to VPS + run post_deploy.sh
├── post_deploy.sh        # On VPS: npm ci, build, PM2 restart/start
├── ecosystem.config.cjs  # PM2 config (uses NAME/PORT from app.config)
├── react-router.config.ts
├── vite.config.ts
└── tsconfig*.json
```

## Using the database in routes

In any route loader or action, you get `context.db` (from `getLoadContext` in `server/app.ts`):

```ts
// app/routes/some-route.tsx
export async function loader({ context }: Route.LoaderArgs) {
  const row = context.db.prepare("SELECT 1 as one").get();
  return { row };
}
```

Create tables or run migrations in `lib/db.ts` or a dedicated migration step; the template only opens the DB and exposes it via context.
