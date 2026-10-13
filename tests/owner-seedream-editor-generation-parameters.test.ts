import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeOwnerSeedreamEditorGenerationParameters,
  OwnerSeedreamEditorGenerationParametersError
} from "../src/application/owner-seedream-editor-generation-parameters.js";

const independentMatrix = [
  ["seedream-4", ["1K", "2K", "4K"]],
  ["seedream-4.5", ["2K", "4K"]],
  ["seedream-5", ["2K", "3K", "4K"]],
  ["seedream-5.0-flash", ["1K", "1.5K", "2K"]],
  ["seedream-5.0-pro", ["1K", "2K"]]
] as const;
const ratios = ["21:9", "16:9", "3:2", "4:3", "1:1", "3:4", "2:3", "9:16"] as const;

function invalid(action: () => unknown): void {
  assert.throws(action, (error: unknown) => error instanceof OwnerSeedreamEditorGenerationParametersError &&
    (error as OwnerSeedreamEditorGenerationParametersError).code === "INVALID_PARAMETERS");
}

test("requires every explicit one of the independently enumerated 104 model-control pairs", () => {
  let combinations = 0;
  for (const [variant, resolutions] of independentMatrix) {
    for (const aspect_ratio of ratios) {
      for (const resolution of resolutions) {
        const normalized = normalizeOwnerSeedreamEditorGenerationParameters({
          variant, prompt: "  Лес 🌲\n描写  ", parameters: { aspect_ratio, resolution }
        });
        assert.deepEqual(normalized, { variant, prompt: "  Лес 🌲\n描写  ", parameters: { aspect_ratio, resolution } });
        assert.equal(Object.isFrozen(normalized), true);
        assert.equal(Object.isFrozen(normalized.parameters), true);
        combinations += 1;
      }
    }
  }
  assert.equal(combinations, 104);
});

test("rejects empty, whitespace-only, and malformed Unicode prompts while preserving valid text", () => {
  for (const prompt of ["", " \t\n ", "bad\ud800", "bad\udc00"]) {
    invalid(() => normalizeOwnerSeedreamEditorGenerationParameters({
      variant: "seedream-5.0-pro", prompt, parameters: { aspect_ratio: "1:1", resolution: "2K" }
    }));
  }
  const prompt = "  Снег ☃️ — изображение\n二\0  ";
  assert.equal(normalizeOwnerSeedreamEditorGenerationParameters({
    variant: "seedream-5.0-pro", prompt, parameters: { aspect_ratio: "1:1", resolution: "2K" }
  }).prompt, prompt);
});

test("enforces only the explicit 32 KiB local UTF-8 resource bound at and above the boundary", () => {
  const exact = "я".repeat(16 * 1024);
  const over = `${exact}я`;
  assert.equal(Buffer.byteLength(exact, "utf8"), 32 * 1024);
  assert.equal(normalizeOwnerSeedreamEditorGenerationParameters({
    variant: "seedream-5.0-pro", prompt: exact, parameters: { aspect_ratio: "1:1", resolution: "2K" }
  }).prompt, exact);
  invalid(() => normalizeOwnerSeedreamEditorGenerationParameters({
    variant: "seedream-5.0-pro", prompt: over, parameters: { aspect_ratio: "1:1", resolution: "2K" }
  }));
});

test("copies and freezes its closed input, rejecting aliases, extra protocol fields, getters, proxies, and revoked proxies", () => {
  const parameters = { aspect_ratio: "16:9", resolution: "2K" };
  const input = { variant: "seedream-5.0-pro", prompt: "A clear prompt", parameters };
  const result = normalizeOwnerSeedreamEditorGenerationParameters(input);
  parameters.aspect_ratio = "1:1";
  input.prompt = "mutated";
  assert.deepEqual(result, { variant: "seedream-5.0-pro", prompt: "A clear prompt", parameters: { aspect_ratio: "16:9", resolution: "2K" } });

  for (const candidate of [
    { variant: "seedream-editor", prompt: "x", parameters: { aspect_ratio: "1:1", resolution: "2K" } },
    { variant: "seedream-4", prompt: "x", parameters: { aspect_ratio: "1:1", resolution: "1.5K" } },
    { variant: "seedream-5.0-pro", prompt: "x", parameters: { aspect_ratio: "1:1", resolution: "2K", stream: false } },
    { variant: "seedream-5.0-pro", prompt: "x", parameters: { aspect_ratio: "1:1", resolution: "2K" }, file_urls: [] },
    { variant: "seedream-5.0-pro", prompt: "x", parameters: { aspect_ratio: "1:1", resolution: "2K" }, n: 1 }
  ]) invalid(() => normalizeOwnerSeedreamEditorGenerationParameters(candidate));

  let getterReads = 0;
  const accessor = Object.defineProperty({ prompt: "x", parameters: { aspect_ratio: "1:1", resolution: "2K" } }, "variant", {
    enumerable: true, get() { getterReads += 1; return "seedream-5.0-pro"; }
  });
  invalid(() => normalizeOwnerSeedreamEditorGenerationParameters(accessor));
  assert.equal(getterReads, 0);

  let proxyTraps = 0;
  const hostile = new Proxy({}, { getOwnPropertyDescriptor() { proxyTraps += 1; throw new Error("trap invoked"); } });
  invalid(() => normalizeOwnerSeedreamEditorGenerationParameters(hostile));
  assert.equal(proxyTraps, 0);

  const revoked = Proxy.revocable({ variant: "seedream-5.0-pro", prompt: "x", parameters: { aspect_ratio: "1:1", resolution: "2K" } }, {});
  revoked.revoke();
  invalid(() => normalizeOwnerSeedreamEditorGenerationParameters(revoked.proxy));

  const revokedParameters = Proxy.revocable({ aspect_ratio: "1:1", resolution: "2K" }, {});
  revokedParameters.revoke();
  invalid(() => normalizeOwnerSeedreamEditorGenerationParameters({
    variant: "seedream-5.0-pro", prompt: "x", parameters: revokedParameters.proxy
  }));
});
