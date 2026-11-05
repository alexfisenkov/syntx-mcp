import assert from "node:assert/strict";
import test from "node:test";
import { normalizeOwnerSeedanceEditorParameters } from "../src/application/owner-seedance-editor-parameters.js";

test("Editor reserves provider reference markers for owned frame serialization", () => {
  const input = { model_id: "seedance-2.5-editor", resolution: "720p", prompt: "Animate https://example.com and <<<literal text>>>" };
  assert.equal(normalizeOwnerSeedanceEditorParameters(input).intent.prompt, input.prompt);
  assert.throws(() => normalizeOwnerSeedanceEditorParameters({ ...input, prompt: "Animate <<<https://example.com/foreign.png>>>" }),
    (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "INVALID_PARAMETERS"));
});
