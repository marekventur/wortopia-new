import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/index.ts"),
  route("regeln", "routes/regeln.tsx"),
  route("rangliste", "routes/rangliste.tsx"),
  route("login", "routes/login.tsx"),
  route("account", "routes/account.tsx"),
  route("konten", "routes/konten.tsx"),
  route("einstellungen", "routes/einstellungen.tsx"),
  // Legacy URL from the old site's password-reset emails.
  route("recover", "routes/recover.ts"),
  // Keep last: a bare ":size" segment also matches every unknown top-level path.
  route(":size", "routes/home.tsx"),
  route("api/auth/request", "routes/api.auth.request.ts"),
  route("api/auth/verify", "routes/api.auth.verify.ts"),
  route("api/auth/register", "routes/api.auth.register.ts"),
  route("api/logout", "routes/api.logout.ts"),
  route("api/account", "routes/api.account.ts"),
  route("api/konten/claim", "routes/api.konten.claim.ts"),
  route("api/konten/hide", "routes/api.konten.hide.ts"),
  route("api/konten/switch", "routes/api.konten.switch.ts"),
  route("api/settings", "routes/api.settings.ts"),
  route("api/player-counts", "routes/api.player-counts.ts"),
] satisfies RouteConfig;
