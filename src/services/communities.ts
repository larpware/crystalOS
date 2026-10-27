import { apiPath, apiRequest, type ApiResult } from "./api";

/* ==========================================================================
   Crystal Chat — communities (real servers)

   These are the *backend-backed* servers: rows in the account server's
   SQLite database, permissions enforced there, membership and roles shared
   by everyone who joins. They are deliberately separate from the mesh-based
   "local servers" that Crystal Chat has always had for peer-to-peer rooms:
   those live and die with the sessions that created them; these persist.
   ========================================================================== */

/** The permission bits, mirroring server/accounts/servers.mjs. */
export const PERM = {
  MANAGE_SERVER: 1 << 0,
  MANAGE_CHANNELS: 1 << 1,
  MANAGE_ROLES: 1 << 2,
  KICK: 1 << 3,
  MANAGE_MESSAGES: 1 << 4,
  SEND_MESSAGES: 1 << 5,
  INVITE: 1 << 6,
} as const;

export const PERM_LABEL: Record<number, string> = {
  [1 << 0]: "Manage server",
  [1 << 1]: "Manage channels",
  [1 << 2]: "Manage roles",
  [1 << 3]: "Remove members",
  [1 << 4]: "Manage messages",
  [1 << 5]: "Send messages",
  [1 << 6]: "Create invites",
};

export interface CommunityUserBrief {
  id: string;
  username: string;
  displayName: string;
  avatar: string | null;
  tags?: string[];
}

export interface Community {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  createdAt: number;
  owner: { id: string; username: string; displayName: string };
  memberCount: number;
  isMember: boolean;
  myPermissions: number;
  myRole: { id: string; name: string; color: string | null; position: number } | null;
}

export interface CommunityChannel {
  id: string;
  serverId: string;
  category: string | null;
  name: string;
  description: string | null;
  position: number;
  requiresPermission: number | null;
}

export interface CommunityRole {
  id: string;
  name: string;
  color: string | null;
  position: number;
  permissions: number;
  isOwner: boolean;
  isDefault: boolean;
}

export interface CommunityMember {
  userId: string;
  username: string;
  displayName: string;
  avatar: string | null;
  tags?: string[];
  online: boolean;
  joinedAt: number;
  roleId: string | null;
  roleName: string | null;
  roleColor: string | null;
}

export interface CommunityMessage {
  id: string;
  channelId: string;
  body: string;
  createdAt: number;
  editedAt: number | null;
  author: CommunityUserBrief;
}

export interface CommunityInvite {
  code: string;
  createdAt: number;
  expiresAt: number | null;
  maxUses: number | null;
  uses: number;
  revoked: boolean;
}

export interface CommunityDetail {
  server: Community;
  channels: CommunityChannel[];
  roles: CommunityRole[];
  members: CommunityMember[];
}

export function listCommunities(): Promise<ApiResult<{ servers: Community[] }>> {
  return apiRequest("/servers");
}

export function createCommunity(name: string, description: string | null) {
  return apiRequest<{ server: Community }>("/servers", { method: "POST", body: { name, description } });
}

export function communityDetail(id: string): Promise<ApiResult<CommunityDetail>> {
  return apiRequest(apiPath("servers", id));
}

export function updateCommunity(id: string, patch: { name?: string; description?: string | null }) {
  return apiRequest<{ server: Community }>(apiPath("servers", id), { method: "PATCH", body: patch });
}

export function deleteCommunity(id: string) {
  return apiRequest(apiPath("servers", id), { method: "DELETE" });
}

export function transferCommunity(id: string, username: string) {
  return apiRequest(apiPath("servers", id, "transfer"), { method: "POST", body: { username } });
}

export function addChannel(serverId: string, name: string, requiresPermission: number | null) {
  return apiRequest<{ channel: CommunityChannel }>(apiPath("servers", serverId, "channels"), {
    method: "POST",
    body: { name, requiresPermission },
  });
}

export function removeChannel(channelId: string) {
  return apiRequest(apiPath("channels", channelId), { method: "DELETE" });
}

export function createRole(serverId: string, name: string, permissions: number) {
  return apiRequest<{ role: CommunityRole }>(apiPath("servers", serverId, "roles"), {
    method: "POST",
    body: { name, permissions },
  });
}

export function updateRole(roleId: string, patch: { name?: string; permissions?: number }) {
  return apiRequest<{ role: CommunityRole }>(apiPath("roles", roleId), { method: "PATCH", body: patch });
}

export function deleteRole(roleId: string) {
  return apiRequest(apiPath("roles", roleId), { method: "DELETE" });
}

export function assignRole(serverId: string, userId: string, roleId: string | null) {
  return apiRequest(apiPath("servers", serverId, "members", userId, "role"), {
    method: "PUT",
    body: { roleId },
  });
}

export function kickMember(serverId: string, userId: string) {
  return apiRequest(apiPath("servers", serverId, "members", userId), { method: "DELETE" });
}

export function createInvite(serverId: string, options: { expiresInMs?: number; maxUses?: number } = {}) {
  return apiRequest<{ invite: CommunityInvite & { code: string } }>(apiPath("servers", serverId, "invites"), {
    method: "POST",
    body: options,
  });
}

export function listInvites(serverId: string) {
  return apiRequest<{ invites: CommunityInvite[] }>(apiPath("servers", serverId, "invites"));
}

export function revokeInvite(code: string) {
  return apiRequest(apiPath("invites", code), { method: "DELETE" });
}

export function joinByInvite(code: string) {
  return apiRequest<{ alreadyMember: boolean; server: Community }>(apiPath("invites", code, "join"), {
    method: "POST",
  });
}

export function channelMessages(channelId: string, before: number | null = null, limit = 50) {
  const query = new URLSearchParams({ limit: String(limit) });
  if (before) query.set("before", String(before));
  return apiRequest<{ messages: CommunityMessage[]; nextBefore: number | null }>(
    `${apiPath("channels", channelId, "messages")}?${query}`,
  );
}

export function postChannelMessage(channelId: string, body: string, clientId: string) {
  return apiRequest<{ message: CommunityMessage }>(apiPath("channels", channelId, "messages"), {
    method: "POST",
    body: { body, clientId },
  });
}

export function editChannelMessage(messageId: string, body: string) {
  return apiRequest(apiPath("server-messages", messageId), { method: "PATCH", body: { body } });
}

export function deleteChannelMessage(messageId: string) {
  return apiRequest(apiPath("server-messages", messageId), { method: "DELETE" });
}

export function communityAudit(serverId: string) {
  return apiRequest<{
    audit: {
      id: string;
      action: string;
      detail: string | null;
      createdAt: number;
      actor: { id: string; username: string; displayName: string } | null;
    }[];
  }>(apiPath("servers", serverId, "audit"));
}
