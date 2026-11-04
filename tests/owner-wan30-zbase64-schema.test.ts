import assert from "node:assert/strict";
import test from "node:test";
import { OWNER_WAN30_FIRST_LAST_TOOL_INPUT_SCHEMAS } from "../src/mcp/owner-wan30-first-last-video-tools.js";
import { OWNER_WAN30_EDIT_TOOL_INPUT_SCHEMAS } from "../src/mcp/owner-wan30-edit-video-tools.js";
import { OWNER_WAN30_OMNI_TOOL_INPUT_SCHEMAS } from "../src/mcp/owner-wan30-omni-video-tools.js";
import { OWNER_WAN30_REFERENCE_TOOL_INPUT_SCHEMAS } from "../src/mcp/owner-wan30-reference-video-tools.js";

test("WAN 3.0 upload Zod schemas accept the same large canonical Base64 body", () => {
  const content_base64 = Buffer.alloc(3_945_971, 0x5a).toString("base64");
  assert.equal(content_base64.length, 5_261_296);
  const cases = [
    [OWNER_WAN30_FIRST_LAST_TOOL_INPUT_SCHEMAS.upload, { link_attempt_id: "link_wan30_first_last_000000000001",
      role: "first_frame", filename: "frame.jpg", mime_type: "image/jpeg", content_base64 }],
    [OWNER_WAN30_EDIT_TOOL_INPUT_SCHEMAS.upload, { link_attempt_id: "link_wan30_edit_000000000000001", filename: "source.mp4",
      mime_type: "video/mp4", content_base64 }],
    [OWNER_WAN30_OMNI_TOOL_INPUT_SCHEMAS.upload, { link_attempt_id: "link_wan30_omni_000000000000001", filename: "image.jpg",
      mime_type: "image/jpeg", content_base64 }],
    [OWNER_WAN30_REFERENCE_TOOL_INPUT_SCHEMAS.upload, { link_attempt_id: "link_wan30_reference_000000000001",
      filename: "image.jpg", mime_type: "image/jpeg", content_base64 }]
  ] as const;
  for (const [schema, input] of cases) assert.equal(schema.safeParse(input).success, true);
});
