#!/usr/bin/env node
import {
  loadRuntimeCapabilityOverlay,
  RuntimeCapabilityCatalog
} from "../dist/src/catalog/runtime-capability-catalog.js";
import { verifyRuntimeSourceArtifacts } from "../dist/src/catalog/runtime-source-verifier.js";

try {
  new RuntimeCapabilityCatalog();
  const result = await verifyRuntimeSourceArtifacts(
    loadRuntimeCapabilityOverlay()
  );
  process.stdout.write(
    `Runtime source manifest unchanged. artifacts=${result.verified_count}\n`
  );
} catch (error) {
  const code =
    error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "MANIFEST_INVALID";
  process.stderr.write(`Runtime source verification failed: ${code}.\n`);
  process.exitCode = 1;
}
