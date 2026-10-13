import { sha256CanonicalPayload } from "../../../src/catalog/syntx-public-catalog.js";
import {
  rootOnlyResultV5Schema,
  type RootOnlyResultV5
} from "../../../src/catalog/settings-root-only-result-v5.js";
import { buildRootOnlyResultV5 } from "./compile-root-only.js";
import { loadRootOnlyScopeV5, fetchPinnedRootBundleV5 } from "./pinned-root-bundle.js";
import { collectRootOnlyV5ImplementationComponents } from "./implementation-graph.js";

export { collectRootOnlyV5ImplementationComponents } from "./implementation-graph.js";

export class RootOnlyToolchainV5Error extends Error {
  constructor(readonly code: "SETTINGS_V5_SOURCE_FETCH_NOT_CONFIRMED" | "SETTINGS_V5_RELATIONSHIP_DRIFT" | "SETTINGS_V5_TOOLCHAIN_INVALID") {
    super("The root-only settings toolchain could not complete safely.");
    this.name = "RootOnlyToolchainV5Error";
  }
}

export async function buildRootOnlyResultV5FromPinnedSource(input: {
  projectRoot: string;
  formId: string;
  confirmedSourceFetch: true;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}): Promise<RootOnlyResultV5> {
  if (input.confirmedSourceFetch !== true) throw new RootOnlyToolchainV5Error("SETTINGS_V5_SOURCE_FETCH_NOT_CONFIRMED");
  const scope = loadRootOnlyScopeV5(input.projectRoot, input.formId);
  const components = collectRootOnlyV5ImplementationComponents(input.projectRoot);
  const material = await fetchPinnedRootBundleV5(scope, {
    confirmedSourceFetch: true,
    ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
    ...(input.signal ? { signal: input.signal } : {})
  });
  const result = buildRootOnlyResultV5({
    material, implementationComponents: components, generatedAt: new Date().toISOString()
  });
  assertRootOnlyResultV5MatchesCurrentCheckout(result, input.projectRoot);
  return result;
}

/** No fetch, compile, or write; current evidence, source TS and emitted ESM bytes. */
export function assertRootOnlyResultV5MatchesCurrentCheckout(result: unknown, projectRoot: string): void {
  const parsed = rootOnlyResultV5Schema.safeParse(result);
  if (!parsed.success) throw new RootOnlyToolchainV5Error("SETTINGS_V5_TOOLCHAIN_INVALID");
  const currentScope = loadRootOnlyScopeV5(projectRoot, parsed.data.scope.form_id);
  const currentComponents = collectRootOnlyV5ImplementationComponents(projectRoot);
  if (sha256CanonicalPayload(parsed.data.scope) !== sha256CanonicalPayload(currentScope) ||
      sha256CanonicalPayload(parsed.data.toolchain.implementation_components) !== sha256CanonicalPayload(currentComponents)) {
    throw new RootOnlyToolchainV5Error("SETTINGS_V5_RELATIONSHIP_DRIFT");
  }
}
