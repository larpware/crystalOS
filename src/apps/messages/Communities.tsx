import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, EmptyState, IconButton, Modal, Spinner, Textarea, Tooltip, UserTag } from "@/components/ui";
import { Icon } from "@/icons/Icon";
import { notify } from "@/services/os";
import { useAuthStore } from "@/state/auth";
import {
  PERM,
  PERM_LABEL,
  addChannel,
  assignRole,
  channelMessages,
  communityAudit,
  communityDetail,
  createCommunity,
  createInvite,
  createRole,
  deleteChannelMessage,
  deleteCommunity,
  deleteRole,
  editChannelMessage,
  joinByInvite,
  kickMember,
  listCommunities,
  listInvites,
  postChannelMessage,
  removeChannel,
  revokeInvite,
  transferCommunity,
  updateCommunity,
  updateRole,
  type Community,
  type CommunityChannel,
  type CommunityInvite,
  type CommunityMember,
  type CommunityMessage,
  type CommunityRole,
} from "@/services/communities";
import { formatDateShort, formatRelative } from "@/utils/format";

/* ==========================================================================
   Communities — real, backend-backed servers inside Crystal Chat

   Everything here talks to the account server: membership, channels,
   messages, roles and permissions are rows in its database, shared by every
   member, enforced there. A permission the server refuses is rendered as a
   refusal here — the composer disables, the channel list omits, and the error
   says why.

   This is the honest counterpart to the mesh-based local servers also present
   in Crystal Chat: those exist between connected sessions; these persist
   between people who are never online at the same time.
   ========================================================================== */

interface AuditEntry {
  id: string;
  action: string;
  detail: string | null;
  createdAt: number;
  actor: { id: string; username: string; displayName: string } | null;
}

/** Future-aware expiry text — formatRelative is past-only by design. */
function formatExpiry(timestamp: number, now = Date.now()): string {
  if (timestamp <= now) return `expired ${formatRelative(timestamp)}`;
  const minutes = Math.floor((timestamp - now) / 60_000);
  if (minutes < 60) return `in ${Math.max(1, minutes)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `in ${hours}h`;
  return `on ${formatDateShort(new Date(timestamp))}`;
}

function describePerms(permissions: number): string {
  const names = Object.entries(PERM_LABEL)
    .filter(([bit]) => (permissions & Number(bit)) === Number(bit))
    .map(([, label]) => label);
  return names.length ? names.join(", ") : "No permissions";
}

export function Communities() {
  const account = useAuthStore((state) => state.account);
  const [servers, setServers] = useState<Community[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [channels, setChannels] = useState<CommunityChannel[]>([]);  const [members, setMembers] = useState<CommunityMember[]>([]);
  const [activeChannel, setActiveChannel] = useState<CommunityChannel | null>(null);
  const [messages, setMessages] = useState<CommunityMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [joinOpen, setJoinOpen] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [freshInvite, setFreshInvite] = useState<string | null>(null);
  const [channelOpen, setChannelOpen] = useState(false);
  const [channelName, setChannelName] = useState("");
  const [showMembers, setShowMembers] = useState(true);
  const [roles, setRoles] = useState<CommunityRole[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<"general" | "members" | "roles" | "invites" | "audit">("general");
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [transferTo, setTransferTo] = useState("");
  const [confirmDelete, setConfirmDelete] = useState("");
  const [roleName, setRoleName] = useState("");
  const [rolePerms, setRolePerms] = useState(0);
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null);
  const [inviteHours, setInviteHours] = useState(0);
  const [inviteUses, setInviteUses] = useState(0);
  const [invites, setInvites] = useState<CommunityInvite[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingBody, setEditingBody] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const active = useMemo(() => servers.find((s) => s.id === activeId) ?? null, [servers, activeId]);
  const canPost = active ? (active.myPermissions & PERM.SEND_MESSAGES) === PERM.SEND_MESSAGES : false;
  const canInvite = active ? (active.myPermissions & PERM.INVITE) === PERM.INVITE : false;
  const canManageChannels = active ? (active.myPermissions & PERM.MANAGE_CHANNELS) === PERM.MANAGE_CHANNELS : false;
  const canManageServer = active ? (active.myPermissions & PERM.MANAGE_SERVER) === PERM.MANAGE_SERVER : false;
  const canManageRoles = active ? (active.myPermissions & PERM.MANAGE_ROLES) === PERM.MANAGE_ROLES : false;
  const canKick = active ? (active.myPermissions & PERM.KICK) === PERM.KICK : false;
  const canModerateMessages = active ? (active.myPermissions & PERM.MANAGE_MESSAGES) === PERM.MANAGE_MESSAGES : false;
  const isOwner = !!active && !!account && active.owner.id === account.id;

  const refreshServers = useCallback(async () => {
    const result = await listCommunities();
    if (result.ok) {
      setServers(result.data.servers);
      return result.data.servers;
    }
    setError(result.error.message);
    return [] as Community[];
  }, []);

  const openServer = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    const result = await communityDetail(id);
    if (result.ok) {
      setActiveId(id);
      setChannels(result.data.channels);
      setMembers(result.data.members);
      setRoles(result.data.roles);
      setServers((current) =>
        current.map((s) => (s.id === id ? { ...s, ...result.data.server } : s)),
      );
      const first = result.data.channels[0] ?? null;
      setActiveChannel(first);
    } else {
      setError(result.error.message);
    }
    setLoading(false);
  }, []);

  /** Re-fetch a server's detail without resetting the selected channel. */
  const syncServer = useCallback(async (id: string) => {
    const result = await communityDetail(id);
    if (result.ok) {
      setChannels(result.data.channels);
      setMembers(result.data.members);
      setRoles(result.data.roles);
      setServers((current) => current.map((s) => (s.id === id ? { ...s, ...result.data.server } : s)));
      setActiveChannel((current) =>
        current
          ? (result.data.channels.find((c) => c.id === current.id) ?? result.data.channels[0] ?? null)
          : null,
      );
    } else {
      setError(result.error.message);
    }
    return result;
  }, []);

  const loadMessages = useCallback(async (channel: CommunityChannel) => {
    setLoading(true);
    setError(null);
    const result = await channelMessages(channel.id);
    if (result.ok) {
      setMessages(result.data.messages);
    } else {
      setMessages([]);
      setError(result.error.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void refreshServers();
  }, [refreshServers]);

  useEffect(() => {
    if (activeChannel) void loadMessages(activeChannel);
  }, [activeChannel?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages.length]);

  const send = useCallback(async () => {
    const body = draft.trim();
    if (!body || !activeChannel) return;
    const clientId = `cm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const result = await postChannelMessage(activeChannel.id, body, clientId);
    if (result.ok) {
      setDraft("");
      setMessages((current) => [...current, result.data.message]);
    } else {
      notify({ title: "Crystal Chat", body: result.error.message });
    }
  }, [draft, activeChannel]);

  if (!account || account.guest) {
    return (
      <EmptyState
        icon="server"
        title="Communities need an account"
        hint="Servers are shared, persistent places — they belong to a CrystalOS account. Sign in from Settings → Account."
      />
    );
  }

  return (
    <div className="cr-communities">
      <aside className="cr-communities__rail">
        <div className="cr-communities__rail-head">
          <span>Communities</span>
          <IconButton label="Join with an invite code" icon="download" onClick={() => setJoinOpen(true)} />
          <IconButton label="Create a community" icon="plus" onClick={() => setCreateOpen(true)} />
        </div>
        {servers.length === 0 && (
          <p className="cr-communities__hint">
            No communities yet. Create one, or join with an invite code.
          </p>
        )}
        {servers.map((server) => (
          <button
            key={server.id}
            type="button"
            className="cr-communities__server"
            data-active={server.id === activeId}
            onClick={() => void openServer(server.id)}
          >
            <Icon name="server" size={14} />
            <span>{server.name}</span>
            <small>{server.memberCount}</small>
          </button>
        ))}
      </aside>

      <section className="cr-communities__channels" aria-label="Channels">
        {active ? (
          <>
            <header className="cr-communities__server-head">
              <h3>{active.name}</h3>
              {active.myRole && (
                <Badge icon="shield">{active.myRole.name}</Badge>
              )}
              {(canManageServer || canManageRoles || canKick) && (
                <IconButton
                  label="Server settings"
                  icon="settings"
                  onClick={() => {
                    setEditName(active.name);
                    setEditDescription(active.description ?? "");
                    setConfirmDelete("");
                    setEditingRoleId(null);
                    setRoleName("");
                    setRolePerms(0);
                    setSettingsTab("general");
                    setSettingsOpen(true);
                  }}
                />
              )}
              <IconButton
                label={showMembers ? "Hide members" : "Show members"}
                icon="users"
                onClick={() => setShowMembers((show) => !show)}
              />
            </header>
            {active.description && <p className="cr-communities__desc">{active.description}</p>}
            <div className="cr-communities__channel-list">
              {channels.map((channel) => (
                <div key={channel.id} className="cr-communities__channel-row">
                  <button
                    type="button"
                    className="cr-communities__channel"
                    data-active={channel.id === activeChannel?.id}
                    onClick={() => setActiveChannel(channel)}
                  >
                    <Icon name="hash" size={13} />
                    <span>{channel.name}</span>
                    {channel.requiresPermission !== null && (
                      <Tooltip label="This channel needs a role you do not have">
                        <Icon name="lock" size={11} />
                      </Tooltip>
                    )}
                  </button>
                  {canManageChannels && channels.length > 1 && (
                    <IconButton
                      label={`Delete #${channel.name}`}
                      icon="trash"
                      size={11}
                      onClick={() => {
                        if (!active) return;
                        if (!window.confirm(`Delete #${channel.name}? Its messages are gone for everyone.`)) return;
                        void removeChannel(channel.id).then(async (result) => {
                          if (result.ok) {
                            await syncServer(active.id);
                          } else {
                            notify({ title: "Crystal Chat", body: result.error.message });
                          }
                        });
                      }}
                    />
                  )}
                </div>
              ))}
            </div>
            {canManageChannels && (
              <Button variant="ghost" size="sm" icon="plus" onClick={() => setChannelOpen(true)}>
                New channel
              </Button>
            )}
            {canInvite && (
              <Button
                variant="ghost"
                size="sm"
                icon="link"
                onClick={() =>
                  void createInvite(active.id).then((result) => {
                    if (result.ok) {
                      setFreshInvite(result.data.invite.code);
                      setInviteOpen(true);
                    } else {
                      notify({ title: "Crystal Chat", body: result.error.message });
                    }
                  })
                }
              >
                Create invite
              </Button>
            )}
          </>
        ) : (
          <EmptyState icon="server" title="Pick a community" hint="Or create one to start a shared, persistent server." />
        )}
      </section>

      <main className="cr-communities__main">
        {!activeChannel ? (
          <EmptyState icon="hash" title="No channel selected" hint="Choose a channel on the left." />
        ) : (
          <>
            <header className="cr-communities__channel-head">
              <Icon name="hash" size={14} />
              <span>{activeChannel.name}</span>
              {activeChannel.description && <small>{activeChannel.description}</small>}
            </header>
            {error && <div className="cr-communities__error">{error}</div>}
            <div className="cr-communities__messages" ref={scrollRef}>
              {loading && <Spinner label="Loading" />}
              {messages.map((message) => (
                <article key={message.id} className="cr-communities__message">
                  <div className="cr-communities__message-head">
                    <strong>
                      {message.author.displayName}
                      <UserTag tags={message.author.tags} />
                    </strong>
                    <span>{formatRelative(message.createdAt)}</span>
                    {message.editedAt && <span>(edited)</span>}
                    {message.author.id === account.id && (
                      <IconButton
                        label="Edit message"
                        icon="pencil"
                        size={12}
                        onClick={() => {
                          setEditingMessageId(message.id);
                          setEditingBody(message.body);
                        }}
                      />
                    )}
                    {(message.author.id === account.id || canModerateMessages) && (
                      <IconButton
                        label="Delete message"
                        icon="trash"
                        size={12}
                        onClick={() =>
                          void deleteChannelMessage(message.id).then((result) => {
                            if (result.ok) {
                              setMessages((current) => current.filter((m) => m.id !== message.id));
                            } else {
                              notify({ title: "Crystal Chat", body: result.error.message });
                            }
                          })
                        }
                      />
                    )}
                  </div>
                  {editingMessageId === message.id ? (
                    <div className="cr-communities__edit">
                      <Textarea
                        value={editingBody}
                        onChange={(event) => setEditingBody(event.target.value)}
                        rows={2}
                        aria-label="Edit message"
                      />
                      <div className="cr-communities__edit-actions">
                        <Button size="sm" onClick={() => setEditingMessageId(null)}>
                          Cancel
                        </Button>
                        <Button
                          variant="primary"
                          size="sm"
                          disabled={!editingBody.trim()}
                          onClick={() =>
                            void editChannelMessage(message.id, editingBody.trim()).then((result) => {
                              if (result.ok) {
                                const body = editingBody.trim();
                                setMessages((current) =>
                                  current.map((m) => (m.id === message.id ? { ...m, body, editedAt: Date.now() } : m)),
                                );
                                setEditingMessageId(null);
                              } else {
                                notify({ title: "Crystal Chat", body: result.error.message });
                              }
                            })
                          }
                        >
                          Save
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <p>{message.body}</p>
                  )}
                </article>
              ))}
            </div>
            <div className="cr-communities__composer">
              <Textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                rows={2}
                placeholder={
                  canPost
                    ? `Message #${activeChannel.name}`
                    : "Your role cannot post in this server"
                }
                disabled={!canPost}
                aria-label="Message the channel"
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void send();
                  }
                }}
              />
              <Button variant="primary" icon="send" disabled={!canPost || !draft.trim()} onClick={() => void send()}>
                Send
              </Button>
            </div>
          </>
        )}
      </main>

      {showMembers && active && (
        <aside className="cr-communities__members" aria-label="Members">
          {members.map((member) => (
            <div key={member.userId} className="cr-communities__member">
              <span className="cr-communities__presence" data-online={member.online} />
              <span style={member.roleColor ? { color: member.roleColor } : undefined}>
                {member.displayName}
                <UserTag tags={member.tags} />
              </span>
              {member.roleName && member.roleName !== "Member" && <small>{member.roleName}</small>}
            </div>
          ))}
        </aside>
      )}

      <Modal open={createOpen} title="Create a community" onClose={() => setCreateOpen(false)}>
        <p className="cr-communities__hint">
          A community is a real server: it persists between people, with channels, roles and
          permissions enforced by the CrystalOS account server.
        </p>
        <Textarea
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          rows={1}
          placeholder="Community name"
          aria-label="Community name"
        />
        <Button
          variant="primary"
          disabled={!newName.trim()}
          onClick={() =>
            void createCommunity(newName.trim(), null).then(async (result) => {
              if (result.ok) {
                setCreateOpen(false);
                setNewName("");
                const list = await refreshServers();
                const created = list.find((s) => s.id === result.data.server.id);
                if (created) await openServer(created.id);
              } else {
                notify({ title: "Crystal Chat", body: result.error.message });
              }
            })
          }
        >
          Create
        </Button>
      </Modal>

      <Modal open={joinOpen} title="Join with an invite code" onClose={() => setJoinOpen(false)}>
        <Textarea
          value={joinCode}
          onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
          rows={1}
          placeholder="Invite code"
          aria-label="Invite code"
        />
        <Button
          variant="primary"
          disabled={!joinCode.trim()}
          onClick={() =>
            void joinByInvite(joinCode.trim()).then(async (result) => {
              if (result.ok) {
                setJoinOpen(false);
                setJoinCode("");
                await refreshServers();
                await openServer(result.data.server.id);
              } else {
                notify({ title: "Crystal Chat", body: result.error.message });
              }
            })
          }
        >
          Join
        </Button>
      </Modal>

      <Modal open={inviteOpen} title="Invite people" onClose={() => setInviteOpen(false)}>
        <p className="cr-communities__hint">
          Share this code. Anyone signed in to CrystalOS can join with it; you can revoke it from
          the server's invite list.
        </p>
        <p className="cr-communities__invite">{freshInvite}</p>
        <Button
          icon="copy"
          onClick={() => {
            if (freshInvite) {
              navigator.clipboard
                ?.writeText(freshInvite)
                .then(() => notify({ title: "Crystal Chat", body: "Invite code copied." }))
                .catch(() => notify({ title: "Crystal Chat", body: "Could not copy — select it manually." }));
            }
          }}
        >
          Copy code
        </Button>
      </Modal>

      <Modal open={channelOpen} title="New channel" onClose={() => setChannelOpen(false)}>
        <Textarea
          value={channelName}
          onChange={(event) => setChannelName(event.target.value)}
          rows={1}
          placeholder="channel-name"
          aria-label="Channel name"
        />
        <Button
          variant="primary"
          disabled={!channelName.trim() || !active}
          onClick={() => {
            if (!active) return;
            void addChannel(active.id, channelName.trim(), null).then(async (result) => {
              if (result.ok) {
                setChannelOpen(false);
                setChannelName("");
                await openServer(active.id);
              } else {
                notify({ title: "Crystal Chat", body: result.error.message });
              }
            });
          }}
        >
          Create
        </Button>
      </Modal>

      {active && (
        <Modal open={settingsOpen} title={`Settings — ${active.name}`} onClose={() => setSettingsOpen(false)}>
          <div className="cr-communities__tabs">
            {(["general", "members", "roles", "invites", "audit"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                className="cr-communities__tab"
                data-active={settingsTab === tab}
                onClick={() => {
                  setSettingsTab(tab);
                  if (tab === "invites" && canInvite) {
                    void listInvites(active.id).then((result) => {
                      if (result.ok) setInvites(result.data.invites);
                      else notify({ title: "Crystal Chat", body: result.error.message });
                    });
                  }
                  if (tab === "audit" && canManageServer) {
                    void communityAudit(active.id).then((result) => {
                      if (result.ok) setAudit(result.data.audit);
                      else notify({ title: "Crystal Chat", body: result.error.message });
                    });
                  }
                }}
              >
                {tab}
              </button>
            ))}
          </div>

          {settingsTab === "general" && (
            <div className="cr-communities__settings-section">
              {canManageServer ? (
                <>
                  <span className="cr-communities__field-label">Name</span>
                  <Textarea
                    value={editName}
                    onChange={(event) => setEditName(event.target.value)}
                    rows={1}
                    aria-label="Server name"
                  />
                  <span className="cr-communities__field-label">Description</span>
                  <Textarea
                    value={editDescription}
                    onChange={(event) => setEditDescription(event.target.value)}
                    rows={2}
                    aria-label="Server description"
                  />
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={!editName.trim()}
                    onClick={() =>
                      void updateCommunity(active.id, {
                        name: editName.trim(),
                        description: editDescription.trim() || null,
                      }).then(async (result) => {
                        if (result.ok) {
                          await syncServer(active.id);
                          notify({ title: "Crystal Chat", body: "Server updated." });
                        } else {
                          notify({ title: "Crystal Chat", body: result.error.message });
                        }
                      })
                    }
                  >
                    Save changes
                  </Button>

                  {isOwner && (
                    <>
                      <hr className="cr-communities__rule" />
                      <h4>Transfer ownership</h4>
                      <div className="cr-communities__row">
                        <Textarea
                          value={transferTo}
                          onChange={(event) => setTransferTo(event.target.value)}
                          rows={1}
                          placeholder="username"
                          aria-label="New owner username"
                        />
                        <Button
                          size="sm"
                          disabled={!transferTo.trim()}
                          onClick={() =>
                            void transferCommunity(active.id, transferTo.trim()).then(async (result) => {
                              if (result.ok) {
                                setTransferTo("");
                                await syncServer(active.id);
                                notify({ title: "Crystal Chat", body: "Ownership transferred." });
                              } else {
                                notify({ title: "Crystal Chat", body: result.error.message });
                              }
                            })
                          }
                        >
                          Transfer
                        </Button>
                      </div>

                      <hr className="cr-communities__rule" />
                      <h4>Delete this server</h4>
                      <p className="cr-communities__hint">
                        Type the server name to confirm. Every channel, message and role is gone for
                        everyone.
                      </p>
                      <div className="cr-communities__row">
                        <Textarea
                          value={confirmDelete}
                          onChange={(event) => setConfirmDelete(event.target.value)}
                          rows={1}
                          placeholder={active.name}
                          aria-label="Confirm server name"
                        />
                        <Button
                          variant="danger"
                          size="sm"
                          disabled={confirmDelete !== active.name}
                          onClick={() =>
                            void deleteCommunity(active.id).then(async (result) => {
                              if (result.ok) {
                                setSettingsOpen(false);
                                setActiveId(null);
                                setChannels([]);
                                setMembers([]);
                                setRoles([]);
                                setMessages([]);
                                setActiveChannel(null);
                                await refreshServers();
                              } else {
                                notify({ title: "Crystal Chat", body: result.error.message });
                              }
                            })
                          }
                        >
                          Delete server
                        </Button>
                      </div>
                    </>
                  )}
                </>
              ) : (
                <p className="cr-communities__hint">You cannot change this server's settings.</p>
              )}
            </div>
          )}

          {settingsTab === "members" && (
            <div className="cr-communities__settings-section">
              {members.map((member) => (
                <div key={member.userId} className="cr-communities__member-row">
                  <span>
                    {member.displayName}
                    <UserTag tags={member.tags} />
                  </span>
                  <small>@{member.username}</small>
                  {member.userId === active.owner.id ? (
                    <Badge>Owner</Badge>
                  ) : (
                    <select
                      className="cr-communities__select"
                      value={member.roleId ?? ""}
                      aria-label={`Role for ${member.displayName}`}
                      onChange={(event) => {
                        const roleId = event.target.value || null;
                        void assignRole(active.id, member.userId, roleId).then(async (result) => {
                          if (result.ok) {
                            await syncServer(active.id);
                          } else {
                            notify({ title: "Crystal Chat", body: result.error.message });
                          }
                        });
                      }}
                    >
                      <option value="">No role</option>
                      {roles
                        .filter((role) => !role.isOwner)
                        .map((role) => (
                          <option key={role.id} value={role.id}>
                            {role.name}
                          </option>
                        ))}
                    </select>
                  )}
                  {canKick && member.userId !== account.id && (
                    <IconButton
                      label={`Remove @${member.username}`}
                      icon="trash"
                      size={12}
                      onClick={() =>
                        void kickMember(active.id, member.userId).then(async (result) => {
                          if (result.ok) {
                            await syncServer(active.id);
                          } else {
                            notify({ title: "Crystal Chat", body: result.error.message });
                          }
                        })
                      }
                    />
                  )}
                </div>
              ))}
            </div>
          )}

          {settingsTab === "roles" && (
            <div className="cr-communities__settings-section">
              {!canManageRoles ? (
                <p className="cr-communities__hint">You cannot manage roles in this server.</p>
              ) : (
                <>
                  {roles.map((role) => (
                    <div key={role.id} className="cr-communities__member-row">
                      <strong style={role.color ? { color: role.color } : undefined}>{role.name}</strong>
                      <small>{role.isOwner ? "Everyone" : describePerms(role.permissions)}</small>
                      {!role.isOwner && (
                        <>
                          <Button
                            size="sm"
                            onClick={() => {
                              setEditingRoleId(role.id);
                              setRoleName(role.name);
                              setRolePerms(role.permissions);
                            }}
                          >
                            Edit
                          </Button>
                          {!role.isDefault && (
                            <IconButton
                              label={`Delete ${role.name}`}
                              icon="trash"
                              size={12}
                              onClick={() =>
                                void deleteRole(role.id).then(async (result) => {
                                  if (result.ok) {
                                    await syncServer(active.id);
                                  } else {
                                    notify({ title: "Crystal Chat", body: result.error.message });
                                  }
                                })
                              }
                            />
                          )}
                        </>
                      )}
                    </div>
                  ))}

                  <hr className="cr-communities__rule" />
                  <h4>{editingRoleId ? "Edit role" : "New role"}</h4>
                  <Textarea
                    value={roleName}
                    onChange={(event) => setRoleName(event.target.value)}
                    rows={1}
                    placeholder="Role name"
                    aria-label="Role name"
                    disabled={
                      !!editingRoleId && roles.find((role) => role.id === editingRoleId)?.isDefault === true
                    }
                  />
                  <div className="cr-communities__perms">
                    {Object.entries(PERM_LABEL).map(([bit, label]) => (
                      <label key={bit} className="cr-communities__perm">
                        <input
                          type="checkbox"
                          checked={(rolePerms & Number(bit)) === Number(bit)}
                          onChange={(event) =>
                            setRolePerms((current) =>
                              event.target.checked ? current | Number(bit) : current & ~Number(bit),
                            )
                          }
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                  <div className="cr-communities__row">
                    {editingRoleId && (
                      <Button
                        size="sm"
                        onClick={() => {
                          setEditingRoleId(null);
                          setRoleName("");
                          setRolePerms(0);
                        }}
                      >
                        Cancel
                      </Button>
                    )}
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={!roleName.trim()}
                      onClick={() => {
                        const request = editingRoleId
                          ? updateRole(editingRoleId, { name: roleName.trim(), permissions: rolePerms })
                          : createRole(active.id, roleName.trim(), rolePerms);
                        void request.then(async (result) => {
                          if (result.ok) {
                            setEditingRoleId(null);
                            setRoleName("");
                            setRolePerms(0);
                            await syncServer(active.id);
                          } else {
                            notify({ title: "Crystal Chat", body: result.error.message });
                          }
                        });
                      }}
                    >
                      {editingRoleId ? "Save role" : "Create role"}
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}

          {settingsTab === "invites" && (
            <div className="cr-communities__settings-section">
              {!canInvite ? (
                <p className="cr-communities__hint">You cannot create invites in this server.</p>
              ) : (
                <>
                  <div className="cr-communities__row">
                    <select
                      className="cr-communities__select"
                      value={inviteHours}
                      aria-label="Invite expiry"
                      onChange={(event) => setInviteHours(Number(event.target.value))}
                    >
                      <option value={0}>Never expires</option>
                      <option value={1}>1 hour</option>
                      <option value={24}>1 day</option>
                      <option value={168}>7 days</option>
                    </select>
                    <select
                      className="cr-communities__select"
                      value={inviteUses}
                      aria-label="Invite uses"
                      onChange={(event) => setInviteUses(Number(event.target.value))}
                    >
                      <option value={0}>Unlimited uses</option>
                      <option value={1}>1 use</option>
                      <option value={5}>5 uses</option>
                      <option value={10}>10 uses</option>
                    </select>
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() =>
                        void createInvite(active.id, {
                          ...(inviteHours ? { expiresInMs: inviteHours * 3_600_000 } : {}),
                          ...(inviteUses ? { maxUses: inviteUses } : {}),
                        }).then(async (result) => {
                          if (result.ok) {
                            setFreshInvite(result.data.invite.code);
                            setInviteOpen(true);
                            const listed = await listInvites(active.id);
                            if (listed.ok) setInvites(listed.data.invites);
                          } else {
                            notify({ title: "Crystal Chat", body: result.error.message });
                          }
                        })
                      }
                    >
                      Create invite
                    </Button>
                  </div>
                  {invites.length === 0 && (
                    <p className="cr-communities__hint">No invites yet — create one above.</p>
                  )}
                  {invites.map((invite) => (
                    <div key={invite.code} className="cr-communities__member-row">
                      <code>{invite.code}</code>
                      <small>
                        {invite.uses} uses{invite.maxUses ? ` / ${invite.maxUses}` : ""}
                        {invite.expiresAt
                          ? ` · expires ${formatExpiry(invite.expiresAt)}`
                          : " · never expires"}
                      </small>
                      {invite.revoked ? (
                        <Badge tone="danger">revoked</Badge>
                      ) : (
                        <IconButton
                          label="Revoke invite"
                          icon="trash"
                          size={12}
                          onClick={() =>
                            void revokeInvite(invite.code).then(async (result) => {
                              if (result.ok) {
                                const listed = await listInvites(active.id);
                                if (listed.ok) setInvites(listed.data.invites);
                              } else {
                                notify({ title: "Crystal Chat", body: result.error.message });
                              }
                            })
                          }
                        />
                      )}
                    </div>
                  ))}
                </>
              )}
            </div>
          )}

          {settingsTab === "audit" && (
            <div className="cr-communities__settings-section">
              {!canManageServer ? (
                <p className="cr-communities__hint">Only the server owner can read the audit log.</p>
              ) : audit.length === 0 ? (
                <p className="cr-communities__hint">No recorded actions yet.</p>
              ) : (
                audit.map((entry) => (
                  <div key={entry.id} className="cr-communities__audit-row">
                    <strong>{entry.action}</strong>
                    <span>{entry.actor ? entry.actor.displayName : "system"}</span>
                    {entry.detail && <small>{entry.detail}</small>}
                    <time>{formatRelative(entry.createdAt)}</time>
                  </div>
                ))
              )}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
