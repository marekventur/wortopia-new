/**
 * Umlaut suggestions for word proposals.
 *
 * The board has no umlauts, so the dictionary spells ÖFFNEN as OEFFNEN and that
 * is what players type. Proposals travel on to spielwoerter.de, where the German
 * word is the one with the umlaut — so the spelling is worth asking about. It
 * can only ever be a suggestion: Bauer and Steuer contain "ue" and are right as
 * they are.
 *
 * Usage:
 *   node test/umlauts_test.mjs
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
  const { umlautCandidate } = await vite.ssrLoadModule("./lib/umlauts.ts");
  const is = (word, expected) =>
    check(`${word} -> ${expected ?? "no suggestion"}`, umlautCandidate(word) === expected, JSON.stringify(umlautCandidate(word)));

  console.log(`${C.bold}the case this exists for${C.reset}`);
  is("OEFFNEN", "öffnen");
  is("maedchen", "mädchen");
  is("ueber", "über");
  is("GRUENDAECHER", "gründächer");

  console.log(`${C.bold}nothing to suggest${C.reset}`);
  is("haus", null);
  is("wort", null);
  is("", null);

  console.log(`${C.bold}qu is left alone${C.reset}`);
  is("quelle", null);
  is("quer", null);
  is("QUETSCHEN", null);
  is("bequem", null);

  console.log(`${C.bold}suggested anyway, for the player to decline${C.reset}`);
  // Ordinary words that happen to contain the pairs. The suggestion is wrong
  // here, which is exactly why it is a question and not a correction.
  is("bauer", "baür");
  is("steuer", "steür");
  is("feuer", "feür");
  is("poesie", "pösie");
  is("aerobic", "ärobic");
} finally {
  await vite.close();
}

console.log(
  `\n${passed} passed, ${failed} failed` +
    (failed === 0 ? ` ${C.green}${C.bold}ALL OK${C.reset}` : ` ${C.red}${C.bold}FAILURES${C.reset}`),
);
process.exit(failed === 0 ? 0 : 1);
