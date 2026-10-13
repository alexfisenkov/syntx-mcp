import { createHash } from "node:crypto";
import { isProxy } from "node:util/types";
import { z } from "zod/v4";
import { sha256CanonicalPayload } from "../../../src/catalog/syntx-public-catalog.js";
import {
  rootOnlyResultV5Schema, rootOnlyScopeV5Schema,
  rootOnlyImplementationComponentsV5Schema,
  type RootOnlyImplementationComponentV5, type RootOnlyResultV5
} from "../../../src/catalog/settings-root-only-result-v5.js";
import { compileStaticSettingsVueSfc } from "../static-settings-compiler.js";
import type { VerifiedRootBundleV5 } from "./pinned-root-bundle.js";

export class RootOnlyCompilationV5Error extends Error {
  constructor(readonly code: "SETTINGS_V5_MATERIAL_INVALID" | "SETTINGS_V5_ROOT_COMPILATION_FAILED") {
    super("The root-only v5 settings compilation could not complete safely.");
    this.name = "RootOnlyCompilationV5Error";
  }
}

/** Compiles the root once for switchx. Auxiliary content is verified, never compiled. */
export function buildRootOnlyResultV5(input: {
  material: VerifiedRootBundleV5;
  implementationComponents: readonly RootOnlyImplementationComponentV5[];
  generatedAt: string;
}): RootOnlyResultV5 {
  let scope: z.infer<typeof rootOnlyScopeV5Schema>;
  let rootContent: string;
  let implementationComponents: RootOnlyImplementationComponentV5[];
  let generatedAt: unknown;
  try {
    const request = ownDataRecord(input, ["material", "implementationComponents", "generatedAt"]);
    const material = ownDataRecord(request.material, ["scope", "sources"]);
    scope = rootOnlyScopeV5Schema.parse(material.scope);
    implementationComponents = rootOnlyImplementationComponentsV5Schema.parse(request.implementationComponents);
    generatedAt = request.generatedAt;
    const sources = sourceArray(material.sources);
    const verifiedContent: string[] = [];
    for (let index = 0; index < scope.sources.length; index += 1) {
      const expected = scope.sources[index]!;
      const candidate = ownDataRecord(sources[index], [
        "content", "role", "source_content_sha256", "source_index", "source_path", "source_ref_id"
      ]);
      const { content, ...descriptor } = candidate;
      if (typeof content !== "string" || Buffer.byteLength(content) > 1_048_576 ||
          Buffer.from(content).toString("utf8") !== content ||
          sha256CanonicalPayload(descriptor) !== sha256CanonicalPayload(expected) ||
          `sha256:${createHash("sha256").update(content).digest("hex")}` !== expected.source_content_sha256) throw new Error();
      verifiedContent.push(content);
    }
    rootContent = verifiedContent[1]!;
  } catch { throw new RootOnlyCompilationV5Error("SETTINGS_V5_MATERIAL_INVALID"); }

  try {
    const compiled = compileStaticSettingsVueSfc({ source: rootContent, modelId: scope.model_ids[0] });
    if (compiled.bindings.AI_NAME.status !== "PROVEN" || compiled.bindings.AI_NAME.value !== scope.ai_name) throw new Error();
    return rootOnlyResultV5Schema.parse({
      schema_version: "1.0.0",
      catalog_kind: "OBSERVED_SETTINGS_ROOT_ONLY_WITH_AUXILIARIES",
      runtime_usable: false,
      compilation_status: "PARTIAL_COMPILED",
      generated_at: generatedAt,
      scope,
      verification: {
        status: "ALL_DECLARED_PINNED_BYTES_MATCHED", fetched_artifacts: 2,
        verified_source_ref_ids: scope.sources.map((source) => source.source_ref_id)
      },
      root_results: [{
        model_id: compiled.model_id, source_ref_id: scope.root_source_ref_id,
        proof_scope: "ROOT_FILE_MODEL_CONTEXT_ONLY", compiler_status: compiled.compilation_status,
        bindings: compiled.bindings, blockers: compiled.blockers
      }],
      closure: { status: "OPEN", blockers: [
        { code: "AUXILIARY_SOURCE_NOT_COMPILED", source_ref_id: scope.auxiliary_source_ref_ids[0], compilation_status: "NOT_COMPILED" },
        { code: "DEPENDENCY_GRAPH_UNRESOLVED" },
        { code: "PAYLOAD_PROJECTION_UNVERIFIED" },
        { code: "BACKEND_RUNTIME_EQUIVALENCE_UNVERIFIED" }
      ] },
      coverage: { declared_source_refs: 2, verified_source_refs: 2, compiled_source_units: 1,
        uncompiled_auxiliary_source_refs: 1, compiled_model_contexts: 1 },
      toolchain: { implementation_components: implementationComponents,
        implementation_set_sha256: sha256CanonicalPayload(implementationComponents) }
    });
  } catch { throw new RootOnlyCompilationV5Error("SETTINGS_V5_ROOT_COMPILATION_FAILED"); }
}

function ownDataRecord(value: unknown, expectedKeys: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || isProxy(value) || Array.isArray(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) throw new Error();
  const keys = Reflect.ownKeys(value);
  if (keys.length !== expectedKeys.length || keys.some((key) => typeof key !== "string" || !expectedKeys.includes(key))) throw new Error();
  const copy: Record<string, unknown> = {};
  for (const key of expectedKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) throw new Error();
    copy[key] = descriptor.value;
  }
  return copy;
}

function sourceArray(value: unknown): unknown[] {
  if (typeof value !== "object" || value === null || isProxy(value) || !Array.isArray(value) ||
      value.length !== 2 || Reflect.ownKeys(value).length !== 3) throw new Error();
  return [0, 1].map((index) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) throw new Error();
    return descriptor.value as unknown;
  });
}
