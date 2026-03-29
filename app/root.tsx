import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";

import type { Route } from "./+types/root";
import "./app.css";

export const links: Route.LinksFunction = () => [
  {
    rel: "stylesheet",
    href: "https://netdna.bootstrapcdn.com/bootstrap/3.3.7/css/bootstrap.min.css",
  },
  {
    rel: "stylesheet",
    href: "https://netdna.bootstrapcdn.com/font-awesome/4.0.3/css/font-awesome.css",
  },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Wortopia</title>
        <Links />
        <Meta />
      </head>
      <body className="size-4 game-ongoing wortopia">
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Oops!";
  let details = "An unexpected error occurred.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Error";
    details =
      error.status === 404
        ? "The requested page could not be found."
        : error.statusText || details;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-2xl font-bold text-error">{message}</h1>
      <p className="text-base-content/80">{details}</p>
      {stack && (
        <pre className="max-w-full overflow-auto rounded-lg bg-base-200 p-4 text-sm">
          {stack}
        </pre>
      )}
    </div>
  );
}
