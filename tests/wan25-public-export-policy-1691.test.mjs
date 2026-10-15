import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { readPublicSourcePolicy } from "../scripts/export-public-snapshot.mjs";

const POLICY_PATH = fileURLToPath(new URL("../tools/publication/public-source-policy.json", import.meta.url));
const WAN25_DOC = "docs/интеграция/WAN-2.5-Preview-MCP.md";

test("public-source export permits exactly the WAN25 preview integration doc without widening docs", () => {
  const policy = readPublicSourcePolicy(readFileSync(POLICY_PATH));
  assert.deepEqual(policy.bootstrap_paths, [
    ".github/workflows/verify.yml", ".gitignore", "AGENTS.md", "README.md", "SECURITY.md",
    "docs/интеграция/Inpaint-источники-и-границы.md", "docs/интеграция/Обновление-MCP.md",
    "docs/модели/WAN-image-источники-и-параметры.md", WAN25_DOC
  ]);
  assert.deepEqual(policy.excluded_prefixes, ["docs"]);
  assert.deepEqual(policy.excluded_roots, [".autopilot", ".журналы", "docs/контроль", "docs/проект"]);
  assert.equal(policy.bootstrap_paths.filter((path) => path.startsWith("docs/")).length, 4);
  assert.equal(policy.bootstrap_paths.includes("docs/интеграция/private-history.md"), false);
});
