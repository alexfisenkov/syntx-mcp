import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createBoundedSourceGraph } from "../tools/settings-ir/bounded-source-graph.js";

function input(source: string) {
  const bytes = new TextEncoder().encode(source);
  return { id: "tree", file_name: "tree.js", bytes, sha256: createHash("sha256").update(bytes).digest("hex") };
}

test("subtree returns ordered bounded syntax facts with redacted strings and alias refs", () => {
  const graph = createBoundedSourceGraph({ modules: [input("const alias=2; const value=call({privateText:'secret', safe:'allowed', key: Math.round(alias+1), alias});")], allowed_literals: ["allowed"] });
  try {
    const key = graph.find({ module_id: "tree", property_names: ["key"] }).refs[0]!;
    const root = graph.inspect(key).parent_ref!;
    const result = graph.inspectSubtree(root);
    assert.equal(result.nodes[0]?.depth, 0);
    assert.ok(result.nodes.some((item) => item.fact.operator === "+"));
    assert.ok(result.nodes.some((item) => item.fact.literal && "redacted" in item.fact.literal));
    assert.ok(result.nodes.some((item) => item.fact.literal && "value" in item.fact.literal && item.fact.literal.value === "allowed"));
    assert.ok(result.nodes.some((item) => item.fact.symbol_declarations.length > 0));
    assert.equal(result.visited, result.nodes.length);
    assert.equal(result.truncated, false);
  } finally { graph.close(); }
});

test("subtree reports depth and node truncation and rejects refs after close", () => {
  const graph = createBoundedSourceGraph({ modules: [input("call({a:{b:{c:1}},d:2,e:3})")] });
  const root = graph.find({ module_id: "tree", property_names: ["a"] }).refs[0]!;
  const shallow = graph.inspectSubtree(root, { max_depth: 1 });
  assert.equal(shallow.truncated, true);
  assert.equal(shallow.capped, true);
  const small = graph.inspectSubtree(root, { max_nodes: 2 });
  assert.equal(small.visited, 2);
  assert.equal(small.truncated, true);
  assert.equal(small.capped, true);
  graph.close();
  assert.throws(() => graph.inspectSubtree(root), { code: "BOUNDED_SOURCE_GRAPH_INVALID" });
});

test("subtree rejects malformed limits without invoking option getters", () => {
  const graph = createBoundedSourceGraph({ modules: [input("const x={a:1}")] });
  const ref = graph.find({ module_id: "tree", property_names: ["x"] }).refs[0]!;
  let touched = 0;
  const options = Object.defineProperty({}, "max_nodes", { get() { touched += 1; return 1; } });
  assert.throws(() => graph.inspectSubtree(ref, options), { code: "BOUNDED_SOURCE_GRAPH_INVALID" });
  assert.throws(() => graph.inspectSubtree(ref, { max_depth: 9 }), { code: "BOUNDED_SOURCE_GRAPH_INVALID" });
  assert.equal(touched, 0);
  graph.close();
});
