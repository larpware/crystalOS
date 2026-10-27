/*
 * CrystalOS — Crystal Chat servers
 *
 * Persistent, backend-backed communities: servers own categories of channels,
 * members hold a role, and every permission question is answered here — on the
 * server — never by hiding a button in the client.
 *
 * Permission model (bitmask on roles):
 *   - Every server has an owner role (highest rank, cannot be edited away)
 *     and a default role every member holds.
 *   - Higher rank = lower `position` number. A role may only be edited or
 *     assigned by someone whose own rank is strictly higher (position-wise)
 *     than the role in question, and nobody may grant a permission they do
 *     not themselves hold — which is what makes escalation impossible.
 *   - A channel may require a permission to be *seen* at all; members without
 *     it do not receive it in listings and are refused on every read and write.
 */

import { randomBytes } from "node:crypto";
import { createId } from "./ids.mjs";
import { parseTags, tagsOf } from "./tags.mjs";

export const PERM = {
  MANAGE_SERVER: 1 << 0,
  MANAGE_CHANNELS: 1 << 1,
  MANAGE_ROLES: 1 << 2,
  KICK: 1 << 3,
  MANAGE_MESSAGES: 1 << 4,
  SEND_MESSAGES: 1 << 5,
  INVITE: 1 << 6,
};
export const ALL_PERMS = Object.values(PERM).reduce((a, b) => a | b, 0);
/** The permissions a default (plain member) role carries. */
export const DEFAULT_PERMS = PERM.SEND_MESSAGES | PERM.INVITE;

export const MESSAGE_BODY_MAX = 4000;

export class ServerError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "ServerError";
    this.code = code;
    this.status = status;
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS servers (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  icon        TEXT,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS roles (
  id          TEXT PRIMARY KEY,
  server_id   TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  color       TEXT,
  position    INTEGER NOT NULL,
  permissions INTEGER NOT NULL,
  is_owner    INTEGER NOT NULL DEFAULT 0,
  is_default  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  UNIQUE (server_id, name)
);

CREATE TABLE IF NOT EXISTS server_members (
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id   TEXT REFERENCES roles(id) ON DELETE SET NULL,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (server_id, user_id)
);
CREATE INDEX IF NOT EXISTS server_members_user ON server_members(user_id);

CREATE TABLE IF NOT EXISTS channels (
  id                  TEXT PRIMARY KEY,
  server_id           TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  category            TEXT,
  name                TEXT NOT NULL,
  description         TEXT,
  position            INTEGER NOT NULL,
  requires_permission INTEGER,
  created_at          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS channels_server ON channels(server_id, position);

CREATE TABLE IF NOT EXISTS server_messages (
  id         TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  author_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  edited_at  INTEGER,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS server_messages_channel ON server_messages(channel_id, created_at);

CREATE TABLE IF NOT EXISTS invites (
  code       TEXT PRIMARY KEY,
  server_id  TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  max_uses   INTEGER,
  uses       INTEGER NOT NULL DEFAULT 0,
  revoked_at INTEGER
);

CREATE TABLE IF NOT EXISTS server_audit (
  id         TEXT PRIMARY KEY,
  server_id  TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  actor_id   TEXT,
  action     TEXT NOT NULL,
  detail     TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS server_audit_server ON server_audit(server_id, created_at);
`;

/* ---- small helpers ------------------------------------------------------ */

function clean(value) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim();
}

/** An invite code nobody can guess and everybody can type. */
function inviteCode() {
  return randomBytes(6).toString("hex").toUpperCase();
}

/**
 * Creates the server store bound to one database handle.
 * All permission decisions flow through the four functions below.
 */
export function createServersStore(db, transaction) {
  db.exec(SCHEMA);

  function serverById(id) {
    return db.prepare("SELECT * FROM servers WHERE id = ?").get(id) ?? null;
  }

  function channelById(id) {
    return db.prepare("SELECT * FROM channels WHERE id = ?").get(id) ?? null;
  }

  function roleById(id) {
    return db.prepare("SELECT * FROM roles WHERE id = ?").get(id) ?? null;
  }

  function memberOf(serverId, userId) {
    return (
      db
        .prepare("SELECT * FROM server_members WHERE server_id = ? AND user_id = ?")
        .get(serverId, userId) ?? null
    );
  }

  /** The role a member currently holds: their assigned role or the default. */
  function effectiveRole(serverId, userId) {
    const member = memberOf(serverId, userId);
    if (!member) return null;
    if (member.role_id) {
      const role = roleById(member.role_id);
      if (role) return role;
    }
    return db.prepare("SELECT * FROM roles WHERE server_id = ? AND is_default = 1").get(serverId);
  }

  /** Owner outranks everything; otherwise lower position number = higher rank. */
  function rankOf(serverId, userId) {
    const server = serverById(serverId);
    if (server && server.owner_id === userId) return -1;
    const role = effectiveRole(serverId, userId);
    return role ? role.position : Number.MAX_SAFE_INTEGER;
  }

  function can(serverId, userId, permission) {
    const role = effectiveRole(serverId, userId);
    if (!role) return false;
    return (role.permissions & permission) === permission;
  }

  /** A channel that requires a permission is invisible without it. */
  function memberCanSeeChannel(serverId, channelId, userId) {
    const channel = channelById(channelId);
    if (!channel || channel.server_id !== serverId) return false;
    if (channel.requires_permission === null) return true;
    return can(serverId, userId, channel.requires_permission);
  }

  function audit(serverId, actorId, action, detail) {
    db.prepare(
      "INSERT INTO server_audit (id, server_id, actor_id, action, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(createId("aud"), serverId, actorId ?? null, action, detail ?? null, Date.now());
  }

  function shapedServer(row, viewerId) {
    if (!row) return null;
    const owner = db.prepare("SELECT username, display_name, tags FROM users WHERE id = ?").get(row.owner_id);
    const member = viewerId ? memberOf(row.id, viewerId) : null;
    const memberCount = Number(
      db.prepare("SELECT COUNT(*) AS n FROM server_members WHERE server_id = ?").get(row.id).n,
    );
    const role = member ? effectiveRole(row.id, viewerId) : null;
    return {
      id: row.id,
      name: row.name,
      description: row.description ?? null,
      icon: row.icon ?? null,
      createdAt: row.created_at,
      owner: {
        id: row.owner_id,
        username: owner?.username ?? "unknown",
        displayName: owner?.display_name ?? "Unknown",
        tags: tagsOf(owner),
      },
      memberCount,
      isMember: Boolean(member),
      myPermissions: member && role ? role.permissions : 0,
      myRole: role ? { id: role.id, name: role.name, color: role.color ?? null, position: role.position } : null,
    };
  }

  function shapedChannel(row) {
    if (!row) return null;
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

  return {
    serverById,
    channelById,
    roleById,
    memberOf,
    effectiveRole,
    rankOf,
    can,
    memberCanSeeChannel,
    shapedServer,
    shapedChannel,

    myServers(userId) {
      return db
        .prepare(
          `SELECT s.* FROM servers s JOIN server_members m ON m.server_id = s.id
            WHERE m.user_id = ? ORDER BY s.name ASC`,
        )
        .all(userId)
        .map((row) => shapedServer(row, userId));
    },

    createServer(ownerId, { name, description, icon }) {
      return transaction(() => {
        const id = createId("srv");
        db.prepare(
          "INSERT INTO servers (id, owner_id, name, description, icon, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        ).run(id, ownerId, name, description ?? null, icon ?? null, Date.now());
        // Owner role (highest rank) and default role ship with every server.
        const ownerRole = createId("rol");
        const defaultRole = createId("rol");
        db.prepare(
          "INSERT INTO roles (id, server_id, name, position, permissions, is_owner, created_at) VALUES (?, ?, 'Owner', 0, ?, 1, ?)",
        ).run(ownerRole, id, ALL_PERMS, Date.now());
        db.prepare(
          "INSERT INTO roles (id, server_id, name, position, permissions, is_default, created_at) VALUES (?, ?, 'Member', 100, ?, 1, ?)",
        ).run(defaultRole, id, DEFAULT_PERMS, Date.now());
        db.prepare("INSERT INTO server_members (server_id, user_id, role_id, joined_at) VALUES (?, ?, ?, ?)").run(
          id,
          ownerId,
          ownerRole,
          Date.now(),
        );
        // Every new server starts with one place to talk.
        db.prepare(
          "INSERT INTO channels (id, server_id, name, position, created_at) VALUES (?, ?, 'general', 0, ?)",
        ).run(createId("chn"), id, Date.now());
        audit(id, ownerId, "server.create", name);
        return shapedServer(this.serverById(id), ownerId);
      });
    },

    /** Everything a member may see: channels filtered by role, roles, members. */
    serverDetail(serverId, viewerId) {
      const server = serverById(serverId);
      if (!server) throw new ServerError("SERVER_NOT_FOUND", "That server no longer exists.", 404);
      const member = memberOf(serverId, viewerId);
      if (!member) throw new ServerError("NOT_A_MEMBER", "You are not in that server.", 403);
      const channels = db
        .prepare("SELECT * FROM channels WHERE server_id = ? ORDER BY position ASC, rowid ASC")
        .all(serverId)
        .filter((row) => memberCanSeeChannel(serverId, row.id, viewerId))
        .map(shapedChannel);
      const roles = db
        .prepare("SELECT * FROM roles WHERE server_id = ? ORDER BY position ASC")
        .all(serverId)
        .map((row) => ({
          id: row.id,
          name: row.name,
          color: row.color ?? null,
          position: row.position,
          permissions: row.permissions,
          isOwner: Boolean(row.is_owner),
          isDefault: Boolean(row.is_default),
        }));
      return {
        server: shapedServer(server, viewerId),
        channels,
        roles,
        members: this.membersFor(serverId),
      };
    },

    updateServer(serverId, actorId, patch) {
      const server = serverById(serverId);
      if (!server) throw new ServerError("SERVER_NOT_FOUND", "That server no longer exists.", 404);
      if (!can(serverId, actorId, PERM.MANAGE_SERVER)) {
        throw new ServerError("NOT_AUTHORIZED", "You cannot change this server's settings.", 403);
      }
      const fields = [];
      const values = [];
      if (patch.name !== undefined) {
        fields.push("name = ?");
        values.push(clean(patch.name));
      }
      if (patch.description !== undefined) {
        fields.push("description = ?");
        values.push(clean(patch.description) || null);
      }
      if (patch.icon !== undefined) {
        fields.push("icon = ?");
        values.push(patch.icon || null);
      }
      if (fields.length === 0) throw new ServerError("NOTHING_TO_UPDATE", "Nothing to update.");
      values.push(serverId);
      db.prepare(`UPDATE servers SET ${fields.join(", ")} WHERE id = ?`).run(...values);
      audit(serverId, actorId, "server.update", fields.join(", "));
      return shapedServer(serverById(serverId), actorId);
    },

    transferOwnership(serverId, actorId, newOwnerId) {
      const server = serverById(serverId);
      if (!server) throw new ServerError("SERVER_NOT_FOUND", "That server no longer exists.", 404);
      if (server.owner_id !== actorId) {
        throw new ServerError("NOT_OWNER", "Only the owner can transfer ownership.", 403);
      }
      const target = memberOf(serverId, newOwnerId);
      if (!target) throw new ServerError("NOT_A_MEMBER", "The new owner must already be a member.", 400);
      transaction(() => {
        db.prepare("UPDATE servers SET owner_id = ? WHERE id = ?").run(newOwnerId, serverId);
        const ownerRole = db.prepare("SELECT id FROM roles WHERE server_id = ? AND is_owner = 1").get(serverId);
        const oldOwnerRole = db.prepare("SELECT id FROM roles WHERE server_id = ? AND is_default = 1").get(serverId);
        db.prepare("UPDATE server_members SET role_id = ? WHERE server_id = ? AND user_id = ?").run(
          ownerRole?.id ?? null,
          serverId,
          newOwnerId,
        );
        if (oldOwnerRole) {
          db.prepare("UPDATE server_members SET role_id = ? WHERE server_id = ? AND user_id = ?").run(
            oldOwnerRole.id,
            serverId,
            actorId,
          );
        }
        audit(serverId, actorId, "server.transfer", newOwnerId);
      });
    },

    deleteServer(serverId, actorId) {
      const server = serverById(serverId);
      if (!server) throw new ServerError("SERVER_NOT_FOUND", "That server no longer exists.", 404);
      if (server.owner_id !== actorId) {
        throw new ServerError("NOT_OWNER", "Only the owner can delete a server.", 403);
      }
      // The last owner cannot be removed by demotion games; deletion is the
      // owner's own deliberate act, so it simply runs.
      db.prepare("DELETE FROM servers WHERE id = ?").run(serverId);
    },

    addChannel(serverId, actorId, { name, category, description, requiresPermission }) {
      if (!can(serverId, actorId, PERM.MANAGE_CHANNELS)) {
        throw new ServerError("NOT_AUTHORIZED", "You cannot create channels here.", 403);
      }
      const channelName = clean(name).toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").slice(0, 40);
      if (!channelName) throw new ServerError("INVALID_NAME", "That channel name is empty.");
      const position = Number(
        db.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS p FROM channels WHERE server_id = ?").get(serverId).p,
      );
      const id = createId("chn");
      db.prepare(
        "INSERT INTO channels (id, server_id, category, name, description, position, requires_permission, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(
        id,
        serverId,
        clean(category) || null,
        channelName,
        clean(description) || null,
        position,
        requiresPermission === null || requiresPermission === undefined ? null : Number(requiresPermission) & ALL_PERMS,
        Date.now(),
      );
      audit(serverId, actorId, "channel.create", channelName);
      return shapedChannel(channelById(id));
    },

    updateChannel(channelId, actorId, patch) {
      const channel = channelById(channelId);
      if (!channel) throw new ServerError("CHANNEL_NOT_FOUND", "That channel is gone.", 404);
      if (!can(channel.server_id, actorId, PERM.MANAGE_CHANNELS)) {
        throw new ServerError("NOT_AUTHORIZED", "You cannot change that channel.", 403);
      }
      const fields = [];
      const values = [];
      if (patch.name !== undefined) {
        const channelName = clean(patch.name).toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").slice(0, 40);
        if (!channelName) throw new ServerError("INVALID_NAME", "That channel name is empty.");
        fields.push("name = ?");
        values.push(channelName);
      }
      if (patch.category !== undefined) {
        fields.push("category = ?");
        values.push(clean(patch.category) || null);
      }
      if (patch.description !== undefined) {
        fields.push("description = ?");
        values.push(clean(patch.description) || null);
      }
      if (patch.requiresPermission !== undefined) {
        fields.push("requires_permission = ?");
        values.push(patch.requiresPermission === null ? null : Number(patch.requiresPermission) & ALL_PERMS);
      }
      if (patch.position !== undefined) {
        fields.push("position = ?");
        values.push(Math.max(0, Math.floor(Number(patch.position))));
      }
      if (fields.length === 0) throw new ServerError("NOTHING_TO_UPDATE", "Nothing to update.");
      values.push(channelId);
      db.prepare(`UPDATE channels SET ${fields.join(", ")} WHERE id = ?`).run(...values);
      audit(channel.server_id, actorId, "channel.update", channel.name);
      return shapedChannel(channelById(channelId));
    },

    deleteChannel(channelId, actorId) {
      const channel = channelById(channelId);
      if (!channel) throw new ServerError("CHANNEL_NOT_FOUND", "That channel is gone.", 404);
      if (!can(channel.server_id, actorId, PERM.MANAGE_CHANNELS)) {
        throw new ServerError("NOT_AUTHORIZED", "You cannot delete that channel.", 403);
      }
      const count = Number(
        db.prepare("SELECT COUNT(*) AS n FROM channels WHERE server_id = ?").get(channel.server_id).n,
      );
      if (count <= 1) {
        throw new ServerError("LAST_CHANNEL", "A server needs at least one channel.", 400);
      }
      db.prepare("DELETE FROM channels WHERE id = ?").run(channelId);
      audit(channel.server_id, actorId, "channel.delete", channel.name);
    },

    /* ---- roles ------------------------------------------------------- */

    createRole(serverId, actorId, { name, color, permissions }) {
      if (!can(serverId, actorId, PERM.MANAGE_ROLES)) {
        throw new ServerError("NOT_AUTHORIZED", "You cannot create roles here.", 403);
      }
      const roleName = clean(name).slice(0, 40);
      if (!roleName) throw new ServerError("INVALID_NAME", "That role name is empty.");
      // New roles sit just below the creator's own rank, never above it.
      const myRank = rankOf(serverId, actorId);
      const position = Math.max(myRank + 1, 1);
      const wanted = Number(permissions ?? DEFAULT_PERMS) & ALL_PERMS;
      const own = effectiveRole(serverId, actorId)?.permissions ?? 0;
      if ((wanted & ~own) !== 0) {
        throw new ServerError("ESCALATION", "You cannot grant a permission you do not have yourself.", 403);
      }
      const id = createId("rol");
      try {
        db.prepare(
          "INSERT INTO roles (id, server_id, name, color, position, permissions, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        ).run(id, serverId, roleName, clean(color) || null, position, wanted, Date.now());
      } catch (error) {
        if (String(error?.message ?? "").includes("UNIQUE constraint failed")) {
          throw new ServerError("ROLE_EXISTS", "A role with that name already exists.", 409);
        }
        throw error;
      }
      audit(serverId, actorId, "role.create", roleName);
      return roleById(id);
    },

    updateRole(roleId, actorId, patch) {
      const role = roleById(roleId);
      if (!role) throw new ServerError("ROLE_NOT_FOUND", "That role is gone.", 404);
      if (role.is_owner || role.is_default) {
        throw new ServerError("FIXED_ROLE", "Built-in roles cannot be edited; make a custom role instead.", 403);
      }
      if (!can(role.server_id, actorId, PERM.MANAGE_ROLES)) {
        throw new ServerError("NOT_AUTHORIZED", "You cannot edit roles here.", 403);
      }
      // Rank guard: only someone strictly above this role may touch it.
      if (rankOf(role.server_id, actorId) >= role.position) {
        throw new ServerError("NOT_AUTHORIZED", "Your role is not high enough to edit that role.", 403);
      }
      const fields = [];
      const values = [];
      if (patch.name !== undefined) {
        fields.push("name = ?");
        values.push(clean(patch.name).slice(0, 40));
      }
      if (patch.color !== undefined) {
        fields.push("color = ?");
        values.push(clean(patch.color) || null);
      }
      if (patch.position !== undefined) {
        // A role can never be moved to or above the editor's own rank.
        const target = Math.max(rankOf(role.server_id, actorId) + 1, Math.floor(Number(patch.position)));
        fields.push("position = ?");
        values.push(target);
      }
      if (patch.permissions !== undefined) {
        const own = effectiveRole(role.server_id, actorId)?.permissions ?? 0;
        const wanted = Number(patch.permissions) & ALL_PERMS;
        if ((wanted & ~own) !== 0) {
          throw new ServerError("ESCALATION", "You cannot grant a permission you do not have yourself.", 403);
        }
        fields.push("permissions = ?");
        values.push(wanted);
      }
      if (fields.length === 0) throw new ServerError("NOTHING_TO_UPDATE", "Nothing to update.");
      values.push(roleId);
      db.prepare(`UPDATE roles SET ${fields.join(", ")} WHERE id = ?`).run(...values);
      audit(role.server_id, actorId, "role.update", role.name);
      return roleById(roleId);
    },

    deleteRole(roleId, actorId) {
      const role = roleById(roleId);
      if (!role) return;
      if (role.is_owner || role.is_default) {
        throw new ServerError("FIXED_ROLE", "Built-in roles cannot be deleted.", 403);
      }
      if (!can(role.server_id, actorId, PERM.MANAGE_ROLES)) {
        throw new ServerError("NOT_AUTHORIZED", "You cannot delete roles here.", 403);
      }
      if (rankOf(role.server_id, actorId) >= role.position) {
        throw new ServerError("NOT_AUTHORIZED", "Your role is not high enough to delete that role.", 403);
      }
      db.prepare("DELETE FROM roles WHERE id = ?").run(roleId);
      audit(role.server_id, actorId, "role.delete", role.name);
    },

    /* ---- members ------------------------------------------------------ */

    membersFor(serverId) {
      return db
        .prepare(
          `SELECT m.user_id, m.joined_at, m.role_id, r.name AS role_name, r.color AS role_color,
                  u.username, u.display_name, u.avatar, u.last_seen_at, u.tags
             FROM server_members m
             JOIN users u ON u.id = m.user_id
             LEFT JOIN roles r ON r.id = m.role_id
            WHERE m.server_id = ?
            ORDER BY r.position ASC, u.username ASC`,
        )
        .all(serverId)
        .map((row) => ({
          userId: row.user_id,
          username: row.username,
          displayName: row.display_name,
          avatar: row.avatar ?? null,
          tags: tagsOf(row),
          online: row.last_seen_at > Date.now() - 60_000,
          joinedAt: row.joined_at,
          roleId: row.role_id ?? null,
          roleName: row.role_name ?? null,
          roleColor: row.role_color ?? null,
        }));
    },

    /** Assign (roleId) or clear (null) a member's role, with escalation guards. */
    assignRole(serverId, actorId, memberId, roleId) {
      const role = roleId ? roleById(roleId) : null;
      if (roleId && (!role || role.server_id !== serverId)) {
        throw new ServerError("ROLE_NOT_FOUND", "That role is gone.", 404);
      }
      if (!can(serverId, actorId, PERM.MANAGE_ROLES)) {
        throw new ServerError("NOT_AUTHORIZED", "You cannot assign roles here.", 403);
      }
      const member = memberOf(serverId, memberId);
      if (!member) throw new ServerError("NOT_A_MEMBER", "That account is not in this server.", 404);
      const server = serverById(serverId);
      if (member.user_id === server.owner_id) {
        throw new ServerError("OWNER_ROLE", "The owner's role cannot be changed.", 403);
      }
      if (role) {
        if (role.is_owner) throw new ServerError("OWNER_ROLE", "The owner role cannot be assigned.", 403);
        // Nobody assigns a role at or above their own rank.
        if (rankOf(serverId, actorId) >= role.position) {
          throw new ServerError("ESCALATION", "You cannot assign a role at or above your own rank.", 403);
        }
      }
      db.prepare("UPDATE server_members SET role_id = ? WHERE server_id = ? AND user_id = ?").run(
        roleId ?? null,
        serverId,
        memberId,
      );
      audit(serverId, actorId, "member.role", `${memberId} → ${roleId ?? "default"}`);
    },

    kickMember(serverId, actorId, memberId) {
      if (!can(serverId, actorId, PERM.KICK)) {
        throw new ServerError("NOT_AUTHORIZED", "You cannot remove members here.", 403);
      }
      const server = serverById(serverId);
      if (memberId === server.owner_id) {
        throw new ServerError("OWNER_ROLE", "The owner cannot be removed from their own server.", 403);
      }
      if (rankOf(serverId, actorId) >= rankOf(serverId, memberId)) {
        throw new ServerError(
          "NOT_AUTHORIZED",
          "You can only remove members whose role is below yours.",
          403,
        );
      }
      db.prepare("DELETE FROM server_members WHERE server_id = ? AND user_id = ?").run(serverId, memberId);
      audit(serverId, actorId, "member.kick", memberId);
    },

    /* ---- invites ------------------------------------------------------ */

    createInvite(serverId, userId, { expiresInMs, maxUses } = {}) {
      if (!can(serverId, userId, PERM.INVITE)) {
        throw new ServerError("NOT_AUTHORIZED", "You cannot create invites here.", 403);
      }
      const code = inviteCode();
      const now = Date.now();
      const expiresAt = expiresInMs
        ? now + Math.min(30 * 24 * 3600_000, Math.max(60_000, Math.floor(Number(expiresInMs))))
        : null;
      const capped = maxUses ? Math.max(1, Math.min(500, Math.floor(Number(maxUses)))) : null;
      db.prepare(
        "INSERT INTO invites (code, server_id, created_by, created_at, expires_at, max_uses) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(code, serverId, userId, now, expiresAt, capped);
      audit(serverId, userId, "invite.create", code);
      return { code, serverId, expiresAt, maxUses: capped };
    },

    revokeInvite(code, userId) {
      const invite = db.prepare("SELECT * FROM invites WHERE code = ?").get(String(code ?? "").toUpperCase());
      if (!invite) throw new ServerError("INVITE_INVALID", "That invite no longer works.", 404);
      if (!can(invite.server_id, userId, PERM.INVITE)) {
        throw new ServerError("NOT_AUTHORIZED", "You cannot revoke invites here.", 403);
      }
      db.prepare("UPDATE invites SET revoked_at = ? WHERE code = ?").run(Date.now(), invite.code);
      audit(invite.server_id, userId, "invite.revoke", invite.code);
    },

    listInvites(serverId, userId) {
      if (!can(serverId, userId, PERM.MANAGE_SERVER)) {
        throw new ServerError("NOT_AUTHORIZED", "Only server managers see the invite list.", 403);
      }
      return db
        .prepare("SELECT * FROM invites WHERE server_id = ? ORDER BY created_at DESC LIMIT 100")
        .all(serverId)
        .map((row) => ({
          code: row.code,
          createdAt: row.created_at,
          expiresAt: row.expires_at ?? null,
          maxUses: row.max_uses ?? null,
          uses: row.uses,
          revoked: Boolean(row.revoked_at),
        }));
    },

    joinByInvite(code, userId) {
      const invite = db.prepare("SELECT * FROM invites WHERE code = ?").get(String(code ?? "").toUpperCase());
      if (!invite || invite.revoked_at) {
        throw new ServerError("INVITE_INVALID", "That invite no longer works.", 404);
      }
      // Already being a member is answered before expiry or exhaustion: the
      // person is in the server either way, and a spent invite does not
      // un-join them.
      const existing = memberOf(invite.server_id, userId);
      if (existing) {
        return { alreadyMember: true, server: shapedServer(serverById(invite.server_id), userId) };
      }
      if (invite.expires_at && invite.expires_at <= Date.now()) {
        throw new ServerError("INVITE_EXPIRED", "That invite has expired.", 410);
      }
      if (invite.max_uses !== null && invite.uses >= invite.max_uses) {
        throw new ServerError("INVITE_EXHAUSTED", "That invite has been used up.", 410);
      }
      const defaultRole = db
        .prepare("SELECT id FROM roles WHERE server_id = ? AND is_default = 1")
        .get(invite.server_id);
      db.prepare("INSERT INTO server_members (server_id, user_id, role_id, joined_at) VALUES (?, ?, ?, ?)").run(
        invite.server_id,
        userId,
        defaultRole?.id ?? null,
        Date.now(),
      );
      db.prepare("UPDATE invites SET uses = uses + 1 WHERE code = ?").run(invite.code);
      audit(invite.server_id, userId, "member.join", userId);
      return { alreadyMember: false, server: shapedServer(serverById(invite.server_id), userId) };
    },

    /* ---- messages ------------------------------------------------------ */

    messagesFor(channelId, userId, { before = null, limit = 50 } = {}) {
      const channel = channelById(channelId);
      if (!channel) throw new ServerError("CHANNEL_NOT_FOUND", "That channel is gone.", 404);
      if (!memberOf(channel.server_id, userId)) {
        throw new ServerError("NOT_A_MEMBER", "You are not in that server.", 403);
      }
      if (!memberCanSeeChannel(channel.server_id, channelId, userId)) {
        throw new ServerError("CHANNEL_FORBIDDEN", "That channel is not visible to your role.", 403);
      }
      const size = Math.max(1, Math.min(100, Number(limit) || 50));
      const rows = db
        .prepare(
          `SELECT * FROM server_messages
            WHERE channel_id = ? AND deleted_at IS NULL
              ${before ? "AND created_at < ?" : ""}
            ORDER BY created_at DESC, rowid DESC LIMIT ?`,
        )
        .all(...(before ? [channelId, Number(before), size + 1] : [channelId, size + 1]));
      return {
        messages: rows.slice(0, size).reverse().map((row) => {
          const author = db
            .prepare("SELECT id, username, display_name, avatar, tags FROM users WHERE id = ?")
            .get(row.author_id);
          return {
            id: row.id,
            channelId,
            body: row.body,
            createdAt: row.created_at,
            editedAt: row.edited_at ?? null,
            author: {
              id: row.author_id,
              username: author?.username ?? "unknown",
              displayName: author?.display_name ?? "Unknown",
              avatar: author?.avatar ?? null,
              tags: tagsOf(author),
            },
          };
        }),
        nextBefore: rows.length > size ? (rows[size - 1]?.created_at ?? null) : null,
      };
    },

    postMessage(channelId, userId, body, proposedId) {
      const text = clean(body);
      if (!text) throw new ServerError("EMPTY_MESSAGE", "Messages cannot be empty.");
      if (text.length > MESSAGE_BODY_MAX) {
        throw new ServerError("MESSAGE_TOO_LONG", `Messages are limited to ${MESSAGE_BODY_MAX} characters.`);
      }
      const channel = channelById(channelId);
      if (!channel) throw new ServerError("CHANNEL_NOT_FOUND", "That channel is gone.", 404);
      if (!memberOf(channel.server_id, userId)) {
        throw new ServerError("NOT_A_MEMBER", "You are not in that server.", 403);
      }
      if (!can(channel.server_id, userId, PERM.SEND_MESSAGES)) {
        throw new ServerError("CANNOT_POST", "Your role cannot post in this server.", 403);
      }
      if (!memberCanSeeChannel(channel.server_id, channelId, userId)) {
        throw new ServerError("CHANNEL_FORBIDDEN", "That channel is not visible to your role.", 403);
      }
      const id = /^[A-Za-z0-9_-]{6,64}$/.test(String(proposedId ?? "")) ? String(proposedId) : createId("srvmsg");
      const result = db
        .prepare("INSERT INTO server_messages (id, channel_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(id, channelId, userId, text, Date.now());
      if (result.changes === 0) throw new ServerError("DUPLICATE_MESSAGE", "That message was already sent.");
      const created = db.prepare("SELECT * FROM server_messages WHERE id = ?").get(id);
      const author = db
        .prepare("SELECT username, display_name, avatar, tags FROM users WHERE id = ?")
        .get(userId);
      return {
        id,
        channelId,
        body: created.body,
        createdAt: created.created_at,
        editedAt: null,
        author: {
          id: userId,
          username: author.username,
          displayName: author.display_name,
          avatar: author.avatar ?? null,
          tags: tagsOf(author),
        },
      };
    },

    editMessage(messageId, userId, body) {
      const row = db.prepare("SELECT * FROM server_messages WHERE id = ?").get(messageId);
      if (!row || row.deleted_at) throw new ServerError("MESSAGE_NOT_FOUND", "That message is gone.", 404);
      if (row.author_id !== userId) {
        throw new ServerError("NOT_AUTHOR", "Only the author can edit a message.", 403);
      }
      const text = clean(body);
      if (!text) throw new ServerError("EMPTY_MESSAGE", "Messages cannot be empty.");
      if (text.length > MESSAGE_BODY_MAX) {
        throw new ServerError("MESSAGE_TOO_LONG", `Messages are limited to ${MESSAGE_BODY_MAX} characters.`);
      }
      db.prepare("UPDATE server_messages SET body = ?, edited_at = ? WHERE id = ?").run(text, Date.now(), messageId);
    },

    deleteMessage(messageId, actorId, platformAdmin) {
      const row = db.prepare("SELECT * FROM server_messages WHERE id = ?").get(messageId);
      if (!row || row.deleted_at) throw new ServerError("MESSAGE_NOT_FOUND", "That message is gone.", 404);
      const channel = channelById(row.channel_id);
      const allowed =
        row.author_id === actorId ||
        (channel && can(channel.server_id, actorId, PERM.MANAGE_MESSAGES)) ||
        Boolean(platformAdmin);
      if (!allowed) throw new ServerError("NOT_AUTHORIZED", "You cannot delete that message.", 403);
      db.prepare("UPDATE server_messages SET deleted_at = ? WHERE id = ?").run(Date.now(), messageId);
      if (channel) audit(channel.server_id, actorId, "message.delete", messageId);
    },

    /* ---- audit --------------------------------------------------------- */

    auditFor(serverId, userId, limit = 100) {
      if (!can(serverId, userId, PERM.MANAGE_SERVER)) {
        throw new ServerError("NOT_AUTHORIZED", "Only server managers see the audit log.", 403);
      }
      return db
        .prepare(
          `SELECT a.*, u.username AS actor_username, u.display_name AS actor_name, u.tags AS actor_tags
             FROM server_audit a LEFT JOIN users u ON u.id = a.actor_id
            WHERE a.server_id = ? ORDER BY a.created_at DESC LIMIT ?`,
        )
        .all(serverId, Math.min(300, Math.max(1, Number(limit) || 100)))
        .map((row) => ({
          id: row.id,
          action: row.action,
          detail: row.detail,
          createdAt: row.created_at,
          actor: row.actor_id
            ? {
                id: row.actor_id,
                username: row.actor_username,
                displayName: row.actor_name,
                tags: parseTags(row.actor_tags),
              }
            : null,
        }));
    },
  };
}
