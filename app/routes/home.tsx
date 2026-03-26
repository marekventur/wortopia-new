import type { Route } from "./+types/home";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Hello World" },
    { name: "description", content: "Default app template" },
  ];
}

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <div className="card card-compact w-full max-w-md bg-base-200 shadow-xl">
        <div className="card-body items-center text-center">
          <h1 className="card-title text-4xl">Hello World</h1>
          <p className="text-base-content/80">
            React Router v7 + Express + Tailwind + DaisyUI + SQLite
          </p>
          <div className="card-actions justify-end">
            <button type="button" className="btn btn-primary">
              Get started
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
