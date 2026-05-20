import { redirect, Form, useNavigation } from "react-router";
import Nav from "../components/Nav";
import { getOrCreateSession } from "../../lib/session.js";
import { getDb } from "../../lib/db.js";
import type { Route } from "./+types/einstellungen";

type WordListSort = "default" | "alpha" | "points";
const VALID_SORTS: WordListSort[] = ["default", "alpha", "points"];

type SettingsRow = { show_rotate: number; word_list_sort: string; high_contrast: number };

function rowToSettings(row: SettingsRow | undefined) {
  return {
    showRotate:    row ? row.show_rotate !== 0 : true,
    wordListSort:  (row && VALID_SORTS.includes(row.word_list_sort as WordListSort)
      ? row.word_list_sort : "default") as WordListSort,
    highContrast:  row ? row.high_contrast !== 0 : false,
  };
}

export async function loader({ request }: Route.LoaderArgs) {
  const { session, cookieHeader } = await getOrCreateSession(request);
  if (session.type !== "user") return redirect("/login");

  const db = getDb();
  const row = db
    .prepare("SELECT show_rotate, word_list_sort, high_contrast FROM user_settings WHERE user_id = ?")
    .get(session.user.id) as SettingsRow | undefined;

  const payload = { session, settings: rowToSettings(row), saved: false };
  return cookieHeader
    ? Response.json(payload, { headers: { "Set-Cookie": cookieHeader } })
    : payload;
}

export async function action({ request }: Route.ActionArgs) {
  const { session } = await getOrCreateSession(request);
  if (session.type !== "user") return redirect("/login");

  const form = await request.formData();
  const showRotate   = form.getAll("showRotate").includes("1");
  const wordListSort = form.get("wordListSort") as string;
  const highContrast = form.getAll("highContrast").includes("1");

  if (!VALID_SORTS.includes(wordListSort as WordListSort)) {
    return redirect("/einstellungen");
  }

  const db = getDb();
  db.prepare(
    `INSERT INTO user_settings (user_id, show_rotate, word_list_sort, high_contrast)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET
       show_rotate    = excluded.show_rotate,
       word_list_sort = excluded.word_list_sort,
       high_contrast  = excluded.high_contrast`,
  ).run(session.user.id, showRotate ? 1 : 0, wordListSort, highContrast ? 1 : 0);

  return redirect("/einstellungen?saved=1");
}

export default function Einstellungen({ loaderData }: Route.ComponentProps) {
  const { session, settings } = loaderData;
  const navigation = useNavigation();
  const saving = navigation.state === "submitting";

  const url = typeof window !== "undefined" ? new URL(window.location.href) : null;
  const saved = url?.searchParams.get("saved") === "1";

  return (
    <>
      <Nav session={session} />
      <div className="container" style={{ marginTop: 30, maxWidth: 480 }}>
        <h2>Einstellungen</h2>

        {saved && <div className="alert alert-success">Einstellungen gespeichert.</div>}

        <Form method="post">
          {/* Hidden fields carry unchecked checkbox values */}
          <input type="hidden" name="showRotate" value="0" />
          <input type="hidden" name="highContrast" value="0" />

          <div className="form-group">
            <div className="checkbox">
              <label>
                <input
                  type="checkbox"
                  name="showRotate"
                  value="1"
                  defaultChecked={settings.showRotate}
                />
                {" "}Drehknopf anzeigen
              </label>
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="wordListSort">Wortliste sortieren nach</label>
            <select
              className="form-control"
              name="wordListSort"
              id="wordListSort"
              defaultValue={settings.wordListSort}
            >
              <option value="default">Standard</option>
              <option value="alpha">Alphabetisch</option>
              <option value="points">Punkte</option>
            </select>
          </div>

          <div className="form-group">
            <div className="checkbox">
              <label>
                <input
                  type="checkbox"
                  name="highContrast"
                  value="1"
                  defaultChecked={settings.highContrast}
                />
                {" "}Hoher Kontrast (nur Spielfeld)
              </label>
            </div>
          </div>

          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? "…" : "Speichern"}
          </button>
        </Form>
      </div>
    </>
  );
}
