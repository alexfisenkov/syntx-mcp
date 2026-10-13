import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  truncateSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import {
  archivePublicCatalogSnapshot,
  getPublicCatalogDirectory,
  loadPublicCatalogVersion,
  loadSelectedPublicCatalog
} from "../src/catalog/public-catalog-history.js";
import {
  loadSyntxPublicCatalogSnapshot,
  serializeSyntxPublicCatalogSnapshot,
  type SyntxPublicCatalogSnapshot
} from "../src/catalog/syntx-public-catalog.js";

const historical = loadSyntxPublicCatalogSnapshot();

function fixture(t: TestContext): { root: string; catalog: string } {
  const root = mkdtempSync(join(tmpdir(), "syntx-catalog-history-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const catalog = join(root, "catalog");
  mkdirSync(catalog);
  return { root, catalog };
}

function snapshot(fetchedAt = "2026-09-04T12:00:00.000Z"): SyntxPublicCatalogSnapshot {
  return { ...structuredClone(historical), fetched_at: fetchedAt };
}

function versionFor(bytes: string | Buffer): string {
  return `sha256-${createHash("sha256").update(bytes).digest("hex")}.json`;
}

function publishFixtureBytes(catalog: string, bytes: string | Buffer): string {
  mkdirSync(join(catalog, "public"), { recursive: true });
  const version = versionFor(bytes);
  writeFileSync(join(catalog, "public", version), bytes);
  return version;
}

test("history archives canonical snapshot bytes and reads the selected version", async (t) => {
  const { catalog } = fixture(t);
  const input = snapshot();
  const bytes = serializeSyntxPublicCatalogSnapshot(input);
  const result = await archivePublicCatalogSnapshot(input, catalog);
  assert.equal(result.status, "created");
  assert.equal(result.version, versionFor(bytes));
  assert.equal(result.path, join(catalog, "public", result.version));
  assert.equal(readFileSync(result.path, "utf8"), bytes);
  assert.deepEqual(loadPublicCatalogVersion(result.version, catalog), input);
  const selected = loadSelectedPublicCatalog({ version: result.version, catalogDirectory: catalog });
  assert.deepEqual(selected, { snapshot: input, archived: true, version: result.version });
  assert.equal(selected.snapshot.runtime_usable, false);
  assert.deepEqual(readdirSync(join(catalog, "public")), [result.version]);
});

test("repeated archive returns existing without replacing the inode or bytes", async (t) => {
  const { catalog } = fixture(t);
  const input = snapshot();
  const first = await archivePublicCatalogSnapshot(input, catalog);
  const before = statSync(first.path);
  const second = await archivePublicCatalogSnapshot(input, catalog);
  const after = statSync(first.path);
  assert.deepEqual(second, { ...first, status: "existing" });
  assert.equal(after.ino, before.ino);
  assert.equal(after.mtimeMs, before.mtimeMs);
  assert.deepEqual(readdirSync(join(catalog, "public")), [first.version]);
});

test("concurrent identical archives create exactly one immutable target", async (t) => {
  const { catalog } = fixture(t);
  const input = snapshot();
  const results = await Promise.all(Array.from({ length: 6 }, () => archivePublicCatalogSnapshot(input, catalog)));
  assert.equal(results.filter((result) => result.status === "created").length, 1);
  assert.equal(results.filter((result) => result.status === "existing").length, 5);
  assert.equal(new Set(results.map((result) => result.version)).size, 1);
  assert.deepEqual(readdirSync(join(catalog, "public")), [results[0]!.version]);
  assert.deepEqual(loadPublicCatalogVersion(results[0]!.version, catalog), input);
});

test("concurrent different archives preserve both versions and historical bytes", async (t) => {
  const { catalog } = fixture(t);
  mkdirSync(join(catalog, "v1"));
  const historicalPath = join(catalog, "v1", "official-public-api.json");
  const historicalBytes = serializeSyntxPublicCatalogSnapshot(historical);
  writeFileSync(historicalPath, historicalBytes);
  const inputs = [snapshot(), snapshot("2026-09-04T12:01:00.000Z")];
  const results = await Promise.all(inputs.map((input) => archivePublicCatalogSnapshot(input, catalog)));
  assert.ok(results.every((result) => result.status === "created"));
  assert.equal(new Set(results.map((result) => result.version)).size, 2);
  for (const [index, result] of results.entries()) {
    assert.deepEqual(loadPublicCatalogVersion(result.version, catalog), inputs[index]);
  }
  assert.equal(readFileSync(historicalPath, "utf8"), historicalBytes);
  assert.deepEqual(readdirSync(join(catalog, "public")).sort(), results.map((result) => result.version).sort());
});

test("existing mismatched target causes collision and is never overwritten", async (t) => {
  const { catalog } = fixture(t);
  const input = snapshot();
  const version = versionFor(serializeSyntxPublicCatalogSnapshot(input));
  mkdirSync(join(catalog, "public"));
  const path = join(catalog, "public", version);
  writeFileSync(path, "unrelated existing bytes\n");
  await assert.rejects(archivePublicCatalogSnapshot(input, catalog), /PUBLIC_CATALOG_VERSION_COLLISION/u);
  assert.equal(readFileSync(path, "utf8"), "unrelated existing bytes\n");
  assert.deepEqual(readdirSync(join(catalog, "public")), [version]);
});

test("invalid schema is rejected before any directory or temporary artifact", async (t) => {
  const { catalog } = fixture(t);
  for (const invalid of [
    { ...snapshot(), schema_version: "2.0.0" },
    { ...snapshot(), runtime_usable: true },
    { ...snapshot(), unexpected: "value" }
  ]) {
    await assert.rejects(archivePublicCatalogSnapshot(invalid as SyntxPublicCatalogSnapshot, catalog));
    assert.deepEqual(readdirSync(catalog), []);
  }
});

test("version selection rejects traversal, empty, malformed and newline names", (t) => {
  const { catalog } = fixture(t);
  const valid = versionFor("example");
  for (const version of ["", "..", `../${valid}`, `/tmp/${valid}`, valid.toUpperCase(), `${valid}\n`, `${valid}/extra`, "sha256-a.json"]) {
    assert.throws(() => loadPublicCatalogVersion(version, catalog), /PUBLIC_CATALOG_VERSION_INVALID/u);
    assert.throws(() => loadSelectedPublicCatalog({ version, catalogDirectory: catalog }), /PUBLIC_CATALOG_VERSION_INVALID/u);
  }
  assert.deepEqual(readdirSync(catalog), []);
});

test("symlink catalog root is rejected for reading and writing", async (t) => {
  const { root, catalog } = fixture(t);
  const alias = join(root, "catalog-alias");
  symlinkSync(catalog, alias, "dir");
  await assert.rejects(archivePublicCatalogSnapshot(snapshot(), alias), /PUBLIC_CATALOG_DIRECTORY_UNSAFE/u);
  assert.throws(() => loadPublicCatalogVersion(versionFor("example"), alias), /PUBLIC_CATALOG_DIRECTORY_UNSAFE/u);
  assert.deepEqual(readdirSync(catalog), []);
});

test("symlink history directory is rejected without writing through it", async (t) => {
  const { root, catalog } = fixture(t);
  const other = join(root, "other");
  mkdirSync(other);
  symlinkSync(other, join(catalog, "public"), "dir");
  await assert.rejects(archivePublicCatalogSnapshot(snapshot(), catalog), /PUBLIC_CATALOG_DIRECTORY_UNSAFE/u);
  assert.throws(() => loadPublicCatalogVersion(versionFor("example"), catalog), /PUBLIC_CATALOG_DIRECTORY_UNSAFE/u);
  assert.deepEqual(readdirSync(other), []);
});

test("symlink target is rejected even when its referenced bytes are correct", async (t) => {
  const { root, catalog } = fixture(t);
  const input = snapshot();
  const bytes = serializeSyntxPublicCatalogSnapshot(input);
  const version = versionFor(bytes);
  mkdirSync(join(catalog, "public"));
  const other = join(root, "other.json");
  writeFileSync(other, bytes);
  symlinkSync(other, join(catalog, "public", version));
  assert.throws(() => loadPublicCatalogVersion(version, catalog), /PUBLIC_CATALOG_FILE_UNSAFE/u);
  await assert.rejects(archivePublicCatalogSnapshot(input, catalog), /PUBLIC_CATALOG_FILE_UNSAFE/u);
  assert.equal(readFileSync(other, "utf8"), bytes);
  assert.deepEqual(readdirSync(join(catalog, "public")), [version]);
});

test("hash mismatch is detected before parsing modified snapshot bytes", async (t) => {
  const { catalog } = fixture(t);
  const result = await archivePublicCatalogSnapshot(snapshot(), catalog);
  writeFileSync(result.path, "{}\n");
  assert.throws(() => loadPublicCatalogVersion(result.version, catalog), /PUBLIC_CATALOG_VERSION_HASH_MISMATCH/u);
});

test("self-consistent file hash cannot authorize schema, summary or source-hash tampering", (t) => {
  const { catalog } = fixture(t);
  const candidates = [
    { ...snapshot(), runtime_usable: true },
    { ...snapshot(), schema_version: "2.0.0" },
    { ...snapshot(), summary: { ...historical.summary, model_total: 9999 } },
    { ...snapshot(), sources: { ...historical.sources, ai: { ...historical.sources.ai, canonical_sha256: `sha256:${"0".repeat(64)}` } } }
  ];
  for (const candidate of candidates) {
    const version = publishFixtureBytes(catalog, JSON.stringify(candidate));
    assert.throws(() => loadPublicCatalogVersion(version, catalog));
  }
});

test("empty and oversized regular files fail closed before JSON parsing", (t) => {
  const { catalog } = fixture(t);
  const emptyVersion = publishFixtureBytes(catalog, "");
  assert.throws(() => loadPublicCatalogVersion(emptyVersion, catalog), /PUBLIC_CATALOG_SNAPSHOT_SIZE_INVALID/u);
  const oversizedVersion = publishFixtureBytes(catalog, "oversized");
  truncateSync(join(catalog, "public", oversizedVersion), 15 * 1024 * 1024 + 1);
  assert.throws(() => loadPublicCatalogVersion(oversizedVersion, catalog), /PUBLIC_CATALOG_SNAPSHOT_SIZE_INVALID/u);
});

test("non-regular target and non-directory history path are rejected", async (t) => {
  const { catalog } = fixture(t);
  const input = snapshot();
  const version = versionFor(serializeSyntxPublicCatalogSnapshot(input));
  mkdirSync(join(catalog, "public"));
  mkdirSync(join(catalog, "public", version));
  assert.throws(() => loadPublicCatalogVersion(version, catalog), /PUBLIC_CATALOG_FILE_UNSAFE/u);
  await assert.rejects(archivePublicCatalogSnapshot(input, catalog), /PUBLIC_CATALOG_FILE_UNSAFE/u);
  const otherCatalog = join(catalog, "other");
  mkdirSync(otherCatalog);
  writeFileSync(join(otherCatalog, "public"), "file");
  assert.throws(() => loadPublicCatalogVersion(version, otherCatalog), /PUBLIC_CATALOG_DIRECTORY_UNSAFE/u);
  await assert.rejects(archivePublicCatalogSnapshot(input, otherCatalog), /PUBLIC_CATALOG_DIRECTORY_UNSAFE/u);
});

test("invalid UTF-8 is rejected even if the file hash matches", (t) => {
  const { catalog } = fixture(t);
  const version = publishFixtureBytes(catalog, Buffer.from([0xff, 0xfe]));
  assert.throws(() => loadPublicCatalogVersion(version, catalog), /encoded data/u);
});

test("default selection remains the exact historical snapshot", (t) => {
  const selected = loadSelectedPublicCatalog();
  assert.deepEqual(selected, { snapshot: historical, archived: false, version: null });
  assert.ok(statSync(getPublicCatalogDirectory()).isDirectory());
  const { catalog } = fixture(t);
  mkdirSync(join(catalog, "v1"));
  const customHistorical = snapshot();
  writeFileSync(join(catalog, "v1", "official-public-api.json"), serializeSyntxPublicCatalogSnapshot(customHistorical));
  assert.deepEqual(loadSelectedPublicCatalog({ catalogDirectory: catalog }), {
    snapshot: customHistorical, archived: false, version: null
  });
});

test("historical selection also rejects symlink directories and files", (t) => {
  const { root, catalog } = fixture(t);
  const other = join(root, "historical");
  mkdirSync(other);
  writeFileSync(join(other, "official-public-api.json"), serializeSyntxPublicCatalogSnapshot(historical));
  symlinkSync(other, join(catalog, "v1"), "dir");
  assert.throws(() => loadSelectedPublicCatalog({ catalogDirectory: catalog }), /PUBLIC_CATALOG_DIRECTORY_UNSAFE/u);
  const otherCatalog = join(root, "other-catalog");
  mkdirSync(join(otherCatalog, "v1"), { recursive: true });
  symlinkSync(join(other, "official-public-api.json"), join(otherCatalog, "v1", "official-public-api.json"));
  assert.throws(() => loadSelectedPublicCatalog({ catalogDirectory: otherCatalog }), /PUBLIC_CATALOG_FILE_UNSAFE/u);
});
