import { apiRequest } from "./api";

export interface VerificationOwnership { game_id: string; granted_at?: string; }
export interface VerificationRestrictedGame { game_id: string; reason?: string; }

let snapshot: { at: number; restricted: Set<string>; owned: Set<string> } | null = null;
const SNAPSHOT_TTL = 30_000;

export async function loadVerificationSnapshot(force = false) {
  if (!force && snapshot && Date.now() - snapshot.at < SNAPSHOT_TTL) return snapshot;
  const [restricted, ownerships] = await Promise.all([
    apiRequest<{ restricted?: VerificationRestrictedGame[] }>("/verification/restricted"),
    apiRequest<{ ownerships?: VerificationOwnership[] }>("/verification/ownerships"),
  ]);
  if (!restricted.ok || !ownerships.ok) {
    return { at: Date.now(), restricted: new Set<string>(), owned: new Set<string>(), unavailable: true };
  }
  snapshot = {
    at: Date.now(),
    restricted: new Set((restricted.data.restricted ?? []).map((row) => row.game_id)),
    owned: new Set((ownerships.data.ownerships ?? []).map((row) => row.game_id)),
  };
  return snapshot;
}

export async function checkGameAccess(gameId: string): Promise<boolean> {
  const current = await loadVerificationSnapshot();
  return !current.restricted.has(gameId) || current.owned.has(gameId);
}

export function invalidateVerificationSnapshot() { snapshot = null; }
