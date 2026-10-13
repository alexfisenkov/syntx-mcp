import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export interface V5ImplementationComponent {
  name: string;
  bytes: number;
  sha256: string;
}

export class V5ImplementationGraphError extends Error {
  readonly code = "SETTINGS_V5_IMPLEMENTATION_INVALID";
  constructor() {
    super("The local settings implementation graph could not be verified.");
    this.name = "V5ImplementationGraphError";
  }
}

/** Static local ESM graph; external packages are metadata/lock-bound, not vendored. */
export function collectRootOnlyV5ImplementationComponents(
  projectRoot: string,
  buildRoot = fileURLToPath(new URL("../../../", import.meta.url))
): V5ImplementationComponent[] {
  try {
    const records = collectLocalEsmGraphV5(buildRoot, [
      "tools/settings-ir/v5/root-only-result-toolchain.js",
      "tools/settings-ir/immutable-json-snapshot.js"
    ], projectRoot);
    for (const path of [
      "scripts/settings-v5-root-only.mjs",
      "scripts/sync-normalized-settings-parser-generic-form-result.mjs",
      "scripts/lock-signal-cleanup.mjs",
      "package.json", "package-lock.json", "tsconfig.json"
    ]) {
      records.push(component(`checkout.${path.replaceAll("/", ".")}`, boundedFile(join(projectRoot, path))));
    }
    const require = createRequire(import.meta.url);
    for (const dependency of ["typescript", "zod"]) {
      records.push(component(`external.${dependency}.package-metadata`, boundedFile(require.resolve(`${dependency}/package.json`))));
    }
    records.push(component("runtime.node", Buffer.from(process.version, "utf8")));
    return canonicalRecords(records);
  } catch {
    throw new V5ImplementationGraphError();
  }
}

/** Purely local file traversal with an explicit root; exported for synthetic graph tests. */
export function collectLocalEsmGraphV5(buildRoot: string, entrypoints: readonly string[], sourceRoot?: string): V5ImplementationComponent[] {
  try {
    const root = realpathSync(buildRoot);
    const sources = sourceRoot === undefined ? undefined : realpathSync(sourceRoot);
    const pending = entrypoints.map((path) => resolve(root, path));
    const visited = new Set<string>();
    const records: V5ImplementationComponent[] = [];
    let totalBytes = 0;
    while (pending.length > 0) {
      const path = pending.pop()!;
      const local = relative(root, path);
      if (!local || local.startsWith(`..${sep}`) || isAbsolute(local) ||
          !/^(src|tools)\/[A-Za-z0-9._/-]+\.js$/u.test(local.split(sep).join("/")) ||
          realpathSync(path) !== path) throw new V5ImplementationGraphError();
      if (visited.has(path)) continue;
      visited.add(path);
      if (visited.size > 128) throw new V5ImplementationGraphError();
      const bytes = boundedFile(path);
      totalBytes += bytes.byteLength;
      if (totalBytes > 16 * 1024 * 1024) throw new V5ImplementationGraphError();
      records.push(component(`module.${local.split(sep).join(".")}`, bytes));
      if (sources !== undefined) {
        const sourceLocal = local.replace(/\.js$/u, ".ts");
        const sourcePath = resolve(sources, sourceLocal);
        if (realpathSync(sourcePath) !== sourcePath) throw new V5ImplementationGraphError();
        const sourceBytes = boundedFile(sourcePath);
        totalBytes += sourceBytes.byteLength;
        if (totalBytes > 16 * 1024 * 1024) throw new V5ImplementationGraphError();
        records.push(component(`source.${sourceLocal.split(sep).join(".")}`, sourceBytes));
      }
      const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      const ast = ts.createSourceFile("implementation.js", source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
      const imports: string[] = [];
      let nodes = 0;
      function visit(node: ts.Node, depth = 0): void {
        if (++nodes > 100_000 || depth > 128) throw new V5ImplementationGraphError();
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
          if (!ts.isStringLiteral(node.moduleSpecifier)) throw new V5ImplementationGraphError();
          imports.push(node.moduleSpecifier.text);
        }
        if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
          const argument = node.arguments[0];
          if (node.arguments.length !== 1 || !argument || !ts.isStringLiteral(argument)) throw new V5ImplementationGraphError();
          imports.push(argument.text);
        }
        ts.forEachChild(node, (child) => visit(child, depth + 1));
      }
      visit(ast);
      for (const specifier of imports) {
        if (specifier.startsWith(".")) pending.push(resolve(path, "..", specifier));
        else if (!(specifier.startsWith("node:") || specifier === "zod" || specifier === "zod/v4" || specifier === "typescript")) {
          throw new V5ImplementationGraphError();
        }
      }
    }
    return canonicalRecords(records);
  } catch {
    throw new V5ImplementationGraphError();
  }
}

function boundedFile(path: string): Buffer {
  if (!statSync(path).isFile() || statSync(path).size > 12 * 1024 * 1024) throw new V5ImplementationGraphError();
  const bytes = readFileSync(path);
  if (bytes.byteLength === 0 || bytes.byteLength > 12 * 1024 * 1024) throw new V5ImplementationGraphError();
  return bytes;
}

function component(name: string, bytes: Uint8Array): V5ImplementationComponent {
  return { name, bytes: bytes.byteLength, sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}` };
}

function canonicalRecords(records: V5ImplementationComponent[]): V5ImplementationComponent[] {
  records.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  if (new Set(records.map((record) => record.name)).size !== records.length) throw new V5ImplementationGraphError();
  return records;
}
