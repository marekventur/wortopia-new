import { useEffect, useState, type FormEvent } from "react";
import { redirect, Form, useNavigation } from "react-router";
import Nav from "../components/Nav";
import { getOrCreateSession } from "../../lib/session.js";
import { getDb } from "../../lib/db.js";
import { useSettingsStore } from "../stores/settingsStore";
import {
  DEFAULT_SETTINGS,
  coerceSettings,
  rowToSettings,
  type Settings,
  type SettingsRow,
} from "../../lib/settings.js";
import { readStoredSettings, writeStoredSettings } from "../localSettings";
import type { Route } from "./+types/einstellungen";

/** The form reads the same way for both; only where it saves differs. */
function settingsFromForm(form: FormData): Settings {
  return coerceSettings({
    showRotate: form.getAll("showRotate").includes("1"),
    wordListSort: form.get("wordListSort"),
    highContrast: form.getAll("highContrast").includes("1"),
    boardScale: Number(form.get("boardScale") ?? DEFAULT_SETTINGS.boardScale),
  });
}

export async function loader({ request }: Route.LoaderArgs) {
  const { session, cookieHeader } = await getOrCreateSession(request);

  // A guest's settings live in their browser, so the server has nothing to
  // send: render the defaults and let the client fill in what it has stored.
  const settings =
    session.type === "user"
      ? rowToSettings(
          getDb()
            .prepare(
              "SELECT show_rotate, word_list_sort, high_contrast, board_scale FROM user_settings WHERE user_id = ?",
            )
            .get(session.user.id) as SettingsRow | undefined,
        )
      : DEFAULT_SETTINGS;

  const payload = { session, settings, saved: false };
  return cookieHeader
    ? Response.json(payload, { headers: { "Set-Cookie": cookieHeader } })
    : payload;
}

export async function action({ request }: Route.ActionArgs) {
  const { session } = await getOrCreateSession(request);
  // Guests never reach this: the page saves their settings in the browser and
  // does not submit. Anything arriving here has an account to save against.
  if (session.type !== "user") return redirect("/login");

  const next = settingsFromForm(await request.formData());

  getDb()
    .prepare(
      `INSERT INTO user_settings (user_id, show_rotate, word_list_sort, high_contrast, board_scale)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET
         show_rotate    = excluded.show_rotate,
         word_list_sort = excluded.word_list_sort,
         high_contrast  = excluded.high_contrast,
         board_scale    = excluded.board_scale`,
    )
    .run(
      session.user.id,
      next.showRotate ? 1 : 0,
      next.wordListSort,
      next.highContrast ? 1 : 0,
      next.boardScale,
    );

  return redirect("/einstellungen?saved=1");
}

export default function Einstellungen({ loaderData }: Route.ComponentProps) {
  const { session, settings } = loaderData;
  const isGuest = session.type !== "user";
  const navigation = useNavigation();
  const saving = navigation.state === "submitting";

  const url = typeof window !== "undefined" ? new URL(window.location.href) : null;
  const [savedLocally, setSavedLocally] = useState(false);
  const saved = savedLocally || url?.searchParams.get("saved") === "1";

  // Read after mount, never during render: localStorage does not exist on the
  // server, and reading it in render would hand React a different tree than the
  // one it just hydrated. Re-keying the form swaps the defaults in.
  const [stored, setStored] = useState<Settings | null>(null);
  useEffect(() => {
    if (isGuest) setStored(readStoredSettings());
  }, [isGuest]);

  const shown = stored ?? settings;

  function handleGuestSave(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const next = settingsFromForm(new FormData(e.currentTarget));
    writeStoredSettings(next);
    // Apply straight away — the game is one tab click away and reads the store.
    useSettingsStore.getState().setSettings(next);
    setStored(next);
    setSavedLocally(true);
  }

  return (
    <>
      <Nav session={session} />
      <div className="container" style={{ marginTop: 30, maxWidth: 480 }}>
        <h2>Einstellungen</h2>

        {saved && <div className="alert alert-success">Einstellungen gespeichert.</div>}

        {isGuest && (
          <p className="text-muted">
            Deine Einstellungen werden in diesem Browser gespeichert. Wenn du dich{" "}
            <a href="/login">anmeldest</a>, gelten sie auf allen deinen Geräten.
          </p>
        )}

        <Form
          method="post"
          key={stored ? "stored" : "initial"}
          onSubmit={isGuest ? handleGuestSave : undefined}
        >
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
                  defaultChecked={shown.showRotate}
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
              defaultValue={shown.wordListSort}
            >
              <option value="default">Standard</option>
              <option value="alpha">Alphabetisch</option>
              <option value="points">Punkte</option>
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="boardScale">Brettgröße</label>
            <select
              className="form-control"
              name="boardScale"
              id="boardScale"
              defaultValue={shown.boardScale}
            >
              <option value={75}>75%</option>
              <option value={90}>90%</option>
              <option value={100}>100% (Standard)</option>
              <option value={115}>115%</option>
              <option value={125}>125%</option>
              <option value={150}>150%</option>
            </select>
          </div>

          <div className="form-group">
            <div className="checkbox">
              <label>
                <input
                  type="checkbox"
                  name="highContrast"
                  value="1"
                  defaultChecked={shown.highContrast}
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
