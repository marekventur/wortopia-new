import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("api/signup", "routes/api.signup.ts"),
  route("api/login", "routes/api.login.ts"),
  route("api/logout", "routes/api.logout.ts"),
  route("api/recover", "routes/api.recover.ts"),
] satisfies RouteConfig;
