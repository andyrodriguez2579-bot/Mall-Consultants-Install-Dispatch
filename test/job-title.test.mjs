import assert from "node:assert/strict";
import test from "node:test";
import { copiedTitle } from "../src/lib/job-title.ts";

/**
 * The title goes into the offer SMS, so its length is billed. A job duplicated
 * three times had accumulated "(copy) (copy) (copy)" and pushed the useful part
 * of the message out of view.
 */

test("a first copy is marked once", () => {
  assert.equal(
    copiedTitle("SSDC installation - Ebb & Bloom Cafe"),
    "SSDC installation - Ebb & Bloom Cafe (copy)",
  );
});

test("copying a copy counts instead of appending", () => {
  assert.equal(copiedTitle("Install (copy)"), "Install (copy 2)");
  assert.equal(copiedTitle("Install (copy 2)"), "Install (copy 3)");
  assert.equal(copiedTitle("Install (copy 9)"), "Install (copy 10)");
});

test("repeated duplication never stacks a second suffix", () => {
  let title = "SSDC installation - Ebb & Bloom Cafe, Long Island City";
  for (let i = 0; i < 6; i += 1) title = copiedTitle(title);

  assert.equal(
    title,
    "SSDC installation - Ebb & Bloom Cafe, Long Island City (copy 6)",
  );
  assert.equal(title.match(/\(copy/g).length, 1, "exactly one suffix");
});

test("a title that merely mentions a copy is left alone", () => {
  // The suffix is only recognised at the end, so this gains one rather than
  // being read as already numbered.
  assert.equal(
    copiedTitle("Replace (copy) unit and test"),
    "Replace (copy) unit and test (copy)",
  );
});

test("case is not a way to defeat the count", () => {
  assert.equal(copiedTitle("Install (COPY)"), "Install (copy 2)");
});

test("a title of nothing but a suffix stays a suffix", () => {
  assert.equal(copiedTitle("(copy)"), "(copy 2)");
});
