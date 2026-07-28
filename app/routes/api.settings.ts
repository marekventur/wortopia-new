import { data } from "react-router";
import type { Route } from "./+types/api.settings";
import { getSessionUser } from "../../lib/session.js";
import { getDb } from "../../lib/db.js";
import {
  DEFAULT_SETTINGS,
  coerceSettings,
  rowToSettings,
  settingsPatchError,
  type SettingsRow,
} from "../../lib/settings.js";

const SELECT_SETTINGS =
  "SELECT show_rotate, word_list_sort, high_contrast, board_scale FROM user_settings WHERE user_id = ?";

export async function loader({ request }: Route.LoaderArgs) {
  const user = await getSessionUser(request);
  // Guests keep their settings in the browser, so there is nothing to return
  // but the defaults — the client overlays what it has stored.
  if (!user) return data(DEFAULT_SETTINGS);

  const row = getDb().prepare(SELECT_SETTINGS).get(user.id) as SettingsRow | undefined;
  return data(rowToSettings(row));
}

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "PATCH") {
    return data({ error: "Method not allowed" }, { status: 405 });
  }

  const user = await getSessionUser(request);
  if (!user) {
    return data({ error: "Nicht eingeloggt." }, { status: 401 });
  }

  const body = (await request.json()) as unknown;
  const invalid = settingsPatchError(body);
  if (invalid) return data({ error: invalid }, { status: 400 });

  const db = getDb();
  const existing = db.prepare(SELECT_SETTINGS).get(user.id) as SettingsRow | undefined;

  // A partial update over what is already stored: anything absent keeps its
  // current value rather than snapping back to the default.
  const next = coerceSettings(body, rowToSettings(existing));

  db.prepare(
    `INSERT INTO user_settings (user_id, show_rotate, word_list_sort, high_contrast, board_scale)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET
       show_rotate    = excluded.show_rotate,
       word_list_sort = excluded.word_list_sort,
       high_contrast  = excluded.high_contrast,
       board_scale    = excluded.board_scale`,
  ).run(
    user.id,
    next.showRotate ? 1 : 0,
    next.wordListSort,
    next.highContrast ? 1 : 0,
    next.boardScale,
  );

  return data(next);
}
