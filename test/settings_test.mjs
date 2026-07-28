/**
 * The shared settings contract.
 *
 * Guests keep their settings in localStorage and accounts keep them in the
 * database, but both go through coerceSettings — this is what stops the two
 * paths from drifting apart. Runs standalone; no database, no server.
 *
 * Usage:
 *   node test/settings_test.mjs
 */

import { createServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const C = { reset: "\x1b[0m", green: "\x1b[32m", red: "\x1b[31m", bold: "\x1b[1m", dim: "\x1b[2m" };

let passed = 0;
let failed = 0;

function check(name, condition, detail = "") {
  if (condition) {
    passed++;
    console.log(`${C.green}  ok${C.reset} ${name}`);
  } else {
    failed++;
    console.log(`${C.red}  FAIL${C.reset} ${name}${detail ? ` ${C.dim}${detail}${C.reset}` : ""}`);
  }
}

const vite = await createServer({ root: ROOT, server: { middlewareMode: true }, appType: "custom" });

try {
  const { DEFAULT_SETTINGS, coerceSettings, rowToSettings, settingsPatchError } =
    await vite.ssrLoadModule("./lib/settings.ts");

  console.log(`${C.bold}defaults${C.reset}`);
  check("empty input is the defaults", JSON.stringify(coerceSettings({})) === JSON.stringify(DEFAULT_SETTINGS));
  check("null input does not throw", JSON.stringify(coerceSettings(null)) === JSON.stringify(DEFAULT_SETTINGS));
  check("board starts at 100%", DEFAULT_SETTINGS.boardScale === 100);

  console.log(`${C.bold}valid values pass through${C.reset}`);
  const full = coerceSettings({ showRotate: false, wordListSort: "alpha", highContrast: true, boardScale: 150 });
  check("all four kept", JSON.stringify(full) ===
    JSON.stringify({ showRotate: false, wordListSort: "alpha", highContrast: true, boardScale: 150 }), JSON.stringify(full));
  check("scale as a string still counts", coerceSettings({ boardScale: "125" }).boardScale === 125);

  console.log(`${C.bold}rubbish falls back${C.reset}`);
  check("unknown sort", coerceSettings({ wordListSort: "zufall" }).wordListSort === "default");
  check("off-list scale", coerceSettings({ boardScale: 400 }).boardScale === 100);
  check("scale that is not a number", coerceSettings({ boardScale: "riesig" }).boardScale === 100);
  check("unknown keys ignored", coerceSettings({ nonsense: 1 }).boardScale === 100);

  console.log(`${C.bold}partial updates keep the rest${C.reset}`);
  const base = { showRotate: false, wordListSort: "points", highContrast: true, boardScale: 150 };
  const patched = coerceSettings({ boardScale: 90 }, base);
  check("only the named field changes", patched.boardScale === 90 && patched.wordListSort === "points" && patched.highContrast === true,
    JSON.stringify(patched));
  check("an invalid field keeps the base value", coerceSettings({ boardScale: 999 }, base).boardScale === 150);

  console.log(`${C.bold}database rows${C.reset}`);
  check("missing row is the defaults", JSON.stringify(rowToSettings(undefined)) === JSON.stringify(DEFAULT_SETTINGS));
  const fromRow = rowToSettings({ show_rotate: 0, word_list_sort: "alpha", high_contrast: 1, board_scale: 125 });
  check("ints become booleans", fromRow.showRotate === false && fromRow.highContrast === true, JSON.stringify(fromRow));
  check("a corrupt row still yields something usable",
    rowToSettings({ show_rotate: 1, word_list_sort: "???", high_contrast: 0, board_scale: 3 }).boardScale === 100);

  console.log(`${C.bold}the JSON endpoint rejects rather than substitutes${C.reset}`);
  check("bad sort is an error", settingsPatchError({ wordListSort: "zufall" }) !== null);
  check("bad scale is an error", settingsPatchError({ boardScale: 400 }) !== null);
  check("absent fields are fine", settingsPatchError({ showRotate: true }) === null);
  check("empty patch is fine", settingsPatchError({}) === null);
} finally {
  await vite.close();
}

console.log(
  `\n${passed} passed, ${failed} failed` +
    (failed === 0 ? ` ${C.green}${C.bold}ALL OK${C.reset}` : ` ${C.red}${C.bold}FAILURES${C.reset}`),
);
process.exit(failed === 0 ? 0 : 1);
