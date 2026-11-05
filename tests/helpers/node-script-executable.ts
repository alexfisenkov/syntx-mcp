function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function nodeScriptExecutable(fullOriginalSource: string): string {
  const nodeShebang = `#!${process.execPath}\n`;
  if (!fullOriginalSource.startsWith(nodeShebang)) {
    throw new TypeError("Expected a Node shebang at the start of the executable source");
  }

  const body = fullOriginalSource.slice(nodeShebang.length);
  return `#!/bin/sh\nexec ${shellQuote(process.execPath)} -e ${shellQuote(body)} -- "$0" "$@"\n`;
}
