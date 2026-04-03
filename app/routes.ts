import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/index.ts"),
  route("regeln", "routes/regeln.tsx"),
  route("rangliste", "routes/rangliste.tsx"),
  route("login", "routes/login.tsx"),
  route("account", "routes/account.tsx"),
  route(":size", "routes/home.tsx"),
  route("api/auth/request", "routes/api.auth.request.ts"),
  route("api/auth/verify", "routes/api.auth.verify.ts"),
  route("api/auth/register", "routes/api.auth.register.ts"),
  route("api/logout", "routes/api.logout.ts"),
  route("api/account", "routes/api.account.ts"),
  route("api/player-counts", "routes/api.player-counts.ts"),
] satisfies RouteConfig;
