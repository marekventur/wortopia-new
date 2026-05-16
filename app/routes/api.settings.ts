import { data } from "react-router";
import type { Route } from "./+types/api.settings";
import { getSessionUser } from "../../lib/session.js";
import { getDb } from "../../lib/db.js";

type WordListSort = "default" | "alpha" | "points";

const VALID_SORTS: WordListSort[] = ["default", "alpha", "points"];

type SettingsRow = {
  show_rotate: number;
  word_list_sort: string;
};

function getDefaultSettings() {
  return { showRotate: true, wordListSort: "default" as WordListSort };
}

function rowToSettings(row: SettingsRow) {
  return {
    showRotate: row.show_rotate !== 0,
    wordListSort: (VALID_SORTS.includes(row.word_list_sort as WordListSort)
      ? row.word_list_sort
      : "default") as WordListSort,
  };
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await getSessionUser(request);
  if (!user) {
    return data(getDefaultSettings());
  }

  const db = getDb();
  const row = db
    .prepare("SELECT show_rotate, word_list_sort FROM user_settings WHERE user_id = ?")
    .get(user.id) as SettingsRow | undefined;

  return data(row ? rowToSettings(row) : getDefaultSettings());
}

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "PATCH") {
    return data({ error: "Method not allowed" }, { status: 405 });
  }

  const user = await getSessionUser(request);
  if (!user) {
    return data({ error: "Nicht eingeloggt." }, { status: 401 });
  }

  const body = await request.json() as Record<string, unknown>;
  const db = getDb();

  // Read current settings as base
  const existing = db
    .prepare("SELECT show_rotate, word_list_sort FROM user_settings WHERE user_id = ?")
    .get(user.id) as SettingsRow | undefined;

  const current = existing ? rowToSettings(existing) : getDefaultSettings();

  // Validate and apply partial update
  let showRotate = current.showRotate;
  let wordListSort = current.wordListSort;

  if ("showRotate" in body) {
    showRotate = Boolean(body.showRotate);
  }
  if ("wordListSort" in body) {
    const val = body.wordListSort as string;
    if (!VALID_SORTS.includes(val as WordListSort)) {
      return data({ error: "Ungültiger Sortierwert." }, { status: 400 });
    }
    wordListSort = val as WordListSort;
  }

  db.prepare(
    `INSERT INTO user_settings (user_id, show_rotate, word_list_sort)
     VALUES (?, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET
       show_rotate    = excluded.show_rotate,
       word_list_sort = excluded.word_list_sort`,
  ).run(user.id, showRotate ? 1 : 0, wordListSort);

  return data({ showRotate, wordListSort });
}
