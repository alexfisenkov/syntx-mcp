import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createBoundedSourceGraph } from "../tools/settings-ir/bounded-source-graph.js";

function moduleInput(id: string, file_name: string, source: string) {
  const bytes = new TextEncoder().encode(source);
  return { id, file_name, bytes, sha256: createHash("sha256").update(bytes).digest("hex") };
}

function source(graph: ReturnType<typeof createBoundedSourceGraph>, ref: { module_id: string; start: number; end: number; kind: string }): string {
  return JSON.stringify(graph.inspect(ref));
}

test("resolves renamed cross-module exports and imports while preserving local shadowing", () => {
  const graph = createBoundedSourceGraph({ modules: [
    moduleInput("lib", "src/lib.js", "export function original(value) { return value.trim(); }"),
    moduleInput("app", "src/app.js", "import { original as clean } from './lib.js';\nfunction run(clean) { return clean.trim(); }\nexport const result = clean.trim('x');")
  ] });
  try {
    assert.deepEqual(graph.listModules().map((item) => item.id), ["lib", "app"]);
    const imports = graph.listImports("app");
    assert.equal(imports.items[0]?.specifier, "./lib.js");
    assert.equal(imports.items[0]?.resolved_module_id, "lib");
    assert.equal(imports.items[0]?.bindings[0]?.local_name, "clean");
    const declaration = imports.items[0]?.bindings[0]?.declaration;
    assert.ok(declaration);
    const shadow = graph.find({ module_id: "app", property_names: ["trim"] });
    const importTarget = graph.inspect(declaration);
    assert.equal(importTarget.symbol_declarations.some((ref) => ref.module_id === "lib"), true);
    assert.equal(shadow.refs.length, 2);
  } finally { graph.close(); }
});

test("lists exact exports and returned object methods with declaration and ordered body refs", () => {
  const graph = createBoundedSourceGraph({ modules: [moduleInput("factory", "factory.js", "function build(input) { return { run() { return input.trim(); }, input }; }\nexport { build as make }; ")] });
  try {
    const exported = graph.listExports("factory").items.find((item) => item.name === "make");
    assert.ok(exported?.declaration);
    const declaration = graph.inspect(exported.declaration);
    assert.equal(declaration.node.kind, "FunctionDeclaration");
    const returned = graph.find({ module_id: "factory", property_names: ["run"] });
    const method = graph.inspect(returned.refs[0]!);
    assert.equal(method.node.kind, "MethodDeclaration");
    assert.ok(method.symbol_declarations.some((ref) => ref.kind === "MethodDeclaration" && ref.module_id === "factory"));
    assert.ok(method.children.some((child) => child.category === "body" && child.refs.length > 0));
    assert.ok(method.children.some((child) => child.category === "parameters" && child.refs.length === 0));
  } finally { graph.close(); }
});

test("find and inspect expose only safe syntax metadata and caller-allowed literal values", () => {
  const graph = createBoundedSourceGraph({
    modules: [moduleInput("entry", "entry.js", "const privateValue = 'secret-ish'; const endpoint = '/public/path'; const value = api.send({ prompt: privateValue, mode: 'fast' });")],
    allowed_literals: ["/public/path", "fast"]
  });
  try {
    const matches = graph.find({ module_id: "entry", property_names: ["send", "prompt"], string_literals: ["/public/path", "fast", "secret-ish"] });
    assert.equal(matches.refs.length, 4);
    const inspected = matches.refs.map((ref) => source(graph, ref));
    assert.ok(inspected.some((text) => text.includes("/public/path")));
    assert.ok(inspected.some((text) => text.includes("fast")));
    assert.equal(inspected.some((text) => text.includes("secret-ish")), false);
  } finally { graph.close(); }
});

test("returns exact shape operators and ordered refs for calls, assignments, and members", () => {
  const graph = createBoundedSourceGraph({ modules: [moduleInput("shape", "shape.js", "function choose(flag, value) { const target = flag ? Math.round(value) : 0; target.value = value; return send(target, value); }")] });
  try {
    const member = graph.find({ module_id: "shape", property_names: ["round"] }).refs[0];
    assert.ok(member);
    const inspected = graph.inspect(member);
    assert.equal(inspected.node.kind, "PropertyAccessExpression");
    assert.ok(inspected.children.some((child) => child.category === "children" && child.refs.length === 2));
    const assignmentRef = graph.find({ module_id: "shape", property_names: ["value"] }).refs[0];
    assert.ok(assignmentRef);
    const assignment = graph.inspect(assignmentRef).parent_ref;
    assert.equal(assignment?.kind, "BinaryExpression");
    assert.equal(graph.inspect(assignment!).children.find((child) => child.category === "children")?.refs.length, 2);
  } finally { graph.close(); }
});

test("rejects malformed bytes, hash drift, duplicate identities, and invalid filenames", () => {
  const valid = moduleInput("m", "m.js", "export const x = 1;");
  assert.throws(() => createBoundedSourceGraph({ modules: [{ ...valid, sha256: "0".repeat(64) }] }));
  assert.throws(() => createBoundedSourceGraph({ modules: [{ ...valid, bytes: new Uint8Array([0xff]) }] }));
  assert.throws(() => createBoundedSourceGraph({ modules: [valid, valid] }));
  assert.throws(() => createBoundedSourceGraph({ modules: [{ ...valid, file_name: "../m.js" }] }));
  const oversized = new Uint8Array(512 * 1024 + 1);
  assert.throws(() => createBoundedSourceGraph({ modules: [{ ...valid, bytes: oversized, sha256: createHash("sha256").update(oversized).digest("hex") }] }));
  assert.throws(() => createBoundedSourceGraph({ modules: [moduleInput("bad", "bad.js", "function {")] }));
});

test("unresolved external imports are explicitly marked without returning their specifier", () => {
  const graph = createBoundedSourceGraph({ modules: [moduleInput("entry", "entry.js", "import token from 'private-package-name'; export { token };")] });
  try {
    const result = graph.listImports("entry");
    assert.equal(result.unresolved, 1);
    assert.equal(result.items[0]?.unresolved, true);
    assert.equal(result.items[0]?.specifier, null);
    assert.equal(JSON.stringify(result).includes("private-package-name"), false);
  } finally { graph.close(); }
});

test("enforces session, query, traversal, depth, and result caps with explicit markers", () => {
  const graph = createBoundedSourceGraph({ modules: [moduleInput("wide", "wide.js", `export const value = { ${Array.from({ length: 40 }, (_, index) => `p${index}: ${index}`).join(", ")} };`)] });
  const variable = graph.listExports("wide").items[0]?.declaration;
  assert.ok(variable);
  const initializer = graph.inspect(variable).children.find((child) => child.category === "initializer")?.refs[0];
  assert.ok(initializer);
  const result = graph.inspect(initializer);
  assert.equal(result.children.find((child) => child.category === "properties")?.truncated, true);
  assert.equal(result.children.find((child) => child.category === "properties")?.count, 40);
  for (let index = 0; index < 125; index += 1) graph.listModules();
  assert.throws(() => graph.listModules());
  graph.close();
});

test("close wipes owned byte buffers, clears retained graph state, and rejects future queries", () => {
  const input = moduleInput("one", "one.js", "export const one = 1;");
  const graph = createBoundedSourceGraph({ modules: [input] });
  graph.find({ module_id: "one", property_names: ["one"] });
  const closed = graph.close();
  assert.deepEqual(closed, { owned_bytes: 0, modules: 0, source_files: 0, refs: 0, program: 0, checker: 0 });
  assert.equal(input.bytes.every((byte) => byte === 0), false);
  assert.throws(() => graph.listModules());
});

test("inspection exposes bounded numeric, boolean, null, and safe name metadata across factory statements", () => {
  const graph = createBoundedSourceGraph({ modules: [moduleInput("wire", "wire.js", "export function make(a) { const M = Math.round(a * 100) / 100; const count = 2; const yes = true; const no = false; const empty = null; return { M, count, yes, no, empty, 'allowed-key': M, 'private-key': count }; }")] , allowed_literals: ["allowed-key"] });
  try {
    const root = graph.listExports("wire").items.find((item) => item.name === "make")?.declaration;
    assert.ok(root);
    const queue = [root];
    const records: Array<Record<string, unknown>> = [];
    while (queue.length > 0 && records.length < 256) {
      const current = queue.shift()!;
      const detail = graph.inspect(current) as unknown as Record<string, unknown>;
      records.push(detail);
      const groups = detail.children as Array<{ refs: typeof queue }>;
      for (const group of groups) queue.push(...group.refs);
    }
    const scalars = records.map((record) => record.scalar).filter(Boolean) as Array<Record<string, unknown>>;
    assert.ok(scalars.some((item) => item.kind === "number" && item.value === 100));
    assert.ok(scalars.some((item) => item.kind === "number" && item.value === 2));
    assert.ok(scalars.some((item) => item.kind === "boolean" && item.value === true));
    assert.ok(scalars.some((item) => item.kind === "boolean" && item.value === false));
    assert.ok(scalars.some((item) => item.kind === "null"));
    assert.ok(records.some((item) => item.identifier_name === "Math"));
    assert.ok(records.some((item) => item.property_name === "round"));
    assert.ok(records.some((item) => item.property_name === "allowed-key"));
    assert.equal(records.some((item) => item.property_name === "private-key"), false);
    assert.equal(graph.find({ module_id: "wire", property_names: ["M"] }).refs.length, 1);
  } finally { graph.close(); }
});

test("inspection reports complete symbol declaration count when returned refs are capped", () => {
  const overloads = `${Array.from({ length: 35 }, () => "function overloaded(value) { return value; }").join("\n")}\nexport { overloaded };`;
  const graph = createBoundedSourceGraph({ modules: [moduleInput("overloads", "overloads.js", overloads)] });
  try {
    const declaration = graph.listExports("overloads").items[0]?.declaration;
    assert.ok(declaration);
    const inspected = graph.inspect(declaration) as unknown as Record<string, unknown>;
    assert.equal(inspected.symbol_declaration_count, 35);
    assert.equal(inspected.symbol_declarations_truncated, true);
    assert.equal((inspected.symbol_declarations as unknown[]).length, 32);
    assert.equal(inspected.truncated, true);
  } finally { graph.close(); }
});

test("source byte admission never invokes shadow methods, getters, proxies, subclasses, or shared storage", () => {
  const shadowedSlice = moduleInput("slice", "slice.js", "export const value = 1;");
  let called = 0;
  Object.defineProperty(shadowedSlice.bytes, "slice", { value: () => { called += 1; throw new Error("must not call"); } });
  assert.throws(() => createBoundedSourceGraph({ modules: [shadowedSlice] }));
  assert.equal(called, 0);

  const shadowedLength = moduleInput("length", "length.js", "export const value = 1;");
  Object.defineProperty(shadowedLength.bytes, "byteLength", { get() { called += 1; throw new Error("must not call"); } });
  assert.throws(() => createBoundedSourceGraph({ modules: [shadowedLength] }));
  assert.equal(called, 0);

  const subclassBytes = new (class extends Uint8Array {})(moduleInput("subclass", "subclass.js", "x").bytes);
  assert.throws(() => createBoundedSourceGraph({ modules: [{ ...moduleInput("subclass", "subclass.js", "x"), bytes: subclassBytes }] }));
  if (typeof SharedArrayBuffer !== "undefined") {
    const shared = new Uint8Array(new SharedArrayBuffer(1));
    shared[0] = 120;
    assert.throws(() => createBoundedSourceGraph({ modules: [{ ...moduleInput("shared", "shared.js", "x"), bytes: shared }] }));
  }
  let proxyTrap = 0;
  const proxied = new Proxy(moduleInput("proxy", "proxy.js", "x").bytes, { get() { proxyTrap += 1; throw new Error("must not call"); } });
  assert.throws(() => createBoundedSourceGraph({ modules: [{ ...moduleInput("proxy", "proxy.js", "x"), bytes: proxied }] }));
  assert.equal(proxyTrap, 0);

  const record = moduleInput("record", "record.js", "x");
  Object.defineProperty(record, "bytes", { get() { called += 1; throw new Error("must not call"); } });
  assert.throws(() => createBoundedSourceGraph({ modules: [record] }));
  assert.equal(called, 0);
});

test("returned shorthand includes its producer declaration and keeps a local parameter shadow", () => {
  const graph = createBoundedSourceGraph({ modules: [moduleInput("shorthand", "shorthand.js", "const send = () => 1; export function make() { return { send }; } export function shadow(send) { return { send }; }")] });
  try {
    const refs = graph.find({ module_id: "shorthand", property_names: ["send"] }).refs;
    assert.equal(refs.length, 2);
    const producer = graph.inspect(refs[0]!);
    const shadow = graph.inspect(refs[1]!);
    assert.ok(producer.symbol_declarations.some((ref) => ref.kind === "VariableDeclaration"));
    assert.ok(shadow.symbol_declarations.some((ref) => ref.kind === "Parameter"));
    assert.equal(shadow.symbol_declarations.some((ref) => ref.kind === "VariableDeclaration"), false);
  } finally { graph.close(); }
});
