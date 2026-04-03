import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/index.ts"),
  route("regeln", "routes/regeln.tsx"),
  route("rangliste", "routes/rangliste.tsx"),
  route("login", "routes/login.tsx"),
  route("account", "routes/account.tsx"),
  route(":size", "routes/home.tsx"),
  route("api/signup", "routes/api.signup.ts"),
  route("api/login", "routes/api.login.ts"),
  route("api/logout", "routes/api.logout.ts"),
  route("api/recover", "routes/api.recover.ts"),
  route("api/account", "routes/api.account.ts"),
] satisfies RouteConfig;
