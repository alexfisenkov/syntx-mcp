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
  archiveSettingsSourceInventory,
  loadSettingsSourceInventoryVersion
} from "../src/catalog/settings-source-history.js";
import {
  loadSettingsSourceInventory,
  serializeSettingsSourceInventory,
  SettingsSourceInventoryError,
  type SettingsSourceInventory
} from "../src/catalog/settings-source-inventory.js";
import { loadSyntxPublicCatalogSnapshot } from "../src/catalog/syntx-public-catalog.js";

const publicCatalog = loadSyntxPublicCatalogSnapshot();
const historical = loadSettingsSourceInventory(undefined, publicCatalog);

function fixture(t: TestContext): { root: string; catalog: string } {
  const root = mkdtempSync(join(tmpdir(), "syntx-settings-history-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const catalog = join(root, "catalog");
  mkdirSync(catalog);
  return { root, catalog };
}

function inventory(generatedAt = "2026-09-04T12:00:00.000Z"): SettingsSourceInventory {
  return { ...structuredClone(historical), generated_at: generatedAt };
}

function versionFor(bytes: string | Buffer): string {
  return `sha256-${createHash("sha256").update(bytes).digest("hex")}.json`;
}

function publishFixtureBytes(catalog: string, bytes: string | Buffer): string {
  mkdirSync(join(catalog, "settings"), { recursive: true });
  const version = versionFor(bytes);
  writeFileSync(join(catalog, "settings", version), bytes);
  return version;
}

function isCatalogMismatch(error: unknown): boolean {
  return error instanceof SettingsSourceInventoryError && error.code === "FAMILY_FORM_MAPPING_INVALID";
}

test("settings history archives canonical evidence-only bytes and reads its bound catalog", async (t) => {
  const { catalog } = fixture(t);
  const input = inventory();
  const bytes = serializeSettingsSourceInventory(input);
  const result = await archiveSettingsSourceInventory(input, publicCatalog, catalog);
  assert.equal(result.status, "created");
  assert.equal(result.version, versionFor(bytes));
  assert.equal(result.path, join(catalog, "settings", result.version));
  assert.equal(readFileSync(result.path, "utf8"), bytes);
  assert.equal(statSync(result.path).mode & 0o777, 0o600);
  assert.deepEqual(loadSettingsSourceInventoryVersion(result.version, publicCatalog, catalog), input);
  assert.equal(input.runtime_usable, false);
  assert.equal(input.closure.status, "OPEN");
  assert.deepEqual(readdirSync(join(catalog, "settings")), [result.version]);
});

test("repeated settings archive leaves existing inode, time and bytes unchanged", async (t) => {
  const { catalog } = fixture(t);
  const input = inventory();
  const first = await archiveSettingsSourceInventory(input, publicCatalog, catalog);
  const before = statSync(first.path);
  const second = await archiveSettingsSourceInventory(input, publicCatalog, catalog);
  const after = statSync(first.path);
  assert.deepEqual(second, { ...first, status: "existing" });
  assert.equal(after.ino, before.ino);
  assert.equal(after.mtimeMs, before.mtimeMs);
  assert.equal(readFileSync(first.path, "utf8"), serializeSettingsSourceInventory(input));
  assert.deepEqual(readdirSync(join(catalog, "settings")), [first.version]);
});

test("concurrent identical settings writers publish one target and leave no temporary files", async (t) => {
  const { catalog } = fixture(t);
  const input = inventory();
  const results = await Promise.all(Array.from({ length: 6 }, () => archiveSettingsSourceInventory(input, publicCatalog, catalog)));
  assert.equal(results.filter((result) => result.status === "created").length, 1);
  assert.equal(results.filter((result) => result.status === "existing").length, 5);
  assert.equal(new Set(results.map((result) => result.version)).size, 1);
  assert.deepEqual(readdirSync(join(catalog, "settings")), [results[0]!.version]);
  assert.deepEqual(loadSettingsSourceInventoryVersion(results[0]!.version, publicCatalog, catalog), input);
});

test("distinct settings versions preserve each other and historical runtime v1 bytes", async (t) => {
  const { catalog } = fixture(t);
  const historicalDirectory = join(catalog, "runtime", "v1");
  mkdirSync(historicalDirectory, { recursive: true });
  const historicalPath = join(historicalDirectory, "settings-source-inventory.json");
  const historicalBytes = serializeSettingsSourceInventory(historical);
  writeFileSync(historicalPath, historicalBytes);
  const inputs = [inventory(), inventory("2026-09-04T12:01:00.000Z")];
  const results = await Promise.all(inputs.map((input) => archiveSettingsSourceInventory(input, publicCatalog, catalog)));
  assert.ok(results.every((result) => result.status === "created"));
  assert.equal(new Set(results.map((result) => result.version)).size, 2);
  for (const [index, result] of results.entries()) {
    assert.deepEqual(loadSettingsSourceInventoryVersion(result.version, publicCatalog, catalog), inputs[index]);
  }
  assert.equal(readFileSync(historicalPath, "utf8"), historicalBytes);
  assert.deepEqual(readdirSync(join(catalog, "settings")).sort(), results.map((result) => result.version).sort());
});

test("settings archive rejects a different public catalog before any write and load rejects it too", async (t) => {
  const { catalog } = fixture(t);
  const input = inventory();
  const otherCatalog = { ...structuredClone(publicCatalog), fetched_at: "2026-09-04T12:01:00.000Z" };
  await assert.rejects(archiveSettingsSourceInventory(input, otherCatalog, catalog), isCatalogMismatch);
  assert.deepEqual(readdirSync(catalog), []);
  const result = await archiveSettingsSourceInventory(input, publicCatalog, catalog);
  assert.throws(() => loadSettingsSourceInventoryVersion(result.version, otherCatalog, catalog), isCatalogMismatch);
  assert.deepEqual(loadSettingsSourceInventoryVersion(result.version, publicCatalog, catalog), input);
});

test("settings inventory catalog bindings cannot be changed under self-consistent file hashes", async (t) => {
  const { catalog } = fixture(t);
  const candidates = [inventory(), inventory()];
  candidates[0]!.public_catalog.models_sha256 = `sha256:${"0".repeat(64)}`;
  candidates[1]!.family_forms[0]!.ai_active = !candidates[1]!.family_forms[0]!.ai_active;
  for (const candidate of candidates) {
    await assert.rejects(archiveSettingsSourceInventory(candidate, publicCatalog, catalog), isCatalogMismatch);
    const version = publishFixtureBytes(catalog, JSON.stringify(candidate));
    assert.throws(() => loadSettingsSourceInventoryVersion(version, publicCatalog, catalog), isCatalogMismatch);
  }
});

test("settings archive validates schema and catalog before filesystem side effects", async (t) => {
  const { catalog } = fixture(t);
  for (const invalid of [
    { ...inventory(), schema_version: "2.0.0" },
    { ...inventory(), runtime_usable: true },
    { ...inventory(), unexpected: "value" }
  ]) {
    await assert.rejects(archiveSettingsSourceInventory(invalid as SettingsSourceInventory, publicCatalog, catalog));
    assert.deepEqual(readdirSync(catalog), []);
  }
  const invalidCatalog = { ...publicCatalog, runtime_usable: true };
  await assert.rejects(archiveSettingsSourceInventory(inventory(), invalidCatalog as typeof publicCatalog, catalog));
  assert.deepEqual(readdirSync(catalog), []);
});

test("settings version rejects traversal, malformed, newline and non-string names", (t) => {
  const { catalog } = fixture(t);
  const valid = versionFor("example");
  const versions: unknown[] = ["", "..", `../${valid}`, `/tmp/${valid}`, valid.toUpperCase(), `${valid}\n`, `${valid}/extra`, "sha256-a.json", null, [valid]];
  for (const version of versions) {
    assert.throws(() => loadSettingsSourceInventoryVersion(version as string, publicCatalog, catalog), /SETTINGS_SOURCE_VERSION_INVALID/u);
  }
  assert.deepEqual(readdirSync(catalog), []);
});

test("settings history rejects a symlink catalog root", async (t) => {
  const { root, catalog } = fixture(t);
  const alias = join(root, "catalog-alias");
  symlinkSync(catalog, alias, "dir");
  await assert.rejects(archiveSettingsSourceInventory(inventory(), publicCatalog, alias), /SETTINGS_SOURCE_DIRECTORY_UNSAFE/u);
  assert.throws(() => loadSettingsSourceInventoryVersion(versionFor("example"), publicCatalog, alias), /SETTINGS_SOURCE_DIRECTORY_UNSAFE/u);
  assert.deepEqual(readdirSync(catalog), []);
});

test("settings history rejects symlink history directory without writing through it", async (t) => {
  const { root, catalog } = fixture(t);
  const other = join(root, "other");
  mkdirSync(other);
  symlinkSync(other, join(catalog, "settings"), "dir");
  await assert.rejects(archiveSettingsSourceInventory(inventory(), publicCatalog, catalog), /SETTINGS_SOURCE_DIRECTORY_UNSAFE/u);
  assert.throws(() => loadSettingsSourceInventoryVersion(versionFor("example"), publicCatalog, catalog), /SETTINGS_SOURCE_DIRECTORY_UNSAFE/u);
  assert.deepEqual(readdirSync(other), []);
});

test("settings history rejects a symlink target even when its bytes match", async (t) => {
  const { root, catalog } = fixture(t);
  const input = inventory();
  const bytes = serializeSettingsSourceInventory(input);
  const version = versionFor(bytes);
  mkdirSync(join(catalog, "settings"));
  const other = join(root, "other.json");
  writeFileSync(other, bytes);
  symlinkSync(other, join(catalog, "settings", version));
  assert.throws(() => loadSettingsSourceInventoryVersion(version, publicCatalog, catalog), /SETTINGS_SOURCE_FILE_UNSAFE/u);
  await assert.rejects(archiveSettingsSourceInventory(input, publicCatalog, catalog), /SETTINGS_SOURCE_FILE_UNSAFE/u);
  assert.equal(readFileSync(other, "utf8"), bytes);
  assert.deepEqual(readdirSync(join(catalog, "settings")), [version]);
});

test("settings history detects changed bytes before parsing", async (t) => {
  const { catalog } = fixture(t);
  const result = await archiveSettingsSourceInventory(inventory(), publicCatalog, catalog);
  writeFileSync(result.path, "{}\n");
  assert.throws(() => loadSettingsSourceInventoryVersion(result.version, publicCatalog, catalog), /SETTINGS_SOURCE_VERSION_HASH_MISMATCH/u);
});

test("settings history never overwrites a mismatched existing target or cleans foreign files", async (t) => {
  const { catalog } = fixture(t);
  const input = inventory();
  const version = versionFor(serializeSettingsSourceInventory(input));
  mkdirSync(join(catalog, "settings"));
  const path = join(catalog, "settings", version);
  writeFileSync(path, "unrelated existing bytes\n");
  const foreignTemporary = ".pending-foreign.tmp";
  writeFileSync(join(catalog, "settings", foreignTemporary), "foreign temporary bytes\n");
  await assert.rejects(archiveSettingsSourceInventory(input, publicCatalog, catalog), /SETTINGS_SOURCE_VERSION_COLLISION/u);
  assert.equal(readFileSync(path, "utf8"), "unrelated existing bytes\n");
  assert.equal(readFileSync(join(catalog, "settings", foreignTemporary), "utf8"), "foreign temporary bytes\n");
  assert.deepEqual(readdirSync(join(catalog, "settings")).sort(), [version, foreignTemporary].sort());
});

test("settings history rejects schema, summary and relationship tampering even with matching file hashes", (t) => {
  const { catalog } = fixture(t);
  const candidates = [
    { ...inventory(), runtime_usable: true },
    { ...inventory(), schema_version: "2.0.0" },
    { ...inventory(), summary: { ...historical.summary, model_variants: 9999 } },
    { ...inventory(), build: { ...historical.build, id: "1234567890" } }
  ];
  for (const candidate of candidates) {
    const version = publishFixtureBytes(catalog, JSON.stringify(candidate));
    assert.throws(() => loadSettingsSourceInventoryVersion(version, publicCatalog, catalog));
  }
});

test("settings history rejects empty and oversized regular files before decoding", (t) => {
  const { catalog } = fixture(t);
  const emptyVersion = publishFixtureBytes(catalog, "");
  assert.throws(() => loadSettingsSourceInventoryVersion(emptyVersion, publicCatalog, catalog), /SETTINGS_SOURCE_INVENTORY_SIZE_INVALID/u);
  const oversizedVersion = publishFixtureBytes(catalog, "oversized");
  truncateSync(join(catalog, "settings", oversizedVersion), 15 * 1024 * 1024 + 1);
  assert.throws(() => loadSettingsSourceInventoryVersion(oversizedVersion, publicCatalog, catalog), /SETTINGS_SOURCE_INVENTORY_SIZE_INVALID/u);
});

test("settings history rejects non-regular target and non-directory history path", async (t) => {
  const { catalog } = fixture(t);
  const input = inventory();
  const version = versionFor(serializeSettingsSourceInventory(input));
  mkdirSync(join(catalog, "settings"));
  mkdirSync(join(catalog, "settings", version));
  assert.throws(() => loadSettingsSourceInventoryVersion(version, publicCatalog, catalog), /SETTINGS_SOURCE_FILE_UNSAFE/u);
  await assert.rejects(archiveSettingsSourceInventory(input, publicCatalog, catalog), /SETTINGS_SOURCE_FILE_UNSAFE/u);
  const otherCatalog = join(catalog, "other");
  mkdirSync(otherCatalog);
  writeFileSync(join(otherCatalog, "settings"), "file");
  assert.throws(() => loadSettingsSourceInventoryVersion(version, publicCatalog, otherCatalog), /SETTINGS_SOURCE_DIRECTORY_UNSAFE/u);
  await assert.rejects(archiveSettingsSourceInventory(input, publicCatalog, otherCatalog), /SETTINGS_SOURCE_DIRECTORY_UNSAFE/u);
});

test("settings history rejects invalid UTF-8 even if its file hash is correct", (t) => {
  const { catalog } = fixture(t);
  const version = publishFixtureBytes(catalog, Buffer.from([0xff, 0xfe]));
  assert.throws(() => loadSettingsSourceInventoryVersion(version, publicCatalog, catalog), /encoded data/u);
});

test("settings history captures input bytes before asynchronous filesystem operations", async (t) => {
  const { catalog } = fixture(t);
  const input = inventory();
  const expected = structuredClone(input);
  const pending = archiveSettingsSourceInventory(input, publicCatalog, catalog);
  input.generated_at = "2026-09-04T14:00:00.000Z";
  input.models[0]!.active = !input.models[0]!.active;
  const result = await pending;
  assert.deepEqual(loadSettingsSourceInventoryVersion(result.version, publicCatalog, catalog), expected);
});
