import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeOwnerWanImagePrompt,
  OwnerWanImagePromptError
} from "../src/application/owner-wan-image-prompt.js";

test("WAN prompt admission preserves explicit text and counts LF and surrogate-pair emoji as source does", () => {
  const original = "  a\n😀 ";
  const result = normalizeOwnerWanImagePrompt({ variant: "wan_25_i2i_preview", prompt: original });
  assert.equal(result.variant, "wan_25_i2i_preview");
  assert.equal(result.prompt, original);
  assert.equal(result.length_units, 8);
  assert.equal(result.maximum_units, 1_500);
  assert.equal(result.unit, "JS_UTF16_CODE_UNITS_PLUS_LF_COUNT");
  assert.equal(result.limit_confidence, "SOURCE_UI_BEHAVIOR_NOT_BACKEND_LIMIT");
  assert.equal(result.local_character_guard, "REJECT_MALFORMED_UNICODE_AND_C0_C1_CONTROLS_EXCEPT_TAB_LF_CR");
  assert.equal(result.character_guard_confidence, "LOCAL_INPUT_SAFETY_GUARD_NOT_PROVIDER_CONTRACT");
});

test("WAN prompt exact source boundaries are accepted while one additional weighted unit is rejected", () => {
  const cases = [
    { variant: "wan_25_i2i_preview", maximum: 1_500 },
    { variant: "wan_26_image", maximum: 1_500 },
    { variant: "wan_27_image", maximum: 5_000 },
    { variant: "wan_27_image_pro", maximum: 5_000 }
  ] as const;
  for (const item of cases) {
    const accepted = normalizeOwnerWanImagePrompt({ variant: item.variant, prompt: "x".repeat(item.maximum) });
    assert.equal(accepted.length_units, item.maximum);
    assert.equal(accepted.backend_limit, "UNPROVEN");
    assert.throws(() => normalizeOwnerWanImagePrompt({ variant: item.variant, prompt: "x".repeat(item.maximum + 1) }),
      (error: unknown) => error instanceof OwnerWanImagePromptError && error.code === "PROMPT_TOO_LONG");
  }
  assert.equal(normalizeOwnerWanImagePrompt({ variant: "wan_25_i2i_preview", prompt: `${"x".repeat(1_498)}\n` }).length_units, 1_500);
  assert.throws(() => normalizeOwnerWanImagePrompt({ variant: "wan_25_i2i_preview", prompt: `${"x".repeat(1_499)}\n` }),
    (error: unknown) => error instanceof OwnerWanImagePromptError && error.code === "PROMPT_TOO_LONG");
});

test("WAN prompt rejects malformed, unsafe, blank, unknown-variant, accessor, and proxy input locally", () => {
  const invalidCases: unknown[] = [
    { variant: "other", prompt: "text" },
    { variant: "wan_27_image", prompt: " \n\t " },
    { variant: "wan_27_image", prompt: "unsafe\u0000text" },
    { variant: "wan_27_image", prompt: "\ud800" },
    { variant: "wan_27_image", prompt: "text", extra: true },
    { variant: "wan_27_image", prompt: 4 }
  ];
  for (const input of invalidCases) {
    assert.throws(() => normalizeOwnerWanImagePrompt(input),
      (error: unknown) => error instanceof OwnerWanImagePromptError && error.code === "INVALID_PROMPT");
  }

  let getterCalls = 0;
  const accessorInput = Object.defineProperties({}, {
    variant: { enumerable: true, get() { getterCalls += 1; return "wan_27_image"; } },
    prompt: { enumerable: true, get() { getterCalls += 1; return "text"; } }
  });
  assert.throws(() => normalizeOwnerWanImagePrompt(accessorInput), OwnerWanImagePromptError);
  assert.equal(getterCalls, 0);

  let proxyTrapCalls = 0;
  const proxyInput = new Proxy({ variant: "wan_27_image", prompt: "text" }, {
    ownKeys(target) { proxyTrapCalls += 1; return Reflect.ownKeys(target); }
  });
  assert.throws(() => normalizeOwnerWanImagePrompt(proxyInput), OwnerWanImagePromptError);
  assert.equal(proxyTrapCalls, 0);
});
