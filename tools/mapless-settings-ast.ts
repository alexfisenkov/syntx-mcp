import ts from "typescript";

export function parseMaplessRegistryForms(source: string): Array<{ form_id: string; module_name: string }> {
  const file = parseJavaScript("Settings2.js", source);
  const found: Array<{ form_id: string; module_name: string }> = [];
  function visit(node: ts.Node): void {
    if (ts.isPropertyAssignment(node) && ts.isStringLiteralLike(node.name)) {
      const match = /^\.\/forms\/settings\/([a-z0-9]+(?:-[a-z0-9]+)*)\.vue$/u.exec(node.name.text);
      if (match?.[1]) {
        const imports: string[] = [];
        function findImports(child: ts.Node): void {
          if (ts.isCallExpression(child) && child.expression.kind === ts.SyntaxKind.ImportKeyword && child.arguments.length === 1) {
            const argument = child.arguments[0];
            if (argument !== undefined && ts.isStringLiteralLike(argument)) imports.push(argument.text);
          }
          ts.forEachChild(child, findImports);
        }
        findImports(node.initializer);
        if (imports.length !== 1 || !/^\.\/[A-Za-z0-9][A-Za-z0-9._-]*\.js$/u.test(imports[0]!)) throw new Error("MAPLESS_REGISTRY_MAPPING_INVALID");
        found.push({ form_id: match[1], module_name: imports[0]!.slice(2) });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  if (found.length < 1 || new Set(found.map((form) => form.form_id)).size !== found.length || new Set(found.map((form) => form.module_name)).size !== found.length) throw new Error("MAPLESS_REGISTRY_MAPPING_INVALID");
  return found.sort((left, right) => left.form_id.localeCompare(right.form_id));
}

export function analyzeMaplessCompiledModule(source: string, knownSettingsKeys: ReadonlySet<string>): { parse_diagnostics: number; model_value_settings_keys: string[]; static_setting_defaults: Record<string, unknown> } {
  const file = parseJavaScript("compiled-settings.js", source);
  const bindings = new Set<string>();
  const defaults: Record<string, unknown> = {};
  function propertyName(name: ts.PropertyName | undefined): string | undefined {
    if (name === undefined) return undefined;
    if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return name.text;
    return undefined;
  }
  function path(node: ts.Expression): string[] {
    if (ts.isPropertyAccessExpression(node)) return [...path(node.expression), node.name.text];
    if (ts.isCallExpression(node)) return [...path(node.expression), "()"];
    if (ts.isIdentifier(node)) return [node.text];
    return [];
  }
  function primitive(node: ts.Expression): { found: boolean; value?: unknown } {
    if (ts.isStringLiteralLike(node)) return { found: true, value: node.text };
    if (ts.isNumericLiteral(node)) return { found: true, value: Number(node.text) };
    if (node.kind === ts.SyntaxKind.TrueKeyword) return { found: true, value: true };
    if (node.kind === ts.SyntaxKind.FalseKeyword) return { found: true, value: false };
    if (node.kind === ts.SyntaxKind.NullKeyword) return { found: true, value: null };
    if (ts.isArrayLiteralExpression(node)) {
      const values = node.elements.map((entry) => primitive(entry));
      return values.every((entry) => entry.found) ? { found: true, value: values.map((entry) => entry.value) } : { found: false };
    }
    return { found: false };
  }
  function visit(node: ts.Node): void {
    if (ts.isPropertyAssignment(node)) {
      const name = propertyName(node.name);
      if (name === "modelValue") {
        const expressionPath = path(node.initializer);
        const settingsIndex = expressionPath.lastIndexOf("settings");
        const settingKey = settingsIndex >= 0 ? expressionPath[settingsIndex + 1] : undefined;
        if (settingKey !== undefined && /^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(settingKey)) bindings.add(settingKey);
      }
      if (name === "settings" && ts.isObjectLiteralExpression(node.initializer)) {
        for (const setting of node.initializer.properties) {
          if (!ts.isPropertyAssignment(setting)) continue;
          const key = propertyName(setting.name);
          if (key === undefined || (!knownSettingsKeys.has(key) && !bindings.has(key))) continue;
          const value = primitive(setting.initializer);
          if (value.found) defaults[key] = value.value;
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return { parse_diagnostics: 0, model_value_settings_keys: [...bindings].sort(), static_setting_defaults: defaults };
}

export function extractGenericSettingsKeys(source: string, knownSettingsKeys: ReadonlySet<string>): string[] {
  const file = parseJavaScript("settings3.js", source);
  const result = new Set<string>();
  function visit(node: ts.Node, inSetter = false): void {
    const setter = ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && node.name.text === "setSettingsByModel";
    const inside = inSetter || setter;
    if (inside && ts.isStringLiteralLike(node) && knownSettingsKeys.has(node.text)) result.add(node.text);
    ts.forEachChild(node, (child) => visit(child, inside));
  }
  visit(file);
  return [...result].sort();
}

export function extractPayloadFieldKeys(source: string): string[] {
  const file = parseJavaScript("useSettingsParams.js", source);
  const result = new Set<string>();
  function visit(node: ts.Node): void {
    if (ts.isArrayLiteralExpression(node)) {
      for (const element of node.elements) if (ts.isStringLiteralLike(element) && /^[a-z][a-z0-9_]{1,48}$/u.test(element.text)) result.add(element.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return [...result].sort();
}

function parseJavaScript(name: string, source: string): ts.SourceFile {
  const file = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS) as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] };
  if (file.parseDiagnostics.length > 0) throw new Error("MAPLESS_STATIC_PARSE_FAILED");
  return file;
}
