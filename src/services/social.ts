import { apiPath, apiRequest, type ApiResult } from "./api";
import type {
  FriendSummary,
  IncomingFriendRequest,
  OutgoingFriendRequest,
  ServerMessage,
} from "@/types";

/* ==========================================================================
   Friends and direct messages

   Thin client over the accounts API. The server owns the truth: it decides
   whether a friend code exists, whether a request may be sent, who may accept
   it, and which accounts may message each other. Everything here is a request
   that can be refused, and every refusal comes back as a readable error.
   ========================================================================== */

/** One page of the server's snapshot for the signed-in account. */
export interface SocialSnapshot {
  serverTime: number;
  user: {
    id: string;
    username: string;
    displayName: string;
    friendCode: string;
    online?: boolean;
    lastSeenAt?: number;
  } | null;
  friends: FriendSummary[];
  incoming: IncomingFriendRequest[];
  outgoing: OutgoingFriendRequest[];
  messages: { conversationId: string; peer: FriendSummary | null; message: ServerMessage }[];
}

/**
 * Everything that changed since `since` (milliseconds). Requests and the
 * friends list are always returned in full — they are small — so a single call
 * keeps the whole friends UI current.
 */
export function sync(since: number): Promise<ApiResult<SocialSnapshot>> {
  return apiRequest<SocialSnapshot>(`/sync?since=${Math.max(0, Math.floor(since))}`);
}

export function requestFriend(code: string) {
  return apiRequest<{ request: OutgoingFriendRequest }>("/friend-requests", {
    method: "POST",
    body: { code },
  });
}

export function acceptFriendRequest(requestId: string) {
  return apiRequest<{ friend: FriendSummary }>(`/friend-requests/${encodeURIComponent(requestId)}/accept`, {
    method: "POST",
    body: {},
  });
}

export function declineFriendRequest(requestId: string) {
  return apiRequest(`/friend-requests/${encodeURIComponent(requestId)}/decline`, {
    method: "POST",
    body: {},
  });
}

export function cancelFriendRequest(requestId: string) {
  return apiRequest(`/friend-requests/${encodeURIComponent(requestId)}`, { method: "DELETE" });
}

export function removeFriend(userId: string) {
  return apiRequest(apiPath("friends", userId), { method: "DELETE" });
}

export function sendDirectMessage(peerId: string, body: string, clientId: string) {
  return apiRequest<{ conversationId: string; peer: FriendSummary; message: ServerMessage }>(
    `${apiPath("conversations", peerId, "messages")}`,
    { method: "POST", body: { body, clientId } },
  );
}

export function loadConversation(peerId: string, limit = 100) {
  return apiRequest<{ conversationId: string; peer: FriendSummary; messages: ServerMessage[] }>(
    `${apiPath("conversations", peerId, "messages")}?limit=${limit}`,
  );
}
