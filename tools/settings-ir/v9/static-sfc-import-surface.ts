import { createHash } from "node:crypto";
import ts from "typescript";

export const STATIC_SFC_IMPORT_SURFACE_LIMITS = Object.freeze({
  maxSourceBytes: 2 * 1024 * 1024,
  maxSourcePathBytes: 2048,
  maxScriptBlocks: 32,
  maxImports: 512
});

export interface StaticSfcImportSurfaceOptions {
  source: string | Uint8Array;
  sourcePath: string;
}

export interface StaticSfcScriptBlock {
  setup: boolean;
  lang: string;
  content_bytes: number;
  content_sha256: string;
}

export interface StaticSfcImport {
  specifier: string;
  kind: "IMPORT_DECLARATION" | "DYNAMIC_IMPORT";
  locator: { line: number; column: number };
}

export interface StaticSfcImportSurfaceResult {
  profile: "STATIC_SFC_IMPORT_SURFACE_V1";
  source_path: string;
  source_bytes: number;
  script_blocks: StaticSfcScriptBlock[];
  imports: StaticSfcImport[];
  runtime_usable: false;
  vendor_code_executed: false;
  source_persisted: false;
  blockers: string[];
}

class StaticSfcImportSurfaceError extends Error {
  constructor(readonly code: string) {
    super("SFC import surface could not be inspected safely.");
    this.name = "StaticSfcImportSurfaceError";
  }
}

interface ScriptRange {
  setup: boolean;
  lang: string;
  contentStart: number;
  contentEnd: number;
}

/**
 * Extracts only the static import boundary of a Vue SFC. The source is never
 * returned, persisted, resolved, or executed; all vendor bytes are ephemeral.
 */
export function compileStaticSfcImportSurface(options: StaticSfcImportSurfaceOptions): StaticSfcImportSurfaceResult {
  const { source, sourcePath } = validateOptions(options);
  const text = decodeSource(source);
  const sourceBytes = Buffer.byteLength(text, "utf8");
  const ranges = parseScriptRanges(text);
  if (ranges.length > STATIC_SFC_IMPORT_SURFACE_LIMITS.maxScriptBlocks) {
    throw new StaticSfcImportSurfaceError("SCRIPT_BLOCK_LIMIT_EXCEEDED");
  }

  const scriptBlocks = ranges.map((range) => ({
    setup: range.setup,
    lang: range.lang,
    content_bytes: Buffer.byteLength(text.slice(range.contentStart, range.contentEnd), "utf8"),
    content_sha256: sha256(Buffer.from(text.slice(range.contentStart, range.contentEnd), "utf8"))
  }));
  const imports: StaticSfcImport[] = [];
  const seen = new Set<string>();
  const blockers = new Set<string>();
  for (const range of ranges) {
    const content = text.slice(range.contentStart, range.contentEnd);
    const scriptKind = range.lang === "ts" || range.lang === "tsx" ? ts.ScriptKind.TS : ts.ScriptKind.JS;
    const file = ts.createSourceFile(sourcePath, content, ts.ScriptTarget.Latest, true, scriptKind);
    const diagnostics = ts.transpileModule(content, {
      reportDiagnostics: true,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
    }).diagnostics;
    if (diagnostics && diagnostics.length > 0) blockers.add("SCRIPT_SYNTAX_INVALID");
    const visit = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        addImport("IMPORT_DECLARATION", node.moduleSpecifier.text, range.contentStart + node.moduleSpecifier.getStart(file), text, imports, seen);
      } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const argument = node.arguments[0];
        if (argument && ts.isStringLiteral(argument)) {
          addImport("DYNAMIC_IMPORT", argument.text, range.contentStart + argument.getStart(file), text, imports, seen);
        } else {
          blockers.add("DYNAMIC_IMPORT_NOT_STATIC");
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  if (imports.length > STATIC_SFC_IMPORT_SURFACE_LIMITS.maxImports) {
    throw new StaticSfcImportSurfaceError("IMPORT_LIMIT_EXCEEDED");
  }
  if (imports.length > 0) blockers.add("IMPORT_GRAPH_NOT_RESOLVED");
  return {
    profile: "STATIC_SFC_IMPORT_SURFACE_V1",
    source_path: sourcePath,
    source_bytes: sourceBytes,
    script_blocks: scriptBlocks,
    imports,
    runtime_usable: false,
    vendor_code_executed: false,
    source_persisted: false,
    blockers: [...blockers].sort()
  };
}

function validateOptions(options: StaticSfcImportSurfaceOptions): StaticSfcImportSurfaceOptions {
  if (!options || typeof options !== "object" || !(typeof options.source === "string" || options.source instanceof Uint8Array) || typeof options.sourcePath !== "string" || options.sourcePath.length === 0 || Buffer.byteLength(options.sourcePath, "utf8") > STATIC_SFC_IMPORT_SURFACE_LIMITS.maxSourcePathBytes) {
    throw new StaticSfcImportSurfaceError("OPTIONS_INVALID");
  }
  return options;
}

function decodeSource(source: string | Uint8Array): string {
  const bytes = typeof source === "string" ? Buffer.from(source, "utf8") : Buffer.from(source);
  if (bytes.length > STATIC_SFC_IMPORT_SURFACE_LIMITS.maxSourceBytes) throw new StaticSfcImportSurfaceError("SOURCE_TOO_LARGE");
  if (bytes.includes(0)) throw new StaticSfcImportSurfaceError("SOURCE_NUL_FORBIDDEN");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new StaticSfcImportSurfaceError("SOURCE_UTF8_INVALID");
  }
  if (Buffer.from(text, "utf8").compare(bytes) !== 0) throw new StaticSfcImportSurfaceError("SOURCE_UTF8_INVALID");
  return text;
}

function parseScriptRanges(text: string): ScriptRange[] {
  const ranges: ScriptRange[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const match = /<script(?=[\s/>])/gu.exec(text.slice(cursor));
    if (!match || match.index === undefined) break;
    const openingStart = cursor + match.index;
    const openingEnd = findTagEnd(text, openingStart);
    const opening = parseOpeningTag(text.slice(openingStart, openingEnd + 1));
    if (opening.selfClosing) throw new StaticSfcImportSurfaceError("SCRIPT_SELF_CLOSING_FORBIDDEN");
    const closeStart = text.indexOf("</script", openingEnd + 1);
    if (closeStart < 0) throw new StaticSfcImportSurfaceError("SCRIPT_UNCLOSED");
    const closeEnd = findTagEnd(text, closeStart);
    if (text.slice(closeStart, closeEnd + 1).replace(/\s/gu, "") !== "</script>") throw new StaticSfcImportSurfaceError("SCRIPT_CLOSING_TAG_INVALID");
    ranges.push({
      setup: opening.attributes.has("setup"),
      lang: opening.attributes.get("lang") ?? "js",
      contentStart: openingEnd + 1,
      contentEnd: closeStart
    });
    cursor = closeEnd + 1;
  }
  return ranges;
}

function findTagEnd(text: string, start: number): number {
  let quote: "'" | '"' | null = null;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === "'" || char === '"') quote = char;
    else if (char === ">") return index;
  }
  throw new StaticSfcImportSurfaceError("SFC_TAG_UNCLOSED");
}

function parseOpeningTag(tag: string): { attributes: Map<string, string | null>; selfClosing: boolean } {
  const body = tag.slice("<script".length, -1);
  const selfClosing = /\/\s*$/u.test(body);
  const cleaned = body.replace(/\/\s*$/u, "").trim();
  const attributes = new Map<string, string | null>();
  let cursor = 0;
  while (cursor < cleaned.length) {
    while (/\s/u.test(cleaned[cursor] ?? "")) cursor += 1;
    if (cursor >= cleaned.length) break;
    const name = /^[A-Za-z_:][\w:.-]*/u.exec(cleaned.slice(cursor));
    if (!name) throw new StaticSfcImportSurfaceError("SCRIPT_ATTRIBUTES_INVALID");
    cursor += name[0].length;
    while (/\s/u.test(cleaned[cursor] ?? "")) cursor += 1;
    let value: string | null = null;
    if (cleaned[cursor] === "=") {
      cursor += 1;
      while (/\s/u.test(cleaned[cursor] ?? "")) cursor += 1;
      const quote = cleaned[cursor];
      if (quote !== "'" && quote !== '"') throw new StaticSfcImportSurfaceError("SCRIPT_ATTRIBUTES_INVALID");
      const end = cleaned.indexOf(quote, cursor + 1);
      if (end < 0) throw new StaticSfcImportSurfaceError("SCRIPT_ATTRIBUTES_INVALID");
      value = cleaned.slice(cursor + 1, end);
      cursor = end + 1;
    }
    if (attributes.has(name[0])) throw new StaticSfcImportSurfaceError("SCRIPT_ATTRIBUTES_DUPLICATE");
    attributes.set(name[0].toLowerCase(), value);
  }
  for (const key of attributes.keys()) if (key !== "setup" && key !== "lang") throw new StaticSfcImportSurfaceError("SCRIPT_ATTRIBUTES_INVALID");
  const lang = attributes.get("lang");
  if (lang !== undefined && lang !== null && !/^[A-Za-z][A-Za-z0-9+.-]{0,31}$/u.test(lang)) throw new StaticSfcImportSurfaceError("SCRIPT_LANG_INVALID");
  return { attributes, selfClosing };
}

function addImport(kind: StaticSfcImport["kind"], specifier: string, offset: number, text: string, imports: StaticSfcImport[], seen: Set<string>): void {
  const key = `${kind}\u0000${specifier}`;
  if (seen.has(key)) return;
  seen.add(key);
  const before = text.slice(0, offset);
  const line = before.split("\n").length;
  const lastNewline = before.lastIndexOf("\n");
  imports.push({ specifier, kind, locator: { line, column: offset - lastNewline } });
}

function sha256(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }
