import { createHash } from "node:crypto";
import { types as nodeTypes } from "node:util";
import ts from "typescript";

const NativeUint8Array = Uint8Array;
const nativeUint8ArrayPrototype = NativeUint8Array.prototype;
const typedArrayPrototype = Object.getPrototypeOf(nativeUint8ArrayPrototype) as object;
const typedArrayBufferGetter = Object.getOwnPropertyDescriptor(typedArrayPrototype, "buffer")?.get;
const typedArrayByteOffsetGetter = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteOffset")?.get;
const typedArrayByteLengthGetter = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteLength")?.get;
const arrayBufferByteLengthGetter = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")?.get;
const arrayBufferIsView = ArrayBuffer.isView;
const isProxy = nodeTypes.isProxy;
const getPrototypeOf = Object.getPrototypeOf;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const nativeApply = Reflect.apply;

export interface BoundedSourceModuleInput {
  id: string;
  file_name: string;
  bytes: Uint8Array;
  sha256: string;
}

export interface BoundedSourceGraphOptions {
  modules: readonly BoundedSourceModuleInput[];
  allowed_literals?: readonly string[];
}

export interface BoundedSourceNodeRef {
  module_id: string;
  start: number;
  end: number;
  kind: string;
}

export interface BoundedSourceGraph {
  listModules(): Array<{ id: string; file_name: string; bytes: number; sha256: string }>;
  listImports(module_id: string): { items: Array<{
    specifier: string | null;
    resolved_module_id: string | null;
    unresolved: boolean;
    bindings: Array<{ imported_name: string; local_name: string; declaration: BoundedSourceNodeRef | null }>;
    binding_count: number;
    bindings_truncated: boolean;
  }>; count: number; unresolved: number; truncated: boolean };
  listExports(module_id: string): { items: Array<{ name: string; declaration: BoundedSourceNodeRef | null }>; count: number; truncated: boolean };
  find(input: { module_id: string; property_names?: readonly string[]; string_literals?: readonly string[] }): {
    refs: BoundedSourceNodeRef[]; count: number; visits: number; truncated: boolean; capped: boolean;
  };
  inspect(nodeRef: BoundedSourceNodeRef): {
    node: BoundedSourceNodeRef;
    parent_ref: BoundedSourceNodeRef | null;
    operator?: string;
    symbol_declarations: BoundedSourceNodeRef[];
    symbol_declaration_count: number;
    symbol_declarations_truncated: boolean;
    identifier_name?: string;
    property_name?: string;
    scalar?: { kind: "number"; value: number } | { kind: "boolean"; value: boolean } | { kind: "null" };
    literal?: { allowed: true; value: string } | { allowed: false; length: number; sha256: string; redacted: true };
    children: Array<{ category: string; refs: BoundedSourceNodeRef[]; count: number; truncated: boolean }>;
    truncated: boolean;
  };
  inspectSubtree(nodeRef: BoundedSourceNodeRef, options?: { max_nodes?: number; max_depth?: number }): {
    nodes: Array<{ depth: number; fact: ReturnType<BoundedSourceGraph["inspect"]> }>;
    visited: number; truncated: boolean; capped: boolean;
  };
  close(): { owned_bytes: number; modules: number; source_files: number; refs: number; program: number; checker: number };
}

export class BoundedSourceGraphError extends Error {
  readonly code = "BOUNDED_SOURCE_GRAPH_INVALID";
  constructor() { super("The bounded source graph input or query is invalid."); this.name = "BoundedSourceGraphError"; }
}

interface ModuleEntry {
  id: string;
  file_name: string;
  path: string;
  bytes: Uint8Array;
  sha256: string;
  text: string;
  source: ts.SourceFile;
}

const MAX_MODULES = 8;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024;
const MAX_QUERIES = 128;
const MAX_FIND_VISITS = 8_000;
const MAX_FIND_DEPTH = 32;
const MAX_FIND_REFS = 80;
const MAX_INSPECT_REFS = 32;
const MAX_LIST_ITEMS = 256;

export function createBoundedSourceGraph(options: BoundedSourceGraphOptions): BoundedSourceGraph {
  const optionRecord = readPlainRecord(options);
  const moduleInputs = readPlainArray(ownData(optionRecord, "modules"), MAX_MODULES);
  if (moduleInputs.length === 0) throw new BoundedSourceGraphError();
  const literalInputs = hasOwnData(optionRecord, "allowed_literals") ? readPlainArray(ownData(optionRecord, "allowed_literals"), 2_000) : [];
  const entries = new Map<string, ModuleEntry>();
  const byId = new Map<string, ModuleEntry>();
  const owned: Uint8Array[] = [];
  const allowedLiterals = new Set<string>();
  for (const value of literalInputs) {
    if (typeof value !== "string" || value.length > 2_048) throw new BoundedSourceGraphError();
    allowedLiterals.add(value);
  }
  let totalBytes = 0;
  try {
    for (const rawInput of moduleInputs) {
      const input = readPlainRecord(rawInput);
      const id = ownData(input, "id");
      const file_name = ownData(input, "file_name");
      const sourceView = ownData(input, "bytes");
      const expectedHash = ownData(input, "sha256");
      if (typeof id !== "string" || !/^[A-Za-z0-9._-]{1,80}$/u.test(id) || byId.has(id) || typeof file_name !== "string" || !isCanonicalFileName(file_name) ||
          entries.has(`/__bounded__/${file_name}`) || typeof expectedHash !== "string" || !/^[a-f0-9]{64}$/u.test(expectedHash)) throw new BoundedSourceGraphError();
      const bytes = copyPlainUint8View(sourceView);
      owned.push(bytes);
      totalBytes += bytes.byteLength;
      if (totalBytes > MAX_TOTAL_BYTES) throw new BoundedSourceGraphError();
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      if (sha256 !== expectedHash) throw new BoundedSourceGraphError();
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      const path = `/__bounded__/${file_name}`;
      const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
      const entry: ModuleEntry = { id, file_name, path, bytes, sha256, text, source };
      entries.set(path, entry);
      byId.set(id, entry);
    }
  } catch (error) {
    for (const bytes of owned) bytes.fill(0);
    if (error instanceof BoundedSourceGraphError) throw error;
    throw new BoundedSourceGraphError();
  }

  const compilerOptions: ts.CompilerOptions = {
    allowJs: true, checkJs: true, noLib: true, noResolve: false, target: ts.ScriptTarget.Latest,
    module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true, skipLibCheck: true
  };
  const host = ts.createCompilerHost(compilerOptions, true);
  host.getCurrentDirectory = () => "/__bounded__";
  host.getCanonicalFileName = (fileName) => fileName;
  host.useCaseSensitiveFileNames = () => true;
  host.fileExists = (fileName) => entries.has(canonicalVirtualPath(fileName));
  host.readFile = (fileName) => entries.get(canonicalVirtualPath(fileName))?.text;
  host.getSourceFile = (fileName) => entries.get(canonicalVirtualPath(fileName))?.source;
  host.writeFile = () => { throw new BoundedSourceGraphError(); };
  host.directoryExists = () => false;
  host.getDirectories = () => [];
  host.readDirectory = () => [];
  host.realpath = (fileName) => canonicalVirtualPath(fileName);
  host.trace = () => undefined;
  host.resolveModuleNames = (moduleNames, containingFile) => moduleNames.map((name) => {
    const resolved = resolveVirtualModule(name, containingFile, entries);
    return resolved ? { resolvedFileName: resolved, extension: ts.Extension.Js, isExternalLibraryImport: false } : undefined;
  });
  let program: ts.Program | null = ts.createProgram({ rootNames: [...entries.keys()], options: compilerOptions, host });
  if ([...entries.values()].some((entry) => program!.getSyntacticDiagnostics(entry.source).length > 0)) {
    for (const bytes of owned) bytes.fill(0);
    throw new BoundedSourceGraphError();
  }
  let checker: ts.TypeChecker | null = program.getTypeChecker();
  let queries = 0;
  let closed = false;
  const refCache = new Map<string, ts.Node>();
  const keyFor = (ref: BoundedSourceNodeRef) => `${ref.module_id}:${ref.start}:${ref.end}:${ref.kind}`;

  function assertOpen(): void { if (closed || !program || !checker) throw new BoundedSourceGraphError(); }
  function charge(): void { assertOpen(); if (++queries > MAX_QUERIES) throw new BoundedSourceGraphError(); }
  function moduleById(id: string): ModuleEntry { const entry = byId.get(id); if (!entry) throw new BoundedSourceGraphError(); return entry; }
  function makeRef(entry: ModuleEntry, node: ts.Node): BoundedSourceNodeRef {
    const ref = { module_id: entry.id, start: node.getStart(entry.source), end: node.getEnd(), kind: ts.SyntaxKind[node.kind] ?? "Unknown" };
    refCache.set(keyFor(ref), node);
    return ref;
  }
  function exactNode(ref: BoundedSourceNodeRef): { entry: ModuleEntry; node: ts.Node } {
    if (!ref || typeof ref.module_id !== "string" || !Number.isInteger(ref.start) || !Number.isInteger(ref.end) || typeof ref.kind !== "string") throw new BoundedSourceGraphError();
    const node = refCache.get(keyFor(ref));
    const entry = byId.get(ref.module_id);
    if (!node || !entry || node.getStart(entry.source) !== ref.start || node.getEnd() !== ref.end || (ts.SyntaxKind[node.kind] ?? "Unknown") !== ref.kind) throw new BoundedSourceGraphError();
    return { entry, node };
  }
  function symbolDeclarations(node: ts.Node): { refs: BoundedSourceNodeRef[]; count: number; truncated: boolean } {
    if (!checker) return { refs: [], count: 0, truncated: false };
    let symbol: ts.Symbol | undefined;
    try {
      const shorthand = ts.isShorthandPropertyAssignment(node)
        ? node
        : ts.isIdentifier(node) && ts.isShorthandPropertyAssignment(node.parent) && node.parent.name === node
          ? node.parent
          : undefined;
      symbol = shorthand ? checker.getShorthandAssignmentValueSymbol(shorthand) : checker.getSymbolAtLocation(node);
      if (!symbol) symbol = checker.getSymbolAtLocation(node);
      if (!symbol && "name" in node && (node as ts.NamedDeclaration).name) symbol = checker.getSymbolAtLocation((node as ts.NamedDeclaration).name!);
    } catch { return { refs: [], count: 0, truncated: false }; }
    if (!symbol) return { refs: [], count: 0, truncated: false };
    if ((symbol.flags & ts.SymbolFlags.Alias) !== 0) {
      try { symbol = checker.getAliasedSymbol(symbol); } catch { return { refs: [], count: 0, truncated: false }; }
    }
    const declarations: Array<{ owner: ModuleEntry; node: ts.Node }> = [];
    for (const declaration of symbol.getDeclarations() ?? []) {
      const owner = entries.get(canonicalVirtualPath(declaration.getSourceFile().fileName));
      if (owner) declarations.push({ owner, node: declaration });
    }
    const unique = new Map<string, { owner: ModuleEntry; node: ts.Node }>();
    for (const declaration of declarations) {
      const ref = { module_id: declaration.owner.id, start: declaration.node.getStart(declaration.owner.source), end: declaration.node.getEnd(), kind: ts.SyntaxKind[declaration.node.kind] ?? "Unknown" };
      unique.set(keyFor(ref), declaration);
    }
    const values = [...unique.values()];
    return { refs: values.slice(0, MAX_INSPECT_REFS).map(({ owner, node: declaration }) => makeRef(owner, declaration)), count: values.length, truncated: values.length > MAX_INSPECT_REFS };
  }

  return {
    listModules() {
      charge();
      return [...byId.values()].map(({ id, file_name, bytes, sha256 }) => ({ id, file_name, bytes: bytes.byteLength, sha256 }));
    },
    listImports(module_id) {
      charge();
      const entry = moduleById(module_id);
      const result: Array<{ specifier: string | null; resolved_module_id: string | null; unresolved: boolean; bindings: Array<{ imported_name: string; local_name: string; declaration: BoundedSourceNodeRef | null }>; binding_count: number; bindings_truncated: boolean }> = [];
      for (const statement of entry.source.statements) {
        if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
        const bindings: Array<{ imported_name: string; local_name: string; declaration: BoundedSourceNodeRef | null }> = [];
        const clause = statement.importClause;
        if (clause?.name) bindings.push({ imported_name: "default", local_name: clause.name.text, declaration: makeRef(entry, clause.name) });
        if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) bindings.push({ imported_name: "*", local_name: clause.namedBindings.name.text, declaration: makeRef(entry, clause.namedBindings.name) });
        if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
          for (const element of clause.namedBindings.elements) bindings.push({ imported_name: element.propertyName?.text ?? element.name.text, local_name: element.name.text, declaration: makeRef(entry, element.name) });
        }
        const resolvedPath = resolveVirtualModule(statement.moduleSpecifier.text, entry.path, entries);
        const relativeSpecifier = isSafeRelativeSpecifier(statement.moduleSpecifier.text) ? statement.moduleSpecifier.text : null;
        result.push({ specifier: relativeSpecifier, resolved_module_id: resolvedPath ? entries.get(resolvedPath)!.id : null, unresolved: resolvedPath === null, bindings: bindings.slice(0, MAX_LIST_ITEMS), binding_count: bindings.length, bindings_truncated: bindings.length > MAX_LIST_ITEMS });
      }
      const unresolved = result.filter((item) => item.unresolved).length;
      return { items: result.slice(0, MAX_LIST_ITEMS), count: result.length, unresolved, truncated: result.length > MAX_LIST_ITEMS };
    },
    listExports(module_id) {
      charge();
      const entry = moduleById(module_id);
      if (!checker) throw new BoundedSourceGraphError();
      const symbol = checker.getSymbolAtLocation(entry.source);
      if (!symbol) return { items: [], count: 0, truncated: false };
      const exportedSymbols = checker.getExportsOfModule(symbol);
      const items = exportedSymbols.slice(0, MAX_LIST_ITEMS).map((exported) => {
        let target = exported;
        if ((target.flags & ts.SymbolFlags.Alias) !== 0) target = checker!.getAliasedSymbol(target);
        const declaration = target.getDeclarations()?.find((node) => entries.has(canonicalVirtualPath(node.getSourceFile().fileName)));
        const owner = declaration && entries.get(canonicalVirtualPath(declaration.getSourceFile().fileName));
        return { name: exported.getName(), declaration: declaration && owner ? makeRef(owner, declaration) : null };
      });
      return { items, count: exportedSymbols.length, truncated: exportedSymbols.length > MAX_LIST_ITEMS };
    },
    find(input) {
      charge();
      const entry = moduleById(input.module_id);
      const properties = new Set(input.property_names ?? []);
      const literals = new Set(input.string_literals ?? []);
      if (properties.size > 256 || literals.size > 256) throw new BoundedSourceGraphError();
      let visits = 0;
      let count = 0;
      let capped = false;
      const refs: BoundedSourceNodeRef[] = [];
      function visit(node: ts.Node, depth: number): void {
        if (capped) return;
        visits += 1;
        if (visits > MAX_FIND_VISITS || depth > MAX_FIND_DEPTH) { capped = true; return; }
        const property = propertyName(node);
        const literalMatch = ts.isStringLiteralLike(node) && literals.has(node.text) && allowedLiterals.has(node.text);
        if ((property !== null && properties.has(property)) || literalMatch) {
          count += 1;
          if (refs.length < MAX_FIND_REFS) refs.push(makeRef(entry, node)); else capped = true;
        }
        ts.forEachChild(node, (child) => visit(child, depth + 1));
      }
      visit(entry.source, 0);
      return { refs, count, visits, truncated: capped || count > refs.length, capped };
    },
    inspect(nodeRef) {
      charge();
      return inspectFact(nodeRef);
    },
    inspectSubtree(nodeRef, options) {
      charge();
      let maxNodes = 64;
      let maxDepth = 6;
      if (options !== undefined) {
        const record = readPlainRecord(options);
        for (const key of Reflect.ownKeys(record)) if (key !== "max_nodes" && key !== "max_depth") throw new BoundedSourceGraphError();
        if (hasOwnData(record, "max_nodes")) maxNodes = ownData(record, "max_nodes") as number;
        if (hasOwnData(record, "max_depth")) maxDepth = ownData(record, "max_depth") as number;
      }
      if (!Number.isInteger(maxNodes) || maxNodes < 1 || maxNodes > MAX_INSPECT_REFS * 4 ||
          !Number.isInteger(maxDepth) || maxDepth < 0 || maxDepth > 8) throw new BoundedSourceGraphError();
      const root = exactNode(nodeRef);
      const nodes: Array<{ depth: number; fact: ReturnType<BoundedSourceGraph["inspect"]> }> = [];
      const seen = new Set<string>();
      let truncated = false;
      let capped = false;
      const queue: Array<{ ref: BoundedSourceNodeRef; node: ts.Node; entry: ModuleEntry; depth: number }> = [
        { ref: nodeRef, node: root.node, entry: root.entry, depth: 0 }
      ];
      while (queue.length > 0) {
        const current = queue.shift()!;
        const key = keyFor(current.ref);
        if (seen.has(key)) continue;
        if (nodes.length >= maxNodes) { truncated = true; capped = true; break; }
        seen.add(key);
        const fact = inspectFact(current.ref);
        nodes.push({ depth: current.depth, fact });
        if (fact.children.some((group) => group.truncated)) truncated = true;
        const groups = directChildGroups(current.node);
        for (const [, children] of groups) {
          for (const child of children.slice(0, MAX_INSPECT_REFS)) {
            const childRef = makeRef(current.entry, child);
            if (seen.has(keyFor(childRef))) continue;
            if (current.depth >= maxDepth) { truncated = true; capped = true; continue; }
            if (queue.length + nodes.length >= maxNodes) { truncated = true; capped = true; continue; }
            queue.push({ ref: childRef, node: child, entry: current.entry, depth: current.depth + 1 });
          }
        }
      }
      return { nodes, visited: nodes.length, truncated, capped };
    },
    close() {
      if (!closed) {
        closed = true;
        for (const bytes of owned) bytes.fill(0);
        owned.length = 0;
        entries.clear();
        byId.clear();
        refCache.clear();
        allowedLiterals.clear();
        checker = null;
        program = null;
      }
      return { owned_bytes: owned.reduce((sum, bytes) => sum + bytes.byteLength, 0), modules: byId.size, source_files: entries.size, refs: refCache.size, program: program ? 1 : 0, checker: checker ? 1 : 0 };
    }
  };

  function inspectFact(nodeRef: BoundedSourceNodeRef): ReturnType<BoundedSourceGraph["inspect"]> {
      const { entry, node } = exactNode(nodeRef);
      const children: Array<{ category: string; refs: BoundedSourceNodeRef[]; count: number; truncated: boolean }> = [];
      const groups = directChildGroups(node);
      for (const [category, nodes] of groups) {
        children.push({ category, refs: nodes.slice(0, MAX_INSPECT_REFS).map((child) => makeRef(entry, child)), count: nodes.length, truncated: nodes.length > MAX_INSPECT_REFS });
      }
      const declarations = symbolDeclarations(node);
      const result: ReturnType<BoundedSourceGraph["inspect"]> = {
        node: nodeRef,
        parent_ref: node.parent ? makeRef(entry, node.parent) : null,
        symbol_declarations: declarations.refs,
        symbol_declaration_count: declarations.count,
        symbol_declarations_truncated: declarations.truncated,
        children,
        truncated: children.some((child) => child.truncated) || declarations.truncated
      };
      const operator = operatorText(node);
      if (operator !== undefined) result.operator = operator;
      if (ts.isStringLiteralLike(node)) {
        result.literal = allowedLiterals.has(node.text)
          ? { allowed: true, value: node.text }
          : { allowed: false, length: node.text.length, sha256: createHash("sha256").update(node.text).digest("hex"), redacted: true };
      }
      const identifierName = safeIdentifierName(node);
      if (identifierName !== undefined) result.identifier_name = identifierName;
      const keyName = safePropertyName(node);
      if (keyName !== undefined && (!isStringPropertyKey(node) || allowedLiterals.has(keyName))) result.property_name = keyName;
      const scalar = safeScalar(node);
      if (scalar !== undefined) result.scalar = scalar;
      return result;
  }
}

function isCanonicalFileName(fileName: string): boolean {
  return typeof fileName === "string" && fileName.length > 0 && fileName.length <= 200 && fileName.endsWith(".js") &&
    !fileName.startsWith("/") && !fileName.includes("\\") && fileName.split("/").every((part) => part !== "" && part !== "." && part !== ".." && /^[A-Za-z0-9._-]+$/u.test(part));
}

function canonicalVirtualPath(fileName: string): string { return fileName.replaceAll("\\", "/"); }

function resolveVirtualModule(specifier: string, containingFile: string, entries: Map<string, ModuleEntry>): string | null {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) return null;
  const parts = containingFile.slice(0, containingFile.lastIndexOf("/")).split("/");
  for (const part of specifier.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") { if (parts.length <= 1) return null; parts.pop(); }
    else if (/^[A-Za-z0-9._-]+$/u.test(part)) parts.push(part);
    else return null;
  }
  const candidate = parts.join("/");
  const paths = candidate.endsWith(".js") ? [candidate] : [`${candidate}.js`, `${candidate}/index.js`];
  return paths.find((path) => entries.has(path)) ?? null;
}

function isSafeRelativeSpecifier(specifier: string): boolean {
  return (specifier.startsWith("./") || specifier.startsWith("../")) &&
    specifier.split("/").every((part) => part === "." || part === ".." || /^[A-Za-z0-9._-]+$/u.test(part));
}

function readPlainRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || isProxy(value)) throw new BoundedSourceGraphError();
  const prototype = getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new BoundedSourceGraphError();
  return value as Record<string, unknown>;
}

function hasOwnData(record: Record<string, unknown>, key: string): boolean {
  const descriptor = getOwnPropertyDescriptor(record, key);
  if (!descriptor) return false;
  if (!("value" in descriptor)) throw new BoundedSourceGraphError();
  return true;
}

function ownData(record: Record<string, unknown>, key: string): unknown {
  const descriptor = getOwnPropertyDescriptor(record, key);
  if (!descriptor || !("value" in descriptor)) throw new BoundedSourceGraphError();
  return descriptor.value;
}

function readPlainArray(value: unknown, maxLength: number): unknown[] {
  if (!Array.isArray(value) || isProxy(value) || getPrototypeOf(value) !== Array.prototype) throw new BoundedSourceGraphError();
  const length = getOwnPropertyDescriptor(value, "length")?.value;
  if (!Number.isInteger(length) || (length as number) < 0 || (length as number) > maxLength) throw new BoundedSourceGraphError();
  const items: unknown[] = [];
  for (let index = 0; index < (length as number); index += 1) items.push(ownData(value as unknown as Record<string, unknown>, String(index)));
  return items;
}

function copyPlainUint8View(value: unknown): Uint8Array {
  if (typeof value !== "object" || value === null || isProxy(value) || !arrayBufferIsView(value) || getPrototypeOf(value) !== nativeUint8ArrayPrototype ||
      !typedArrayBufferGetter || !typedArrayByteOffsetGetter || !typedArrayByteLengthGetter || !arrayBufferByteLengthGetter) throw new BoundedSourceGraphError();
  for (const key of ["buffer", "byteLength", "byteOffset", "length", "slice", "subarray", "set", "constructor"]) {
    if (getOwnPropertyDescriptor(value, key)) throw new BoundedSourceGraphError();
  }
  for (const key of [Symbol.iterator, Symbol.toStringTag, Symbol.species]) {
    if (getOwnPropertyDescriptor(value, key)) throw new BoundedSourceGraphError();
  }
  try {
    const buffer = nativeApply(typedArrayBufferGetter, value, []) as ArrayBuffer;
    const offset = nativeApply(typedArrayByteOffsetGetter, value, []) as number;
    const length = nativeApply(typedArrayByteLengthGetter, value, []) as number;
    const bufferLength = nativeApply(arrayBufferByteLengthGetter, buffer, []) as number;
    if (!Number.isInteger(length) || length <= 0 || length > MAX_FILE_BYTES || offset < 0 || offset + length > bufferLength) throw new BoundedSourceGraphError();
    const copy = new NativeUint8Array(length);
    for (let index = 0; index < length; index += 1) copy[index] = (value as Uint8Array)[index]!;
    return copy;
  } catch {
    throw new BoundedSourceGraphError();
  }
}

function safeIdentifierName(node: ts.Node): string | undefined {
  if (!ts.isIdentifier(node) || node.text.length > 128 || !/^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(node.text)) return undefined;
  return node.text;
}

function safePropertyName(node: ts.Node): string | undefined {
  let name: ts.PropertyName | undefined;
  if (ts.isPropertyAccessExpression(node)) name = node.name;
  else if (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node) || ts.isMethodDeclaration(node) || ts.isPropertyDeclaration(node) || ts.isMethodSignature(node)) name = node.name;
  if (!name) return undefined;
  if (ts.isIdentifier(name) && /^[A-Za-z_$][A-Za-z0-9_$]{0,127}$/u.test(name.text)) return name.text;
  if (ts.isStringLiteralLike(name) && name.text.length <= 128) return name.text;
  return undefined;
}

function isStringPropertyKey(node: ts.Node): boolean {
  if (ts.isPropertyAccessExpression(node)) return false;
  if (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node) || ts.isMethodDeclaration(node) || ts.isPropertyDeclaration(node) || ts.isMethodSignature(node)) return ts.isStringLiteralLike(node.name);
  return false;
}

function safeScalar(node: ts.Node): { kind: "number"; value: number } | { kind: "boolean"; value: boolean } | { kind: "null" } | undefined {
  if (ts.isNumericLiteral(node)) {
    const value = Number(node.text.replaceAll("_", ""));
    return Number.isFinite(value) ? { kind: "number", value } : undefined;
  }
  if (node.kind === ts.SyntaxKind.TrueKeyword) return { kind: "boolean", value: true };
  if (node.kind === ts.SyntaxKind.FalseKeyword) return { kind: "boolean", value: false };
  if (node.kind === ts.SyntaxKind.NullKeyword) return { kind: "null" };
  return undefined;
}

function propertyName(node: ts.Node): string | null {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isShorthandPropertyAssignment(node)) return node.name.text;
  if (ts.isPropertyAssignment(node) || ts.isMethodDeclaration(node) || ts.isPropertyDeclaration(node) || ts.isMethodSignature(node)) {
    return ts.isIdentifier(node.name) || ts.isStringLiteralLike(node.name) ? node.name.text : null;
  }
  return null;
}

function directChildGroups(node: ts.Node): Array<[string, ts.Node[]]> {
  if (ts.isCallExpression(node) || ts.isNewExpression(node)) return [["children", [node.expression]], ["arguments", [...(node.arguments ?? [])]]];
  if (ts.isObjectLiteralExpression(node)) return [["properties", [...node.properties]]];
  if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) return [["parameters", [...node.parameters]], ["body", node.body ? [node.body] : []]];
  if (ts.isVariableDeclaration(node)) return [["initializer", node.initializer ? [node.initializer] : []]];
  if (ts.isReturnStatement(node)) return [["body", node.expression ? [node.expression] : []]];
  if (ts.isConditionalExpression(node)) return [["children", [node.condition, node.whenTrue, node.whenFalse]]];
  if (ts.isBinaryExpression(node)) return [["children", [node.left, node.right]]];
  if (ts.isPropertyAssignment(node)) return [["children", [node.initializer]]];
  if (ts.isPropertyAccessExpression(node)) return [["children", [node.expression, node.name]]];
  if (ts.isExpressionStatement(node)) return [["children", [node.expression]]];
  if (ts.isBlock(node)) return [["body", [...node.statements]]];
  if (ts.isIfStatement(node)) return [["children", [node.expression, node.thenStatement, ...(node.elseStatement ? [node.elseStatement] : [])]]];
  if (ts.isForStatement(node)) {
    const children: ts.Node[] = [];
    if (node.initializer) children.push(node.initializer);
    if (node.condition) children.push(node.condition);
    if (node.incrementor) children.push(node.incrementor);
    children.push(node.statement);
    return [["children", children]];
  }
  if (ts.isWhileStatement(node) || ts.isDoStatement(node)) return [["children", [node.expression, node.statement]]];
  const children: ts.Node[] = [];
  ts.forEachChild(node, (child) => { children.push(child); return undefined; });
  return children.length > 0 ? [["children", children]] : [];
}

function operatorText(node: ts.Node): string | undefined {
  if (ts.isBinaryExpression(node)) return ts.tokenToString(node.operatorToken.kind) ?? ts.SyntaxKind[node.operatorToken.kind];
  if (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) return ts.tokenToString(node.operator) ?? ts.SyntaxKind[node.operator];
  if (ts.isConditionalExpression(node)) return "?:";
  if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) return "import";
  return undefined;
}
