import assert from "node:assert/strict";
import test from "node:test";
import { imageArtifactContent, imageArtifactContentForResult, imageArtifactResultJsonText } from "../src/mcp/image-artifact-content.js";

test("image artifact content links HTTPS image fields without changing result data", () => {
  const result = {
    status: "result_observed",
    artifact: { url: "https://cdn.example.test/final.png", mime_type: "image/png" }
  };
  const content = imageArtifactContentForResult(result);
  assert.equal(content.filter((item) => item.type === "resource_link").length, 1);
  assert.deepEqual(content.find((item) => item.type === "resource_link"), {
    type: "resource_link", name: "Generated image 1", uri: "https://cdn.example.test/final.png", mimeType: "image/png"
  });
  assert.equal(JSON.stringify(result), JSON.stringify({
    status: "result_observed", artifact: { url: "https://cdn.example.test/final.png", mime_type: "image/png" }
  }));
  assert.ok(content.some((item) => item.type === "text" && item.text.includes("![Generated image 1]")));
});

test("image artifact content deduplicates result lists and rejects unsafe URL forms", () => {
  const content = imageArtifactContentForResult({
    artifacts: [
      { url: "https://cdn.example.test/final.png", mime_type: "image/png" },
      { url: "https://cdn.example.test/final.png", mime_type: "image/png" },
      { url: "javascript:alert(1)", mime_type: "image/png" },
      { url: "https://user:secret@cdn.example.test/private.png", mime_type: "image/png" },
      { url: "http://cdn.example.test/insecure.png", mime_type: "image/png" }
    ]
  });
  const links = content.filter((item) => item.type === "resource_link");
  assert.equal(links.length, 1);
  assert.equal(links[0]?.type === "resource_link" ? links[0].uri : "", "https://cdn.example.test/final.png");
  assert.equal(content.some((item) => item.type === "text" && item.text.includes("secret")), false);
});

test("image artifact content supports the common images collection shape", () => {
  const content = imageArtifactContentForResult({
    images: [{ url: "https://cdn.example.test/one.webp", mime_type: "image/webp" }]
  });
  assert.equal(content.filter((item) => item.type === "resource_link").length, 1);
});

test("image artifact content with no source HTTPS URLs produces no added blocks", () => {
  assert.deepEqual(imageArtifactContent([{ url: "data:image/png;base64,AA==" }]), []);
});

test("artifact text serialization redacts URL credentials without mutating structured data", () => {
  const result = { artifacts: [{ url: "https://user:secret@cdn.example.test/private.png", mime_type: "image/png" }] };
  assert.equal(imageArtifactResultJsonText(result).includes("secret"), false);
  assert.equal(result.artifacts[0]?.url, "https://user:secret@cdn.example.test/private.png");
});
