/** Bounded linear check for padded canonical standard Base64. */
export function isCanonicalBase64(value: string, maxChars: number): boolean {
  const length = value.length;
  if (!Number.isSafeInteger(maxChars) || maxChars < 0 || length === 0 || length > maxChars || length % 4 !== 0) return false;
  let padding = 0;
  if (value.charCodeAt(length - 1) === 61) padding = value.charCodeAt(length - 2) === 61 ? 2 : 1;
  const dataLength = length - padding;
  for (let index = 0; index < length; index += 1) {
    const code = value.charCodeAt(index);
    if (index >= dataLength) {
      if (code !== 61) return false;
    } else if (!((code >= 65 && code <= 90) || (code >= 97 && code <= 122) ||
      (code >= 48 && code <= 57) || code === 43 || code === 47)) return false;
  }
  if (padding === 2) return (base64Value(value.charCodeAt(length - 3)) & 15) === 0;
  if (padding === 1) return (base64Value(value.charCodeAt(length - 2)) & 3) === 0;
  return true;
}

function base64Value(code: number): number {
  if (code >= 65 && code <= 90) return code - 65;
  if (code >= 97 && code <= 122) return code - 71;
  if (code >= 48 && code <= 57) return code + 4;
  return code === 43 ? 62 : 63;
}
