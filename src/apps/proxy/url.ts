/* ==========================================================================
   Destination helpers for proxied applications
   ========================================================================== */

/** Adds a scheme when a bare host was typed, and rejects nonsense. */
export function normaliseDestination(input: string): string | null {
  const value = input.trim();
  if (!value) return null;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value)) return value;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) return null;
  return /^[\w-]+(\.[\w-]+)+/.test(value) ? `https://${value}` : null;
}

/** The host shown in the address field, with the path when it is short. */
export function displayAddress(url: string): string {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    const path = parsed.pathname === "/" ? "" : parsed.pathname;
    return `${parsed.hostname}${path}${parsed.search}`;
  } catch {
    return url;
  }
}
