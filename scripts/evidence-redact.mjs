// Evidence only: never patch Better Auth API responses. HAR capture remains disabled.
const sensitive = /password|secret|token|cookie|authorization|credential/i;
export function redactEvidence(value) {
  if (Array.isArray(value)) return value.map(redactEvidence);
  if (value && typeof value === 'object') {
    const header = typeof value.name === 'string' && sensitive.test(value.name);
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sensitive.test(key) || (header && key === 'value') ? '[REDACTED]' : redactEvidence(item)]));
  }
  if (typeof value === 'string' && /^[\[{]/.test(value.trim())) {
    try { return JSON.stringify(redactEvidence(JSON.parse(value))); } catch { /* Not a JSON payload. */ }
  }
  return value;
}
