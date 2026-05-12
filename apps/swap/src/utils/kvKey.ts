/**
 * Persists a 32-byte key in localStorage across page loads so the sqlite-opfs
 * store can be opened with the same key each session. Scope is per-origin per-
 * browser; clearing localStorage makes existing encrypted DBs unreadable
 * (intentional — that's what encryption does).
 *
 * Storage shape: a single base64-encoded 32-byte blob. Newer versions can
 * migrate off this by key-name (`-v2`, etc.).
 */
const KEY_LS_NAME = "aztec-kv-page-key-v1";

export function getOrCreateKvKey(): Uint8Array {
  const existing = localStorage.getItem(KEY_LS_NAME);
  if (existing) {
    try {
      const bytes = Uint8Array.from(atob(existing), c => c.charCodeAt(0));
      if (bytes.length === 32) {
        return bytes;
      }
    } catch {
      // Corrupted — regenerate below.
    }
  }
  const fresh = globalThis.crypto.getRandomValues(new Uint8Array(32));
  const b64 = btoa(String.fromCharCode(...fresh));
  localStorage.setItem(KEY_LS_NAME, b64);
  return fresh;
}
