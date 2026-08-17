import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createZip } from "../src/lib/zip.ts";

/**
 * The archive leaves this system and is opened somewhere else -- by an
 * invoicing agent, on a machine nobody here controls. A byte wrong in a header
 * produces a file that downloads happily and fails at the far end, which is the
 * worst possible place to find out. So these assert against the actual format,
 * and where the platform provides `unzip`, against a real unzipper.
 */

const jpeg = (byte) => new Uint8Array([0xff, 0xd8, 0xff, byte, 0x00, 0x01, 0x02]);

function u32(bytes, offset) {
  return new DataView(bytes.buffer, bytes.byteOffset).getUint32(offset, true);
}

test("writes the local header, central directory and end record", () => {
  const zip = createZip([{ name: "a.jpg", data: jpeg(1) }]);

  assert.equal(u32(zip, 0), 0x04034b50, "starts with a local file header");

  const end = zip.length - 22;
  assert.equal(u32(zip, end), 0x06054b50, "ends with the end-of-central-directory");

  const view = new DataView(zip.buffer, zip.byteOffset);
  assert.equal(view.getUint16(end + 10, true), 1, "records one entry");

  const centralOffset = u32(zip, end + 16);
  assert.equal(u32(zip, centralOffset), 0x02014b50, "central directory is where the end record says");
});

test("gives colliding names distinct entries", () => {
  const zip = createZip([
    { name: "photo.jpg", data: jpeg(1) },
    { name: "photo.jpg", data: jpeg(2) },
    { name: "photo.jpg", data: jpeg(3) },
  ]);

  const text = Buffer.from(zip).toString("latin1");
  assert.ok(text.includes("photo.jpg"), "keeps the first name");
  assert.ok(text.includes("photo (2).jpg"), "suffixes the second");
  assert.ok(text.includes("photo (3).jpg"), "suffixes the third");
});

test("an empty archive is still a valid archive", () => {
  const zip = createZip([]);
  assert.equal(zip.length, 22);
  assert.equal(u32(zip, 0), 0x06054b50);
});

test("a real unzipper reads it back byte for byte", (t) => {
  let available = true;
  try {
    execFileSync("unzip", ["-v"], { stdio: "ignore" });
  } catch {
    available = false;
  }
  if (!available) return t.skip("unzip is not installed here");

  const dir = mkdtempSync(join(tmpdir(), "zip-"));
  const archive = join(dir, "photos.zip");

  const first = jpeg(1);
  const second = jpeg(2);
  writeFileSync(
    archive,
    createZip([
      { name: "MC-1001 before 1.jpg", data: first },
      { name: "MC-1001 after 1.jpg", data: second },
    ]),
  );

  execFileSync("unzip", ["-q", "-o", archive, "-d", dir]);

  assert.deepEqual(
    new Uint8Array(readFileSync(join(dir, "MC-1001 before 1.jpg"))),
    first,
    "the before photo survives the round trip unchanged",
  );
  assert.deepEqual(
    new Uint8Array(readFileSync(join(dir, "MC-1001 after 1.jpg"))),
    second,
    "the after photo survives the round trip unchanged",
  );
});
