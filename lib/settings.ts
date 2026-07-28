/**
 * Display settings, and the one place that decides what a valid one is.
 *
 * They exist twice over: in user_settings for anyone signed in, and in
 * localStorage for everyone else. That second copy is not a nicety — board size
 * and high contrast are what a sight-impaired player needs before they can play
 * at all, and requiring an account first put the game out of reach for them.
 *
 * Nothing here touches the database or the browser API surface beyond a guarded
 * localStorage, so both the server routes and the client can import it.
 */

export type WordListSort = "default" | "alpha" | "points";

export type Settings = {
  showRotate: boolean;
  wordListSort: WordListSort;
  highContrast: boolean;
  boardScale: number;
};

export const VALID_SORTS: WordListSort[] = ["default", "alpha", "points"];
export const VALID_SCALES = [75, 90, 100, 115, 125, 150];

export const DEFAULT_SETTINGS: Settings = {
  showRotate: true,
  wordListSort: "default",
  highContrast: false,
  boardScale: 100,
};

/** The row shape in user_settings, for the routes that read it. */
export type SettingsRow = {
  show_rotate: number;
  word_list_sort: string;
  high_contrast: number;
  board_scale: number;
};

/**
 * Anything at all to a valid Settings: unknown keys ignored, invalid values
 * replaced from `base`. Used for form data, JSON bodies and stored values
 * alike, so a guest's settings can never be validated more loosely than an
 * account's.
 */
export function coerceSettings(input: unknown, base: Settings = DEFAULT_SETTINGS): Settings {
  const raw = (input ?? {}) as Record<string, unknown>;

  const sort = raw.wordListSort;
  const scale = Number(raw.boardScale);

  return {
    showRotate: "showRotate" in raw ? Boolean(raw.showRotate) : base.showRotate,
    wordListSort: VALID_SORTS.includes(sort as WordListSort)
      ? (sort as WordListSort)
      : base.wordListSort,
    highContrast: "highContrast" in raw ? Boolean(raw.highContrast) : base.highContrast,
    boardScale: VALID_SCALES.includes(scale) ? scale : base.boardScale,
  };
}

/**
 * For the JSON endpoint, where a bad value means a caller with a bug rather
 * than a stale stored blob: say so instead of quietly substituting.
 */
export function settingsPatchError(input: unknown): string | null {
  const raw = (input ?? {}) as Record<string, unknown>;
  if ("wordListSort" in raw && !VALID_SORTS.includes(raw.wordListSort as WordListSort)) {
    return "Ungültiger Sortierwert.";
  }
  if ("boardScale" in raw && !VALID_SCALES.includes(Number(raw.boardScale))) {
    return "Ungültige Brettgröße.";
  }
  return null;
}

export function rowToSettings(row: SettingsRow | undefined): Settings {
  if (!row) return DEFAULT_SETTINGS;
  return coerceSettings({
    showRotate: row.show_rotate !== 0,
    wordListSort: row.word_list_sort,
    highContrast: row.high_contrast !== 0,
    boardScale: row.board_scale,
  });
}
