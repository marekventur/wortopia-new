/**
 * Where a guest's display settings live.
 *
 * Signed-in players have user_settings; everyone else has this, because board
 * size and high contrast decide whether the game is playable at all and should
 * not wait behind an account. The shape and the validation are shared with the
 * server path (lib/settings.ts), so the two can never drift.
 *
 * Separate from lib/ because that is compiled without the DOM lib.
 */

import { coerceSettings, type Settings } from "../lib/settings.js";

export const SETTINGS_STORAGE_KEY = "wortopia.settings";

/** Null when nothing is stored, unreadable, or storage is blocked. */
export function readStoredSettings(): Settings | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (raw === null) return null;
    return coerceSettings(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function writeStoredSettings(settings: Settings): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* quota, or private mode — the choice still applies for this session */
  }
}
