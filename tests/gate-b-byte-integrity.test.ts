import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

interface ProtectedGateBFile {
  readonly label: string;
  readonly path: string;
  readonly sha256: string;
}

const PROTECTED_GATE_B_FILES: readonly ProtectedGateBFile[] = [
  {
    label: "artifact",
    path: join(
      "catalog",
      "runtime",
      "v1",
      "normalized-settings-parser-canary.json"
    ),
    sha256:
      "018cda7ac6a4baf31988a62e18020a24b9055baa2c5d67298218794d7c2ffdda"
  },
  {
    label: "schema",
    path: join("src", "catalog", "normalized-settings-parser-canary.ts"),
    sha256:
      "3686e93da2fe4042bced3bcd58f4ad4c25cb6bb7f35ecd54d0baf955c0c4c126"
  },
  {
    label: "adapter",
    path: join("tools", "settings-ir", "build-banana-parser-canary.ts"),
    sha256:
      "63658267a85d164423504d7d25e3d9e19351c85dd68682147a5fac7b99d92c62"
  },
  {
    label: "loader",
    path: join("tools", "settings-ir", "pinned-settings-source-loader.ts"),
    sha256:
      "ee7042a889446cd4c6f2be9b6e5730754f5d3616af7467f65e705c3d168470bf"
  },
  {
    label: "compiler",
    path: join("tools", "settings-ir", "static-settings-compiler.ts"),
    sha256:
      "e196673d2071f892a413a7b8af7f4e8c4cdea0bf28316e987a12301742492870"
  },
  {
    label: "CLI",
    path: join("scripts", "sync-normalized-settings-parser-canary.mjs"),
    // Updated 2026-09-03 (DEBT-014 fix): deliberate change adding the
    // --confirm-source-fetch gate to the two network source modes. The CLI
    // script's own bytes are not part of any implementation_components hash
    // binding (unlike the two C1a files under DEBT-019), so this update does
    // not affect any published artifact's provability.
    sha256:
      "ba39217ada2b64f3c0df1a43a101992f64affb98e8b8e41025a7a71dd7ce2cae"
  }
];

test("Gate B protected files retain their exact checkpoint bytes", async () => {
  const failures: string[] = [];

  for (const protectedFile of PROTECTED_GATE_B_FILES) {
    let bytes: Buffer;
    try {
      bytes = await readFile(protectedFile.path);
    } catch {
      failures.push(
        `${protectedFile.label} (${protectedFile.path}): missing or unreadable`
      );
      continue;
    }

    const actualSha256 = createHash("sha256").update(bytes).digest("hex");
    if (actualSha256 !== protectedFile.sha256) {
      failures.push(
        `${protectedFile.label} (${protectedFile.path}): SHA-256 mismatch; expected ${protectedFile.sha256}, actual ${actualSha256}`
      );
    }
  }

  assert.deepEqual(
    failures,
    [],
    `Gate B byte-integrity checkpoint failed:\n${failures.join("\n")}`
  );
});
