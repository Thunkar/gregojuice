import type { BridgeSession } from "./types";
import { SESSION_KEY, SESSION_TTL_MS } from "./constants";

export function saveSession(session: BridgeSession) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    /* ignore */
  }
}

export function loadSession(networkId: string): BridgeSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as BridgeSession;
    // Expired or different network → discard
    if (session.networkId !== networkId) return null;
    if (Date.now() - session.timestamp > SESSION_TTL_MS) return null;
    return session;
  } catch {
    return null;
  }
}

export function clearSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}
