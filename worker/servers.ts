/* ==========================================================================
   Crystal Chat communities on the Worker — /api/accounts/{servers,channels,
   roles,invites,server-messages}

   The contract `src/services/communities.ts` already speaks: same paths, same
   JSON, same error codes, now backed by Supabase Postgres.

   Permissions (the same bits the shell renders) are enforced twice:
     * here, so the client gets a readable "you cannot do that" instead of a
       silent empty result;
     * in Postgres, through server_can() inside the RLS policies, so a request
       that skipped this file entirely still cannot write a row it has no
       authority over.
   ========================================================================== */

import type { Env } from "./env";
import { postgrest, SupabaseError } from "./supabase";
import {
  applyCookies,
  crossOrigin,
  requireSession,
  type ProfileRow,
  type Session,
} from "./accounts";
import { bodyAsJson, cleanText, fail, intParam, isoFromMs, json, ms } from "./http";

/* ---- permission bits (mirror src/services/communities.ts) ----------------- */

export const PERM = {
  MANAGE_SERVER: 1 << 0,
  MANAGE_CHANNELS: 1 << 1,
  MANAGE_ROLES: 1 << 2,
  KICK: 1 << 3,
  MANAGE_MESSAGES: 1 << 4,
  SEND_MESSAGES: 1 << 5,
  INVITE: 1 << 6,
} as const;

const ALL_PERMS = 127;
const PERM_NAMES: Record<number, string> = {
  [1 << 0]: "manage this server",
  [1 << 1]: "manage channels",
  [1 << 2]: "manage roles",
  [1 << 3]: "remove members",
  [1 << 4]: "moderate messages",
  [1 << 5]: "send messages",
  [1 << 6]: "create invites",
};
/** What every member gets until a manager changes the default role. */
const DEFAULT_ROLE_PERMS = PERM.SEND_MESSAGES | PERM.INVITE;

const NAME_MAX = 60;
const DESCRIPTION_MAX = 500;
const MESSAGE_MAX = 4000;
const MESSAGE_PAGE_MAX = 100;
const INVITE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/* ---- row shapes ----------------------------------------------------------- */

interface ServerRow {
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
  icon: string | null;
  created_at: string;
  updated_at: string;
}

interface MemberRow {
  server_id: string;
  user_id: string;
  role_id: string | null;
  joined_at: string;
}

interface RoleRow {
  id: string;
  server_id: string;
  name: string;
  color: string | null;
  position: number;
  permissions: number;
  is_default: boolean;
}

interface ChannelRow {
  id: string;
  server_id: string;
  category: string | null;
  name: string;
  description: string | null;
  position: number;
  requires_permission: number | null;
}

interface MessageRow {
  id: string;
  channel_id: string;
  author_id: string;
  body: string;
  client_id: string | null;
  created_at: string;
  edited_at: string | null;
}

interface InviteRow {
  code: string;
  server_id: string;
  created_by: string;
  created_at: string;
  expires_at: string | null;
  max_uses: number | null;
  uses: number;
  revoked: boolean;
}

interface AuditRow {
  id: string;
  server_id: string;
  actor_id: string | null;
  action: string;
  detail: string | null;
  created_at: string;
}

/* ---- reads ---------------------------------------------------------------- */

async function selectRows<T>(
  session: Session,
  table: string,
  params: Record<string, string>,
): Promise<T[]> {
  const { data } = await postgrest(session.config, table, { params, token: session.token });
  return Array.isArray(data) ? (data as T[]) : [];
}

async function profilesByIds(session: Session, ids: string[]): Promise<Map<string, ProfileRow>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map();
  const rows = await selectRows<ProfileRow>(session, "profiles", {
    select: "*",
    id: `in.(${unique.join(",")})`,
  });
  return new Map(rows.map((row) => [row.id, row]));
}

async function getServer(session: Session, id: string): Promise<ServerRow | null> {
  const rows = await selectRows<ServerRow>(session, "servers", { select: "*", id: `eq.${id}` });
  // RLS only returns servers the caller belongs to, so "missing" and "not a
  // member" are deliberately the same answer to the outside world.
  return rows[0] ?? null;
}

async function getMembership(
  session: Session,
  serverId: string,
  userId: string,
): Promise<MemberRow | null> {
  const rows = await selectRows<MemberRow>(session, "server_members", {
    select: "*",
    server_id: `eq.${serverId}`,
    user_id: `eq.${userId}`,
  });
  return rows[0] ?? null;
}

interface Authority {
  member: MemberRow | null;
  role: RoleRow | null;
  permissions: number;
}

/** What the caller may do on this server, resolved from rows — never from input. */
async function authorityOf(session: Session, server: ServerRow): Promise<Authority> {
  const member = await getMembership(session, server.id, session.userId);
  if (server.owner_id === session.userId) {
    return { member, role: null, permissions: ALL_PERMS };
  }
  if (!member?.role_id) return { member, role: null, permissions: 0 };
  const roles = await selectRows<RoleRow>(session, "server_roles", {
    select: "*",
    id: `eq.${member.role_id}`,
  });
  const role = roles[0] ?? null;
  return { member, role, permissions: role ? Number(role.permissions) || 0 : 0 };
}

function denied(bit: number): Response {
  return fail(403, "MISSING_PERMISSION", `You do not have permission to ${PERM_NAMES[bit] ?? "do that"}.`);
}

/* ---- shaping --------------------------------------------------------------- */

function communityShape(
  server: ServerRow,
  extras: {
    owner?: ProfileRow | null;
    memberCount: number;
    isMember: boolean;
    myPermissions: number;
    myRole: RoleRow | null;
  },
) {
  return {
    id: server.id,
    name: server.name,
    description: server.description ?? null,
    icon: server.icon ?? null,
    createdAt: ms(server.created_at),
    owner: {
      id: extras.owner?.id ?? server.owner_id,
      username: extras.owner?.username ?? null,
      displayName: extras.owner?.display_name ?? null,
    },
    memberCount: extras.memberCount,
    isMember: extras.isMember,
    myPermissions: extras.myPermissions,
    myRole: extras.myRole
      ? {
          id: extras.myRole.id,
          name: extras.myRole.name,
          color: extras.myRole.color ?? null,
          position: extras.myRole.position,
        }
      : null,
  };
}

function channelShape(row: ChannelRow) {
  return {
    id: row.id,
    serverId: row.server_id,
    category: row.category ?? null,
    name: row.name,
    description: row.description ?? null,
    position: row.position,
    requiresPermission: row.requires_permission ?? null,
  };
}

function roleShape(row: RoleRow) {
  return {
    id: row.id,
    name: row.name,
    color: row.color ?? null,
    position: row.position,
    permissions: row.permissions,
    // The owner holds authority through servers.owner_id rather than a role
    // row, so no role in the list is "the owner's role".
    isOwner: false,
    isDefault: row.is_default,
  };
}

function inviteShape(row: InviteRow) {
  return {
    code: row.code,
    createdAt: ms(row.created_at),
    expiresAt: row.expires_at ? ms(row.expires_at) : null,
    maxUses: row.max_uses,
    uses: row.uses,
    revoked: row.revoked,
  };
}

function messageShape(row: MessageRow, author: ProfileRow | undefined) {
  return {
    id: row.id,
    channelId: row.channel_id,
    body: row.body,
    createdAt: ms(row.created_at),
    editedAt: row.edited_at ? ms(row.edited_at) : null,
    author: author
      ? {
          id: author.id,
          username: author.username,
          displayName: author.display_name,
          avatar: author.avatar_url ?? null,
          tags: author.tags ?? [],
        }
      : { id: row.author_id, username: null, displayName: null, avatar: null, tags: [] },
  };
}

async function auditEntry(
  session: Session,
  serverId: string,
  action: string,
  detail: string | null,
): Promise<void> {
  await postgrest(session.config, "server_audit", {
    method: "POST",
    token: session.token,
    body: { server_id: serverId, actor_id: session.userId, action, detail },
    representation: false,
  }).catch(() => undefined); // the audit trail is never worth failing an action
}

/* ---- routes: server collection --------------------------------------------- */

async function listServers(session: Session): Promise<Response> {
  const servers = await selectRows<ServerRow>(session, "servers", {
    select: "*",
    order: "created_at.desc",
  });
  if (!servers.length) return json({ servers: [] });

  const ids = servers.map((server) => server.id);
  const members = await selectRows<MemberRow>(session, "server_members", {
    select: "*",
    server_id: `in.(${ids.join(",")})`,
  });
  const owners = await profilesByIds(session, servers.map((server) => server.owner_id));
  const myRoleIds = members
    .filter((member) => member.user_id === session.userId && member.role_id)
    .map((member) => member.role_id!);
  const roles = myRoleIds.length
    ? await selectRows<RoleRow>(session, "server_roles", {
        select: "*",
        id: `in.(${myRoleIds.join(",")})`,
      })
    : [];
  const roleById = new Map(roles.map((role) => [role.id, role]));

  const counts = new Map<string, number>();
  for (const member of members) counts.set(member.server_id, (counts.get(member.server_id) ?? 0) + 1);

  return json({
    servers: servers.map((server) => {
      const mine = members.find(
        (member) => member.server_id === server.id && member.user_id === session.userId,
      );
      const isOwner = server.owner_id === session.userId;
      const role = mine?.role_id ? roleById.get(mine.role_id) ?? null : null;
      return communityShape(server, {
        owner: owners.get(server.owner_id) ?? null,
        memberCount: counts.get(server.id) ?? 0,
        isMember: Boolean(mine) || isOwner,
        myPermissions: isOwner ? ALL_PERMS : role ? Number(role.permissions) || 0 : 0,
        myRole: role,
      });
    }),
  });
}

async function createServer(session: Session, request: Request): Promise<Response> {
  const body = await bodyAsJson(request);
  const name = cleanText(body.name).trim();
  const description = cleanText(body.description ?? "").trim();
  if (!name || name.length > NAME_MAX)
    return fail(400, "INVALID_NAME", `Server names need 1–${NAME_MAX} characters.`);
  if (description.length > DESCRIPTION_MAX)
    return fail(400, "INVALID_DESCRIPTION", `Descriptions are limited to ${DESCRIPTION_MAX} characters.`);

  // Order matters: each insert's RLS policy is checked against what already
  // exists, so the server row comes first (making the caller its owner), then
  // the default role (owner may manage roles), then the roster row (owner
  // bootstraps their own membership), then the audit line (now a member).
  const created = await postgrest(session.config, "servers", {
    method: "POST",
    token: session.token,
    body: {
      owner_id: session.userId,
      name,
      description: description || null,
    },
  });
  const server = (Array.isArray(created.data) ? created.data[0] : created.data) as ServerRow;

  const roleResult = await postgrest(session.config, "server_roles", {
    method: "POST",
    token: session.token,
    body: {
      server_id: server.id,
      name: "@everyone",
      position: 0,
      permissions: DEFAULT_ROLE_PERMS,
      is_default: true,
    },
  });
  const defaultRole = (Array.isArray(roleResult.data) ? roleResult.data[0] : roleResult.data) as RoleRow;

  await postgrest(session.config, "server_members", {
    method: "POST",
    token: session.token,
    body: { server_id: server.id, user_id: session.userId, role_id: null },
    representation: false,
  });
  await auditEntry(session, server.id, "server.create", name);

  return json(
    {
      server: communityShape(server, {
        owner: session.profile,
        memberCount: 1,
        isMember: true,
        myPermissions: ALL_PERMS,
        myRole: defaultRole,
      }),
    },
    { status: 201 },
  );
}

/* ---- routes: one server ------------------------------------------------------ */

async function serverDetail(session: Session, id: string): Promise<Response> {
  const server = await getServer(session, id);
  if (!server) return fail(404, "SERVER_NOT_FOUND", "That server does not exist.");

  const [channels, roles, members, authority] = await Promise.all([
    selectRows<ChannelRow>(session, "channels", {
      select: "*",
      server_id: `eq.${id}`,
      order: "position.asc",
    }),
    selectRows<RoleRow>(session, "server_roles", {
      select: "*",
      server_id: `eq.${id}`,
      order: "position.asc",
    }),
    selectRows<MemberRow>(session, "server_members", { select: "*", server_id: `eq.${id}` }),
    authorityOf(session, server),
  ]);

  const profiles = await profilesByIds(session, [
    server.owner_id,
    ...members.map((member) => member.user_id),
  ]);
  const roleById = new Map(roles.map((role) => [role.id, role]));
  const roster = await selectRows<ProfileRow>(session, "profiles", {
    select: "id,last_seen_at",
    id: `in.(${[...new Set(members.map((member) => member.user_id))].join(",")})`,
  });
  const presence = new Map(roster.map((row) => [row.id, row.last_seen_at]));

  return json({
    server: communityShape(server, {
      owner: profiles.get(server.owner_id) ?? null,
      memberCount: members.length,
      isMember: Boolean(authority.member) || server.owner_id === session.userId,
      myPermissions: authority.permissions,
      myRole: authority.role,
    }),
    channels: channels.map(channelShape),
    roles: roles.map((role) => ({ ...roleShape(role) })),
    members: members.map((member) => {
      const profile = profiles.get(member.user_id);
      const role = member.role_id ? roleById.get(member.role_id) ?? null : null;
      const seen = presence.get(member.user_id);
      return {
        userId: member.user_id,
        username: profile?.username ?? null,
        displayName: profile?.display_name ?? null,
        avatar: profile?.avatar_url ?? null,
        tags: profile?.tags ?? [],
        online: seen ? Date.now() - ms(seen) < 60_000 : false,
        joinedAt: ms(member.joined_at),
        roleId: member.role_id ?? null,
        roleName: role?.name ?? null,
        roleColor: role?.color ?? null,
      };
    }),
  });
}

async function patchServer(
  session: Session,
  id: string,
  request: Request,
): Promise<Response> {
  const server = await getServer(session, id);
  if (!server) return fail(404, "SERVER_NOT_FOUND", "That server does not exist.");
  const authority = await authorityOf(session, server);
  if (!(authority.permissions & PERM.MANAGE_SERVER)) return denied(PERM.MANAGE_SERVER);

  const body = await bodyAsJson(request);
  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) {
    const name = cleanText(body.name).trim();
    if (!name || name.length > NAME_MAX)
      return fail(400, "INVALID_NAME", `Server names need 1–${NAME_MAX} characters.`);
    patch.name = name;
  }
  if (body.description !== undefined) {
    const description = cleanText(body.description).trim();
    if (description.length > DESCRIPTION_MAX)
      return fail(400, "INVALID_DESCRIPTION", `Descriptions are limited to ${DESCRIPTION_MAX} characters.`);
    patch.description = description || null;
  }
  if (!Object.keys(patch).length) {
    return json({ server: communityShape(server, {
      memberCount: 0,
      isMember: true,
      myPermissions: authority.permissions,
      myRole: authority.role,
    }) });
  }
  patch.updated_at = new Date().toISOString();

  const { data } = await postgrest(session.config, "servers", {
    method: "PATCH",
    token: session.token,
    params: { id: `eq.${id}` },
    body: patch,
  });
  const rows = Array.isArray(data) ? (data as ServerRow[]) : [];
  const updated = rows[0] ?? server;
  await auditEntry(session, id, "server.update", patch.name ? String(patch.name) : null);
  return json({
    server: communityShape(updated, {
      memberCount: 0,
      isMember: true,
      myPermissions: authority.permissions,
      myRole: authority.role,
    }),
  });
}

async function deleteServer(session: Session, id: string): Promise<Response> {
  const server = await getServer(session, id);
  if (!server) return fail(404, "SERVER_NOT_FOUND", "That server does not exist.");
  if (server.owner_id !== session.userId) return denied(PERM.MANAGE_SERVER);
  await postgrest(session.config, "servers", {
    method: "DELETE",
    token: session.token,
    params: { id: `eq.${id}` },
    representation: false,
  });
  return json({ ok: true });
}

async function transferServer(session: Session, id: string, request: Request): Promise<Response> {
  const server = await getServer(session, id);
  if (!server) return fail(404, "SERVER_NOT_FOUND", "That server does not exist.");
  if (server.owner_id !== session.userId)
    return fail(403, "NOT_OWNER", "Only the server's owner can transfer it.");

  const body = await bodyAsJson(request);
  const username = cleanText(body.username).trim();
  if (!username) return fail(400, "INVALID_USERNAME", "Enter the username to transfer to.");

  const targets = await selectRows<ProfileRow>(session, "profiles", {
    select: "*",
    username: `eq.${username}`,
  });
  const target = targets[0];
  if (!target) return fail(404, "ACCOUNT_NOT_FOUND", "That account does not exist.");
  if (target.id === session.userId) return fail(400, "SELF_TRANSFER", "You already own this server.");
  const member = await getMembership(session, id, target.id);
  if (!member) return fail(400, "NOT_A_MEMBER", "Transfer to someone who has joined the server.");

  const { data } = await postgrest(session.config, "servers", {
    method: "PATCH",
    token: session.token,
    params: { id: `eq.${id}` },
    body: { owner_id: target.id, updated_at: new Date().toISOString() },
  });
  const rows = Array.isArray(data) ? (data as ServerRow[]) : [];
  if (!rows.length) return fail(403, "MISSING_PERMISSION", "That transfer could not be completed.");
  await auditEntry(session, id, "server.transfer", target.username ?? target.id);
  return json({
    server: communityShape(rows[0], {
      owner: target,
      memberCount: 0,
      isMember: true,
      myPermissions: 0,
      myRole: null,
    }),
  });
}

/* ---- routes: channels --------------------------------------------------------- */

async function createChannel(
  session: Session,
  serverId: string,
  request: Request,
): Promise<Response> {
  const server = await getServer(session, serverId);
  if (!server) return fail(404, "SERVER_NOT_FOUND", "That server does not exist.");
  const authority = await authorityOf(session, server);
  if (!(authority.permissions & PERM.MANAGE_CHANNELS)) return denied(PERM.MANAGE_CHANNELS);

  const body = await bodyAsJson(request);
  const name = cleanText(body.name).trim().replace(/^#+/, "");
  if (!name || name.length > NAME_MAX)
    return fail(400, "INVALID_NAME", `Channel names need 1–${NAME_MAX} characters.`);

  const existing = await selectRows<ChannelRow>(session, "channels", {
    select: "position",
    server_id: `eq.${serverId}`,
    order: "position.desc",
    limit: "1",
  });
  const position = existing.length ? Number(existing[0].position) + 1 : 0;
  const requires =
    body.requiresPermission === null || body.requiresPermission === undefined
      ? null
      : Number(body.requiresPermission) | 0;

  const { data } = await postgrest(session.config, "channels", {
    method: "POST",
    token: session.token,
    body: {
      server_id: serverId,
      name,
      position,
      requires_permission: requires,
    },
  });
  const row = (Array.isArray(data) ? data[0] : data) as ChannelRow;
  await auditEntry(session, serverId, "channel.create", name);
  return json({ channel: channelShape(row) }, { status: 201 });
}

async function deleteChannel(session: Session, channelId: string): Promise<Response> {
  const channels = await selectRows<ChannelRow>(session, "channels", {
    select: "*",
    id: `eq.${channelId}`,
  });
  const channel = channels[0];
  if (!channel) return fail(404, "CHANNEL_NOT_FOUND", "That channel does not exist.");
  const server = await getServer(session, channel.server_id);
  if (!server) return fail(404, "CHANNEL_NOT_FOUND", "That channel does not exist.");
  const authority = await authorityOf(session, server);
  if (!(authority.permissions & PERM.MANAGE_CHANNELS)) return denied(PERM.MANAGE_CHANNELS);

  await postgrest(session.config, "channels", {
    method: "DELETE",
    token: session.token,
    params: { id: `eq.${channelId}` },
    representation: false,
  });
  await auditEntry(session, channel.server_id, "channel.delete", channel.name);
  return json({ ok: true });
}

/* ---- routes: roles ------------------------------------------------------------ */

async function createRole(
  session: Session,
  serverId: string,
  request: Request,
): Promise<Response> {
  const server = await getServer(session, serverId);
  if (!server) return fail(404, "SERVER_NOT_FOUND", "That server does not exist.");
  const authority = await authorityOf(session, server);
  if (!(authority.permissions & PERM.MANAGE_ROLES)) return denied(PERM.MANAGE_ROLES);

  const body = await bodyAsJson(request);
  const name = cleanText(body.name).trim();
  if (!name || name.length > 40) return fail(400, "INVALID_NAME", "Role names need 1–40 characters.");
  const permissions = Number(body.permissions) | 0;
  if (permissions < 0 || permissions > ALL_PERMS)
    return fail(400, "INVALID_PERMISSIONS", "That permission set is not valid.");

  const existing = await selectRows<RoleRow>(session, "server_roles", {
    select: "position",
    server_id: `eq.${serverId}`,
    order: "position.desc",
    limit: "1",
  });

  try {
    const { data } = await postgrest(session.config, "server_roles", {
      method: "POST",
      token: session.token,
      body: {
        server_id: serverId,
        name,
        position: existing.length ? Number(existing[0].position) + 1 : 1,
        permissions,
        is_default: false,
      },
    });
    const row = (Array.isArray(data) ? data[0] : data) as RoleRow;
    await auditEntry(session, serverId, "role.create", name);
    return json({ role: roleShape(row) }, { status: 201 });
  } catch (error) {
    if (error instanceof SupabaseError && error.status === 409)
      return fail(409, "ROLE_EXISTS", "A role with that name already exists.");
    throw error;
  }
}

async function patchRole(session: Session, roleId: string, request: Request): Promise<Response> {
  const roles = await selectRows<RoleRow>(session, "server_roles", { select: "*", id: `eq.${roleId}` });
  const role = roles[0];
  if (!role) return fail(404, "ROLE_NOT_FOUND", "That role does not exist.");
  const server = await getServer(session, role.server_id);
  if (!server) return fail(404, "ROLE_NOT_FOUND", "That role does not exist.");
  const authority = await authorityOf(session, server);
  if (!(authority.permissions & PERM.MANAGE_ROLES)) return denied(PERM.MANAGE_ROLES);

  const body = await bodyAsJson(request);
  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) {
    const name = cleanText(body.name).trim();
    if (!name || name.length > 40) return fail(400, "INVALID_NAME", "Role names need 1–40 characters.");
    patch.name = name;
  }
  if (body.permissions !== undefined) {
    const permissions = Number(body.permissions);
    if (!Number.isFinite(permissions) || permissions < 0 || permissions > ALL_PERMS)
      return fail(400, "INVALID_PERMISSIONS", "That permission set is not valid.");
    patch.permissions = permissions;
  }
  if (!Object.keys(patch).length) return json({ role: roleShape(role) });

  try {
    const { data } = await postgrest(session.config, "server_roles", {
      method: "PATCH",
      token: session.token,
      params: { id: `eq.${roleId}` },
      body: patch,
    });
    const rows = Array.isArray(data) ? (data as RoleRow[]) : [];
    if (!rows.length) return denied(PERM.MANAGE_ROLES);
    await auditEntry(session, role.server_id, "role.update", rows[0].name);
    return json({ role: roleShape(rows[0]) });
  } catch (error) {
    if (error instanceof SupabaseError && error.status === 409)
      return fail(409, "ROLE_EXISTS", "A role with that name already exists.");
    throw error;
  }
}

async function deleteRole(session: Session, roleId: string): Promise<Response> {
  const roles = await selectRows<RoleRow>(session, "server_roles", { select: "*", id: `eq.${roleId}` });
  const role = roles[0];
  if (!role) return fail(404, "ROLE_NOT_FOUND", "That role does not exist.");
  const server = await getServer(session, role.server_id);
  if (!server) return fail(404, "ROLE_NOT_FOUND", "That role does not exist.");
  const authority = await authorityOf(session, server);
  if (!(authority.permissions & PERM.MANAGE_ROLES)) return denied(PERM.MANAGE_ROLES);
  if (role.is_default) return fail(400, "DEFAULT_ROLE", "The default role cannot be removed.");

  const { data } = await postgrest(session.config, "server_roles", {
    method: "DELETE",
    token: session.token,
    params: { id: `eq.${roleId}` },
  });
  if (!(Array.isArray(data) && data.length)) return denied(PERM.MANAGE_ROLES);
  await auditEntry(session, role.server_id, "role.delete", role.name);
  return json({ ok: true });
}

/* ---- routes: members ---------------------------------------------------------- */

async function assignRole(
  session: Session,
  serverId: string,
  userId: string,
  request: Request,
): Promise<Response> {
  const server = await getServer(session, serverId);
  if (!server) return fail(404, "SERVER_NOT_FOUND", "That server does not exist.");
  const authority = await authorityOf(session, server);
  if (!(authority.permissions & PERM.MANAGE_ROLES)) return denied(PERM.MANAGE_ROLES);

  const body = await bodyAsJson(request);
  const roleId = body.roleId === null || body.roleId === undefined ? null : cleanText(body.roleId);
  if (roleId) {
    const roles = await selectRows<RoleRow>(session, "server_roles", {
      select: "id",
      id: `eq.${roleId}`,
      server_id: `eq.${serverId}`,
    });
    if (!roles.length) return fail(400, "INVALID_ROLE", "That role belongs to another server.");
  }

  const { data } = await postgrest(session.config, "server_members", {
    method: "PATCH",
    token: session.token,
    params: { server_id: `eq.${serverId}`, user_id: `eq.${userId}` },
    body: { role_id: roleId },
  });
  const rows = Array.isArray(data) ? data : [];
  if (!rows.length) return fail(404, "MEMBER_NOT_FOUND", "That account is not a member here.");
  await auditEntry(session, serverId, "member.role", userId);
  return json({ ok: true });
}

async function kickMember(session: Session, serverId: string, userId: string): Promise<Response> {
  const server = await getServer(session, serverId);
  if (!server) return fail(404, "SERVER_NOT_FOUND", "That server does not exist.");
  if (userId === server.owner_id)
    return fail(400, "OWNER_CANNOT_LEAVE", "The owner cannot be removed from their own server.");
  const authority = await authorityOf(session, server);
  const removingSelf = userId === session.userId;
  if (!removingSelf && !(authority.permissions & PERM.KICK)) return denied(PERM.KICK);

  const { data } = await postgrest(session.config, "server_members", {
    method: "DELETE",
    token: session.token,
    params: { server_id: `eq.${serverId}`, user_id: `eq.${userId}` },
  });
  if (!(Array.isArray(data) && data.length)) return fail(404, "MEMBER_NOT_FOUND", "That account is not a member here.");
  await auditEntry(session, serverId, removingSelf ? "member.leave" : "member.kick", userId);
  return json({ ok: true });
}

/* ---- routes: invites ------------------------------------------------------------ */

function randomInviteCode(): string {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  let code = "";
  for (const byte of bytes) code += INVITE_ALPHABET[byte % INVITE_ALPHABET.length];
  return code;
}

async function createInvite(
  session: Session,
  serverId: string,
  request: Request,
): Promise<Response> {
  const server = await getServer(session, serverId);
  if (!server) return fail(404, "SERVER_NOT_FOUND", "That server does not exist.");
  const authority = await authorityOf(session, server);
  if (!(authority.permissions & PERM.INVITE)) return denied(PERM.INVITE);

  const body = await bodyAsJson(request);
  const maxUses =
    body.maxUses === null || body.maxUses === undefined ? null : Math.max(1, Number(body.maxUses) | 0);
  const expiresInMs = Number(body.expiresInMs ?? 0);
  const expiresAt =
    Number.isFinite(expiresInMs) && expiresInMs > 0
      ? new Date(Date.now() + expiresInMs).toISOString()
      : null;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const { data } = await postgrest(session.config, "invites", {
        method: "POST",
        token: session.token,
        body: {
          code: randomInviteCode(),
          server_id: serverId,
          created_by: session.userId,
          expires_at: expiresAt,
          max_uses: maxUses,
        },
      });
      const row = (Array.isArray(data) ? data[0] : data) as InviteRow;
      await auditEntry(session, serverId, "invite.create", row.code);
      return json({ invite: inviteShape(row) }, { status: 201 });
    } catch (error) {
      if (!(error instanceof SupabaseError && error.status === 409)) throw error;
    }
  }
  return fail(500, "CODE_EXHAUSTED", "Could not allocate an invite code. Try again.");
}

async function listInvites(session: Session, serverId: string): Promise<Response> {
  const server = await getServer(session, serverId);
  if (!server) return fail(404, "SERVER_NOT_FOUND", "That server does not exist.");
  const authority = await authorityOf(session, server);
  if (!(authority.permissions & PERM.INVITE)) return denied(PERM.INVITE);
  const rows = await selectRows<InviteRow>(session, "invites", {
    select: "*",
    server_id: `eq.${serverId}`,
    order: "created_at.desc",
  });
  return json({ invites: rows.map(inviteShape) });
}

async function revokeInvite(session: Session, code: string): Promise<Response> {
  const canonical = cleanText(code).trim().toUpperCase();
  const { data } = await postgrest(session.config, "invites", {
    method: "DELETE",
    token: session.token,
    params: { code: `eq.${canonical}` },
  });
  if (!(Array.isArray(data) && data.length))
    return fail(404, "INVITE_NOT_FOUND", "That invite does not exist (or is not yours to revoke).");
  await auditEntry(session, (data[0] as InviteRow).server_id, "invite.revoke", canonical);
  return json({ ok: true });
}

async function joinByInvite(session: Session, code: string): Promise<Response> {
  const canonical = cleanText(code).trim().toUpperCase();
  let result: { server_id?: string; already_member?: boolean };
  try {
    const { data } = await postgrest(session.config, "rpc/join_by_invite", {
      method: "POST",
      token: session.token,
      body: { p_code: canonical },
      representation: false,
    });
    // `representation: false` leaves the body unread as JSON by postgrest's
    // caller only when empty; a scalar/jsonb RPC still returns its value.
    result = (data ?? {}) as { server_id?: string; already_member?: boolean };
  } catch (error) {
    if (error instanceof SupabaseError) {
      const message = error.message.toLowerCase();
      if (message.includes("not found")) return fail(404, "INVITE_NOT_FOUND", "That invite does not exist.");
      if (message.includes("revoked")) return fail(410, "INVITE_REVOKED", "That invite was revoked.");
      if (message.includes("expired")) return fail(410, "INVITE_EXPIRED", "That invite has expired.");
      if (message.includes("exhausted")) return fail(410, "INVITE_EXHAUSTED", "That invite has no uses left.");
      if (message.includes("not authenticated"))
        return fail(401, "NO_SESSION", "Sign in to join.");
    }
    throw error;
  }

  const serverId = result?.server_id;
  if (typeof serverId !== "string" || !serverId)
    return fail(404, "INVITE_NOT_FOUND", "That invite does not exist.");

  const server = await getServer(session, serverId);
  if (!server) return fail(404, "SERVER_NOT_FOUND", "That server does not exist.");
  const authority = await authorityOf(session, server);
  const members = await selectRows<MemberRow>(session, "server_members", {
    select: "user_id",
    server_id: `eq.${serverId}`,
  });

  return json({
    alreadyMember: Boolean(result.already_member),
    server: communityShape(server, {
      owner: null,
      memberCount: members.length,
      isMember: true,
      myPermissions: authority.permissions,
      myRole: authority.role,
    }),
  });
}

/* ---- routes: messages ------------------------------------------------------------ */

async function channelMessages(
  request: Request,
  url: URL,
  session: Session,
  channelId: string,
): Promise<Response> {
  const method = request.method.toUpperCase();
  const channels = await selectRows<ChannelRow>(session, "channels", {
    select: "*",
    id: `eq.${channelId}`,
  });
  const channel = channels[0];
  if (!channel) return fail(404, "CHANNEL_NOT_FOUND", "That channel does not exist.");

  if (method === "GET") {
    const limit = intParam(url, "limit", 50, 1, MESSAGE_PAGE_MAX);
    const before = isoFromMs(url.searchParams.get("before"));
    const params: Record<string, string> = {
      select: "*",
      channel_id: `eq.${channelId}`,
      order: "created_at.desc",
      limit: String(limit + 1),
    };
    if (before) params.created_at = `lt.${before}`;
    const rows = await selectRows<MessageRow>(session, "server_messages", params);
    const page = rows.slice(0, limit);
    const authors = await profilesByIds(session, page.map((row) => row.author_id));
    // Oldest first in the thread; nextBefore is the oldest row we returned so
    // the client can ask for the page before it.
    page.reverse();
    return json({
      messages: page.map((row) => messageShape(row, authors.get(row.author_id))),
      nextBefore: rows.length > limit && page.length ? ms(page[0].created_at) : null,
    });
  }

  if (method === "POST") {
    const body = await bodyAsJson(request);
    const value = cleanText(body.body).trim();
    if (!value) return fail(400, "INVALID_MESSAGE_BODY", "Messages cannot be empty.");
    if (value.length > MESSAGE_MAX)
      return fail(400, "INVALID_MESSAGE_BODY", `Messages are limited to ${MESSAGE_MAX} characters.`);
    const clientId = cleanText(body.clientId).slice(0, 64) || null;

    try {
      const { data } = await postgrest(session.config, "server_messages", {
        method: "POST",
        token: session.token,
        body: {
          channel_id: channelId,
          author_id: session.userId,
          body: value,
          client_id: clientId,
        },
      });
      const row = (Array.isArray(data) ? data[0] : data) as MessageRow;
      return json({ message: messageShape(row, session.profile) }, { status: 201 });
    } catch (error) {
      // RLS refuses the insert when the caller lacks SEND_MESSAGES; say why.
      if (error instanceof SupabaseError && (error.status === 401 || error.status === 403))
        return denied(PERM.SEND_MESSAGES);
      throw error;
    }
  }

  return fail(405, "METHOD_NOT_ALLOWED", `${method} is not supported on channel messages.`);
}

async function patchServerMessage(
  session: Session,
  messageId: string,
  request: Request,
): Promise<Response> {
  const body = await bodyAsJson(request);
  const value = cleanText(body.body).trim();
  if (!value) return fail(400, "INVALID_MESSAGE_BODY", "Messages cannot be empty.");
  if (value.length > MESSAGE_MAX)
    return fail(400, "INVALID_MESSAGE_BODY", `Messages are limited to ${MESSAGE_MAX} characters.`);

  const { data } = await postgrest(session.config, "server_messages", {
    method: "PATCH",
    token: session.token,
    params: { id: `eq.${messageId}` },
    body: { body: value, edited_at: new Date().toISOString() },
  });
  const rows = Array.isArray(data) ? (data as MessageRow[]) : [];
  if (!rows.length)
    return fail(404, "MESSAGE_NOT_FOUND", "That message does not exist or you cannot edit it.");
  const authors = await profilesByIds(session, [rows[0].author_id]);
  return json({ message: messageShape(rows[0], authors.get(rows[0].author_id)) });
}

async function deleteServerMessage(session: Session, messageId: string): Promise<Response> {
  const { data } = await postgrest(session.config, "server_messages", {
    method: "DELETE",
    token: session.token,
    params: { id: `eq.${messageId}` },
  });
  if (!(Array.isArray(data) && data.length))
    return fail(404, "MESSAGE_NOT_FOUND", "That message does not exist or you cannot remove it.");
  return json({ ok: true });
}

/* ---- routes: audit --------------------------------------------------------------- */

async function auditLog(session: Session, serverId: string): Promise<Response> {
  const server = await getServer(session, serverId);
  if (!server) return fail(404, "SERVER_NOT_FOUND", "That server does not exist.");
  const authority = await authorityOf(session, server);
  if (!(authority.permissions & PERM.MANAGE_SERVER)) return denied(PERM.MANAGE_SERVER);

  const rows = await selectRows<AuditRow>(session, "server_audit", {
    select: "*",
    server_id: `eq.${serverId}`,
    order: "created_at.desc",
    limit: "100",
  });
  const profiles = await profilesByIds(session, rows.map((row) => row.actor_id ?? ""));
  return json({
    audit: rows.map((row) => {
      const actor = row.actor_id ? profiles.get(row.actor_id) ?? null : null;
      return {
        id: row.id,
        action: row.action,
        detail: row.detail,
        createdAt: ms(row.created_at),
        actor: actor
          ? { id: actor.id, username: actor.username, displayName: actor.display_name }
          : null,
      };
    }),
  });
}

/* ---- router ------------------------------------------------------------------------ */

export async function handleServers(
  request: Request,
  env: Env,
  url: URL,
  segments: string[],
): Promise<Response> {
  if (crossOrigin(request, url)) {
    return fail(403, "CROSS_ORIGIN", "Requests must come from this site.");
  }

  const setCookies: string[] = [];
  const session = await requireSession(request, env, url, setCookies);
  if (session instanceof Response) return applyCookies(session, setCookies);

  const method = request.method.toUpperCase();
  const [head, second, third, fourth] = segments;

  try {
    let response: Response;

    if (head === "servers" && second === undefined) {
      if (method === "GET") response = await listServers(session);
      else if (method === "POST") response = await createServer(session, request);
      else response = fail(405, "METHOD_NOT_ALLOWED", `${method} is not supported on /servers.`);
    } else if (head === "servers" && second && third === undefined) {
      if (method === "GET") response = await serverDetail(session, second);
      else if (method === "PATCH") response = await patchServer(session, second, request);
      else if (method === "DELETE") response = await deleteServer(session, second);
      else response = fail(405, "METHOD_NOT_ALLOWED", `${method} is not supported on a server.`);
    } else if (head === "servers" && second && third === "transfer" && method === "POST") {
      response = await transferServer(session, second, request);
    } else if (head === "servers" && second && third === "channels" && method === "POST") {
      response = await createChannel(session, second, request);
    } else if (head === "servers" && second && third === "roles" && method === "POST") {
      response = await createRole(session, second, request);
    } else if (
      head === "servers" &&
      second &&
      third === "members" &&
      fourth &&
      segments[4] === "role" &&
      method === "PUT"
    ) {
      response = await assignRole(session, second, fourth, request);
    } else if (head === "servers" && second && third === "members" && fourth && method === "DELETE") {
      response = await kickMember(session, second, fourth);
    } else if (head === "servers" && second && third === "invites") {
      if (method === "GET") response = await listInvites(session, second);
      else if (method === "POST") response = await createInvite(session, second, request);
      else response = fail(405, "METHOD_NOT_ALLOWED", `${method} is not supported on invites.`);
    } else if (head === "servers" && second && third === "audit" && method === "GET") {
      response = await auditLog(session, second);
    } else if (head === "channels" && second && third === "messages") {
      response = await channelMessages(request, url, session, second);
    } else if (head === "channels" && second && method === "DELETE") {
      response = await deleteChannel(session, second);
    } else if (head === "roles" && second && method === "PATCH") {
      response = await patchRole(session, second, request);
    } else if (head === "roles" && second && method === "DELETE") {
      response = await deleteRole(session, second);
    } else if (head === "invites" && second && third === "join" && method === "POST") {
      response = await joinByInvite(session, second);
    } else if (head === "invites" && second && method === "DELETE") {
      response = await revokeInvite(session, second);
    } else if (head === "server-messages" && second && method === "PATCH") {
      response = await patchServerMessage(session, second, request);
    } else if (head === "server-messages" && second && method === "DELETE") {
      response = await deleteServerMessage(session, second);
    } else {
      response = fail(404, "ROUTE_NOT_FOUND", `There is no ${method} ${url.pathname} on this deployment.`);
    }

    return applyCookies(response, setCookies);
  } catch (error) {
    console.error("server route error", method, url.pathname, error);
    return fail(500, "INTERNAL_ERROR", "Something went wrong handling that request.");
  }
}
