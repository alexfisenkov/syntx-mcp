import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
type Config = { readOwnerWan27VideoEditFlag(value: unknown): boolean;
  readOwnerWan27VideoEditOperatorConfiguration(enabled: boolean, path: unknown, cap: unknown): Readonly<{ ffprobePath: string; maxVideoFileBytes: number }> | undefined };
async function api(): Promise<Config> {
  let value: Partial<Config> = {};
  try { value = await import(new URL("../src/runtime/owner-wan27-videoedit-stdio-config.js", import.meta.url).href); }
  catch (error) { if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ERR_MODULE_NOT_FOUND") throw error; }
  assert.equal(typeof value.readOwnerWan27VideoEditFlag, "function");
  assert.equal(typeof value.readOwnerWan27VideoEditOperatorConfiguration, "function");
  return value as Config;
}
test("2174 independent default-off WAN27 Edit flag never opts in from arbitrary truthiness", async () => {
  const a = await api();
  for (const value of [undefined, "", "0"]) assert.equal(a.readOwnerWan27VideoEditFlag(value), false);
  assert.equal(a.readOwnerWan27VideoEditFlag("1"), true);
  for (const value of [true, 1, "true", " 1", "01", null]) assert.throws(() => a.readOwnerWan27VideoEditFlag(value));
  assert.equal(a.readOwnerWan27VideoEditOperatorConfiguration(false, {}, "invalid"), undefined);
});
test("2174 operator path and exact WAN100MiB cap are separate from MCP input", async () => {
  const a = await api(), path = resolve("trusted-ffprobe-executable");
  assert.deepEqual(a.readOwnerWan27VideoEditOperatorConfiguration(true, path, undefined), { ffprobePath: path, maxVideoFileBytes: 64 * 1024 * 1024 });
  for (const cap of ["1", "104857600"]) assert.equal(a.readOwnerWan27VideoEditOperatorConfiguration(true, path, cap)?.maxVideoFileBytes, Number(cap));
  for (const cap of ["0", "104857601", "314572800", "1.5", "01", " 1", 1]) assert.throws(() => a.readOwnerWan27VideoEditOperatorConfiguration(true, path, cap));
  for (const bad of [undefined, "", "relative/ffprobe", ` ${path}`, `${path}\0bad`]) assert.throws(() => a.readOwnerWan27VideoEditOperatorConfiguration(true, bad, undefined));
});
