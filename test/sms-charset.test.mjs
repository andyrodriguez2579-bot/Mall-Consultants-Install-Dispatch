import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * Guard against characters that silently triple the cost of an SMS.
 *
 * A message is encoded as GSM-7 -- 160 characters per billed segment -- only if
 * every character is in that alphabet. One character outside it, an em dash or
 * a middle dot, re-encodes the whole message as UCS-2 at 70 characters per
 * segment. An offer runs to roughly 200 characters, so a single decorative
 * separator turns two segments into three, on every offer sent.
 *
 * This reads the source rather than calling the templates: they import through
 * the `@/` path alias, which the test runner does not resolve. So it is a lint
 * over the files that produce message text, not a check of rendered output --
 * it catches the literal typed into a template, which is where this mistake
 * actually gets made.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Files whose string literals can reach an SMS body. */
const SOURCES = [
  "src/lib/sms/templates.ts",
  "src/lib/intake/summary.ts",
  "src/lib/branding.ts",
];

/**
 * Typographic characters that look harmless in an editor and are not in GSM-7.
 * Named individually so a failure says which one and what to use instead.
 */
const OFFENDERS = [
  ["—", "em dash", "-"],
  ["–", "en dash", "-"],
  ["·", "middle dot", "|"],
  ["×", "multiplication sign", "x"],
  ["‘", "left single quote", "'"],
  ["’", "right single quote", "'"],
  ["“", "left double quote", '"'],
  ["”", "right double quote", '"'],
  ["…", "ellipsis", "..."],
  ["→", "right arrow", "->"],
  [" ", "non-breaking space", "a normal space"],
];

/** Comment lines may say anything; only code produces message text. */
function codeLines(source) {
  return source
    .split("\n")
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => {
      const trimmed = line.trim();
      return !(
        trimmed.startsWith("//") ||
        trimmed.startsWith("*") ||
        trimmed.startsWith("/*")
      );
    });
}

for (const relative of SOURCES) {
  test(`${relative} stays inside GSM-7`, () => {
    const source = readFileSync(join(root, relative), "utf8");

    for (const { line, number } of codeLines(source)) {
      for (const [character, name, replacement] of OFFENDERS) {
        assert.ok(
          !line.includes(character),
          `${relative}:${number} contains a ${name}. It is not in GSM-7, so it ` +
            `re-encodes the whole message as UCS-2 and halves the characters ` +
            `per billed segment. Use ${replacement} instead.\n  ${line.trim()}`,
        );
      }
    }
  });
}

test("the offer template still carries opt-out wording", () => {
  const source = readFileSync(join(root, "src/lib/sms/templates.ts"), "utf8");

  // Registered with the carriers as part of the A2P campaign, so removing it
  // puts the message out of step with what was approved.
  assert.ok(
    /Reply STOP to opt out/.test(source),
    "the offer message must tell a contractor how to stop receiving them",
  );
});
