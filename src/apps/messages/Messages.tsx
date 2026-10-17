import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, EmptyState, IconButton, Modal, TextInput, Tooltip } from "@/components/ui";
import { Icon } from "@/icons/Icon";
import { notify } from "@/services/os";
import { useAuthStore } from "@/state/auth";
import { channelsFromServer, useChatStore } from "@/state/chat";
import { useSocialStore } from "@/state/social";
import type { Channel, ChatMessage } from "@/types";
import { CallOverlay } from "./CallOverlay";
import { FriendsPanel } from "./FriendsPanel";

/* ==========================================================================
   Messages

   Two transports, and the interface never confuses them:

   - Registered accounts talk through the CrystalOS account server, so a direct
     message reaches the other person on any machine. Friends, requests and
     friend codes are all server-side (see FriendsPanel).
   - Everyone else has the local mesh, which connects CrystalOS sessions in this
     browser profile for instant messaging and WebRTC signalling.
   ========================================================================== */

function channelName(channel: Channel, friends: { id: string; displayName: string }[]): string {
  if (channel.kind === "direct") {
    return channel.peerName || friends.find((friend) => friend.id === channel.peerId)?.displayName || "Direct message";
  }
  return channel.name;
}

function channelIcon(channel: Channel) {
  if (channel.kind === "direct") return "user" as const;
  if (channel.kind === "group") return "users" as const;
  return "hash" as const;
}

export function Messages() {
  const chat = useChatStore();
  const account = useAuthStore((state) => state.account);
  const attach = useChatStore((state) => state.attach);
  const detach = useChatStore((state) => state.detach);

  const social = useSocialStore();
  const [composer, setComposer] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [serverModal, setServerModal] = useState(false);
  const [serverName, setServerName] = useState("");
  const [channelModal, setChannelModal] = useState(false);
  const [channelNameInput, setChannelNameInput] = useState("");
  const [groupModal, setGroupModal] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [showMembers, setShowMembers] = useState(true);

  const scrollRef = useRef<HTMLDivElement>(null);
  const typingRef = useRef(0);

  /* The mesh transport is bound to the signed-in profile for the app's life. */
  useEffect(() => {
    if (account) attach(account);
    return () => detach();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account?.id]);

  const activeChannel = chat.channels.find((channel) => channel.id === chat.activeChannelId) ?? null;
  const messages = activeChannel ? (chat.messages[activeChannel.id] ?? []) : [];
  const activeServer =
    activeChannel?.kind === "server"
      ? chat.servers.find((server) => server.id === activeChannel.serverId)
      : undefined;

  useEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages.length, activeChannel?.id]);

  const directChannels = chat.channels.filter((channel) => channel.kind === "direct");
  const groupChannels = chat.channels.filter((channel) => channel.kind === "group");
  const typingHere = activeChannel ? (chat.typing[activeChannel.id] ?? []) : [];

  const memberIds = useMemo(() => {
    if (!activeChannel) return [];
    if (activeChannel.kind === "group") return activeChannel.memberIds;
    if (activeChannel.kind === "direct") return [activeChannel.peerId];
    const server = chat.servers.find((entry) => entry.id === activeChannel.serverId);
    return server?.memberIds ?? [];
  }, [activeChannel, chat.servers]);

  const send = () => {
    if (!activeChannel) return;
    const body = composer.trim();
    if (!body) return;
    chat.sendMessage(activeChannel.id, body);
    setComposer("");
  };

  const onComposerChange = (value: string) => {
    setComposer(value);
    if (!activeChannel) return;
    const now = Date.now();
    if (now - typingRef.current > 1800 && value.trim()) {
      typingRef.current = now;
      chat.signalTyping(activeChannel.id);
    }
  };

  /** Copies this account's friend code, with an honest fallback when blocked. */
  const copyFriendCode = async () => {
    const code = account?.friendCode;
    if (!code) {
      setCopied("Sign in with an account first: guest sessions have no friend code.");
      return;
    }
    try {
      await navigator.clipboard.writeText(code);
      setCopied(`Copied ${code} to the clipboard.`);
    } catch {
      setCopied(`This browser blocked clipboard access. Your code is ${code}.`);
    }
  };

  const isRegistered = Boolean(account) && !account?.guest;

  const canCall = activeChannel?.kind === "direct";
  const callPeerId = activeChannel?.kind === "direct" ? activeChannel.peerId : null;

  return (
    <div className="cr-messages">
      <aside className="cr-messages__rail">
        <div className="cr-messages__identity">
          <div className="cr-messages__avatar">
            {account?.avatar ? (
              <img src={account.avatar} alt="" />
            ) : (
              <span>{(account?.displayName ?? "?").slice(0, 1).toUpperCase()}</span>
            )}
          </div>
          <div className="cr-messages__identity-text">
            <span>{account?.displayName ?? "Not signed in"}</span>
            <span className="cr-messages__identity-code">
              <span className="cr-code cr-code--sm">{account?.friendCode ?? "—"}</span>
              <IconButton
                icon="copy"
                size={12}
                label="Copy my friend code"
                disabled={!account}
                onClick={() => void copyFriendCode()}
              />
            </span>
          </div>
        </div>

        <p className="cr-messages__identity-hint">
          {isRegistered
            ? "Your friend code is assigned by CrystalOS and cannot be edited or regenerated. Share it — the other person adds you with it."
            : "Guest session: no account, no friend code, and messages stay on this machine."}
        </p>
        {copied && <p className="cr-messages__friend-message">{copied}</p>}

        <div
          className="cr-messages__transport"
          data-state={isRegistered ? (social.status === "online" ? "local" : "offline") : chat.transport}
        >
          <Icon
            name={isRegistered ? (social.status === "online" ? "server" : "warning") : chat.transport === "local" ? "activity" : "warning"}
            size={13}
          />
          <span>
            {isRegistered
              ? social.status === "online"
                ? `Account server · ${social.friends.length} friend${social.friends.length === 1 ? "" : "s"}`
                : social.status === "connecting"
                  ? "Connecting to the account server…"
                  : "Account server unreachable"
              : chat.transport === "local"
                ? `Local transport · ${chat.peers.length} peer${chat.peers.length === 1 ? "" : "s"}`
                : "Transport unavailable"}
          </span>
        </div>

        <section className="cr-messages__rail-section">
          <header>
            <span>Direct messages</span>
            <IconButton
              icon="users"
              label="New group"
              size={13}
              onClick={() => setGroupModal(true)}
            />
          </header>
          {directChannels.length === 0 && groupChannels.length === 0 && (
            <p className="cr-messages__rail-hint">
              No conversations yet. Add a friend below, or open a DM from a connected session.
            </p>
          )}
          {[...directChannels, ...groupChannels].map((channel) => (
            <button
              key={channel.id}
              type="button"
              className="cr-messages__channel"
              aria-current={channel.id === chat.activeChannelId}
              onClick={() => chat.setActiveChannel(channel.id)}
            >
              <Icon name={channelIcon(channel)} size={14} />
              <span>{channelName(channel, chat.friends)}</span>
            </button>
          ))}
        </section>

        <section className="cr-messages__rail-section">
          <header>
            <span>Servers</span>
            <IconButton icon="plus" label="Create server" size={13} onClick={() => setServerModal(true)} />
          </header>
          {chat.servers.length === 0 && (
            <p className="cr-messages__rail-hint">
              Servers hold channels and members. Create one, or ask a connected session to share
              theirs from the friend list.
            </p>
          )}
          {chat.servers.map((server) => (
            <div key={server.id} className="cr-messages__server">
              <div className="cr-messages__server-head">
                <Icon name="server" size={14} />
                <span>{server.name}</span>
                <IconButton
                  icon="plus"
                  label={`Add channel to ${server.name}`}
                  size={12}
                  onClick={() => {
                    setChannelModal(true);
                    chat.setActiveChannel(channelsFromServer(server)[0]?.id ?? null);
                  }}
                />
              </div>
              {channelsFromServer(server).map((channel) => (
                <button
                  key={channel.id}
                  type="button"
                  className="cr-messages__channel cr-messages__channel--nested"
                  aria-current={channel.id === chat.activeChannelId}
                  onClick={() => chat.setActiveChannel(channel.id)}
                >
                  <Icon name="hash" size={13} />
                  <span>{channelName(channel, chat.friends)}</span>
                </button>
              ))}
            </div>
          ))}
        </section>

        <FriendsPanel />
      </aside>

      <div className="cr-messages__main">
        {activeChannel ? (
          <>
            <header className="cr-messages__head">
              <Icon name={channelIcon(activeChannel)} size={16} />
              <div className="cr-messages__head-text">
                <span>{channelName(activeChannel, chat.friends)}</span>
                <span className="cr-row__desc">
                  {activeChannel.kind === "direct"
                    ? chat.peers.some((state) => state.peer.id === activeChannel.peerId)
                      ? "Online"
                      : "Offline"
                    : activeChannel.kind === "group"
                      ? `${activeChannel.memberIds.length} members`
                      : `${activeServer?.name ?? "Server"} · ${memberIds.length} members`}
                </span>
              </div>
              {canCall && (
                <div className="cr-messages__call-actions">
                  <Tooltip label="Voice call">
                    <IconButton
                      icon="phone"
                      label="Start voice call"
                      disabled={!callPeerId}
                      onClick={() =>
                        callPeerId &&
                        chat.startCall(
                          "audio",
                          callPeerId,
                          channelName(activeChannel, chat.friends),
                        )
                      }
                    />
                  </Tooltip>
                  <Tooltip label="Video call">
                    <IconButton
                      icon="video-cam"
                      label="Start video call"
                      disabled={!callPeerId}
                      onClick={() =>
                        callPeerId &&
                        chat.startCall(
                          "video",
                          callPeerId,
                          channelName(activeChannel, chat.friends),
                        )
                      }
                    />
                  </Tooltip>
                </div>
              )}
              <IconButton
                icon={showMembers ? "collapse" : "users"}
                label={showMembers ? "Hide members" : "Show members"}
                onClick={() => setShowMembers((value) => !value)}
              />
              {activeChannel.kind === "group" && (
                <IconButton
                  icon="log-out"
                  label="Leave group"
                  onClick={() => chat.leaveChannel(activeChannel.id)}
                />
              )}
            </header>

            <div className="cr-messages__scroll" ref={scrollRef}>
              {messages.length === 0 ? (
                <EmptyState
                  icon="messages"
                  title={`This is the start of ${channelName(activeChannel, chat.friends)}`}
                  hint={
                    isRegistered
                      ? social.status === "online"
                        ? "Messages go through the CrystalOS account server, so they reach your friend wherever they are signed in."
                        : "The account server is unreachable, so messages cannot be delivered right now."
                      : chat.transport === "local"
                        ? "Messages reach other CrystalOS sessions open in this browser. Nothing leaves the machine."
                        : "The messaging transport is unavailable, so messages will not be delivered."
                  }
                />
              ) : (
                <MessageList messages={messages} selfId={chat.selfId} friends={chat.friends} />
              )}
            </div>

            <footer className="cr-messages__composer">
              <div className="cr-messages__composer-box">
                <textarea
                  className="cr-messages__input"
                  value={composer}
                  rows={1}
                  placeholder={`Message ${channelName(activeChannel, chat.friends)}`}
                  onChange={(event) => onComposerChange(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      send();
                    }
                  }}
                />
                <IconButton icon="send" label="Send message" onClick={send} disabled={!composer.trim()} />
              </div>
              <div className="cr-messages__composer-foot">
                <span className="cr-row__desc">
                  {typingHere.length > 0
                    ? typingHere.map((entry) => entry.name).join(", ") +
                      (typingHere.length === 1 ? " is typing…" : " are typing…")
                    : "Enter sends · Shift + Enter adds a line"}
                </span>
                <span className="cr-row__desc cr-messages__length">{composer.length}/2000</span>
              </div>
            </footer>
          </>
        ) : (
          <EmptyState
            icon="messages"
            title="No conversation open"
            hint="Pick a direct message, group or channel on the left. If nothing is listed yet, add a friend by code or connect a second CrystalOS session in another tab."
            action={
              <Button icon="user-plus" variant="primary" onClick={() => setCreateOpen(true)}>
                How connections work
              </Button>
            }
          />
        )}
      </div>

      {showMembers && activeChannel && (
        <aside className="cr-messages__members">
          <header>
            <span>Members</span>
            <Badge>{memberIds.length}</Badge>
          </header>
          {memberIds.length === 0 && <p className="cr-messages__rail-hint">No members recorded.</p>}
          {memberIds.map((id) => {
            const friend = chat.friends.find((entry) => entry.id === id);
            const online = chat.peers.some((state) => state.peer.id === id);
            return (
              <div key={id} className="cr-messages__member">
                <span className="cr-messages__presence" data-online={online} />
                <span>{friend?.displayName ?? (id === chat.selfId ? "You" : id.slice(0, 8))}</span>
              </div>
            );
          })}
          <div className="cr-messages__members-foot">
            <Button
              size="sm"
              variant="ghost"
              icon="share"
              onClick={() => {
                const result = chat.requestServersFrom(chat.peers[0]?.peer.id ?? "");
                notify({ title: "Server share", body: result.message, icon: "server" });
              }}
              disabled={chat.peers.length === 0}
            >
              Ask a peer for servers
            </Button>
          </div>
        </aside>
      )}

      <CallOverlay
        snapshot={chat.call}
        onAccept={chat.acceptCall}
        onEnd={chat.endCall}
        onToggleMute={chat.toggleMute}
        onToggleCamera={chat.toggleCamera}
      />

      <Modal open={createOpen} title="How connections work" onClose={() => setCreateOpen(false)}>
        <div className="cr-messages__help">
          <p>
            A registered account has a friend code that CrystalOS assigns, and the account server
            keeps the friends list. Add someone by entering their code; they accept once and the
            friendship is mutual on both accounts.
          </p>
          <p>
            Direct messages between friends go through the account server, so they arrive on any
            machine the other person is signed in on. Messages you send while the server is down stay
            in this window and are not delivered.
          </p>
          <p>
            Guest sessions have no account: they use a local transport that reaches other CrystalOS
            sessions in this browser profile, and sessions of the same account still reach each other
            that way.
          </p>
          <p>
            Calls are WebRTC: media goes browser to browser and never through a server. Signalling
            uses the local transport, so calls work between two sessions in this browser.
          </p>
        </div>
      </Modal>

      <Modal
        open={serverModal}
        title="Create a server"
        onClose={() => setServerModal(false)}
        footer={
          <>
            <Button onClick={() => setServerModal(false)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!serverName.trim()}
              onClick={() => {
                chat.createServer(serverName.trim());
                setServerName("");
                setServerModal(false);
              }}
            >
              Create
            </Button>
          </>
        }
      >
        <p className="cr-row__desc">
          A server starts with a single #general channel. Connected friends can be given access by
          sharing the server from their member list.
        </p>
        <TextInput
          value={serverName}
          placeholder="Server name"
          aria-label="Server name"
          onChange={(event) => setServerName(event.target.value)}
        />
      </Modal>

      <Modal
        open={channelModal}
        title="New channel"
        onClose={() => setChannelModal(false)}
        footer={
          <>
            <Button onClick={() => setChannelModal(false)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!channelNameInput.trim() || !activeServer}
              onClick={() => {
                if (activeServer) chat.createServerChannel(activeServer.id, channelNameInput.trim());
                setChannelNameInput("");
                setChannelModal(false);
              }}
            >
              Create channel
            </Button>
          </>
        }
      >
        <TextInput
          value={channelNameInput}
          placeholder="channel-name"
          aria-label="Channel name"
          onChange={(event) => setChannelNameInput(event.target.value)}
        />
        {!activeServer && <p className="cr-row__desc">Select a server first.</p>}
      </Modal>

      <Modal
        open={groupModal}
        title="New group"
        onClose={() => setGroupModal(false)}
        footer={
          <>
            <Button onClick={() => setGroupModal(false)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!groupName.trim() || selectedMembers.length === 0}
              onClick={() => {
                const members = chat.friends.filter((friend) => selectedMembers.includes(friend.id));
                chat.createGroup(groupName.trim(), members);
                setGroupName("");
                setSelectedMembers([]);
                setGroupModal(false);
              }}
            >
              Create group
            </Button>
          </>
        }
      >
        <p className="cr-row__desc">
          A group is created locally and announced to the members over the transport.
        </p>
        <TextInput
          value={groupName}
          placeholder="Group name"
          aria-label="Group name"
          onChange={(event) => setGroupName(event.target.value)}
        />
        <div className="cr-messages__member-picker">
          {chat.friends.length === 0 && <p className="cr-row__desc">Add friends first.</p>}
          {chat.friends.map((friend) => (
            <label key={friend.id} className="cr-messages__member-option">
              <input
                type="checkbox"
                checked={selectedMembers.includes(friend.id)}
                onChange={(event) =>
                  setSelectedMembers((current) =>
                    event.target.checked
                      ? [...current, friend.id]
                      : current.filter((id) => id !== friend.id),
                  )
                }
              />
              <span>{friend.displayName}</span>
              <span className="cr-code cr-code--sm">{friend.friendCode}</span>
            </label>
          ))}
        </div>
      </Modal>
    </div>
  );
}

function MessageList({
  messages,
  selfId,
  friends,
}: {
  messages: ChatMessage[];
  selfId: string | null;
  friends: { id: string; displayName: string }[];
}) {
  let lastDay = "";
  return (
    <div className="cr-messages__list">
      {messages.map((message) => {
        const day = new Date(message.sentAt).toDateString();
        const showDay = day !== lastDay;
        lastDay = day;
        const own = message.authorId === selfId;
        const author = own
          ? "You"
          : message.authorName || friends.find((friend) => friend.id === message.authorId)?.displayName || "Unknown";
        return (
          <div key={message.id}>
            {showDay && (
              <div className="cr-messages__day">
                <span>{day}</span>
              </div>
            )}
            <div className="cr-messages__message" data-own={own}>
              <div className="cr-messages__message-head">
                <span className="cr-messages__author">{author}</span>
                <span className="cr-messages__time cr-num">
                  {new Date(message.sentAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
              <p className="cr-messages__body">{message.body}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default Messages;
