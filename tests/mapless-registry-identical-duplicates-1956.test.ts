import assert from "node:assert/strict";
import test from "node:test";
import { parseMaplessRegistryForms } from "../tools/mapless-settings-ast.js";

test("deduplicates identical repeated Topaz and Suno registry mappings and returns sorted forms", () => {
  const source = `const R={
    "./forms/settings/topaz-ai.vue":()=>import("./topaz-ai.js"),
    "./forms/settings/suno.vue":()=>import("./suno.js"),
    "./forms/settings/topaz-ai.vue":()=>import("./topaz-ai.js"),
    "./forms/settings/suno.vue":()=>import("./suno.js")
  };`;
  assert.deepEqual(parseMaplessRegistryForms(source), [
    { form_id: "suno", module_name: "suno.js" },
    { form_id: "topaz-ai", module_name: "topaz-ai.js" }
  ]);
});

test("rejects one form mapped to conflicting module basenames", () => {
  const source = `const R={
    "./forms/settings/topaz-ai.vue":()=>import("./topaz-ai.js"),
    "./forms/settings/topaz-ai.vue":()=>import("./different.js")
  };`;
  assert.throws(() => parseMaplessRegistryForms(source), /MAPLESS_REGISTRY_MAPPING_INVALID/u);
});

test("rejects different forms mapped to one module basename", () => {
  const source = `const R={
    "./forms/settings/topaz-ai.vue":()=>import("./shared.js"),
    "./forms/settings/suno.vue":()=>import("./shared.js")
  };`;
  assert.throws(() => parseMaplessRegistryForms(source), /MAPLESS_REGISTRY_MAPPING_INVALID/u);
});

test("keeps nonliteral, invalid-path, and malformed-form mappings rejected", () => {
  for (const source of [
    `const R={"./forms/settings/topaz-ai.vue":()=>import(resolveModule())};`,
    `const R={"./forms/settings/topaz-ai.vue":()=>import("../topaz-ai.js")};`,
    `const R={"./forms/settings/topaz-ai.vue":()=>{import("./topaz-ai.js");import("./extra.js");}};`,
    `const R={"./forms/settings/../topaz-ai.vue":()=>import("./topaz-ai.js")};`
  ]) assert.throws(() => parseMaplessRegistryForms(source), /MAPLESS_REGISTRY_MAPPING_INVALID/u);
});
