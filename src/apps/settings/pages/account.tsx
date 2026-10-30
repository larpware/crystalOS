import { useEffect, useRef, useState } from "react";
import {
  Badge,
  Button,
  EmptyState,
  Field,
  Modal,
  PasswordInput,
  Row,
  Section,
  TextInput,
  UserTag,
} from "@/components/ui";
import { AccountForm } from "@/shell/AccountForm";
import { RarityBadge, RarityGuideModal } from "@/components/rarity";
import { changePassword, forgetLegacyLocalAccounts, listLegacyLocalAccounts } from "@/services/auth";
import { uploadAvatar } from "@/services/supabaseStorage";
import { hasSupabaseConfig } from "@/lib/supabase";
import { mesh } from "@/services/messaging";
import { useAuthStore } from "@/state/auth";
import { useBrowserStore } from "@/state/browser";
import { useChatStore } from "@/state/chat";
import { useFsStore } from "@/state/fs";
import { useNotificationStore } from "@/state/notifications";
import { useSocialStore } from "@/state/social";
import { useWidgetStore } from "@/state/widgets";
import { listCustomWallpapers } from "@/wallpapers/custom";
import { formatRelative } from "@/utils/format";

/* ==========================================================================
   Settings — account, privacy and messaging
   ========================================================================== */

export function AccountsPage() {
  const auth = useAuthStore();
  const account = auth.account;
  const social = useSocialStore();
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [rarityOpen, setRarityOpen] = useState(false);
  const [legacy, setLegacy] = useState(() => listLegacyLocalAccounts());
  const [copied, setCopied] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const copyFriendCode = async () => {
    const code = account?.friendCode;
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied("Copied.");
    } catch {
      setCopied("This browser blocked clipboard access — select the code and copy it.");
    }
  };

  const pickAvatar = async (file: File) => {
    if (!file.type.startsWith("image/")) return;

    // A Supabase account stores the picture in the project's avatars bucket
    // and keeps a URL — the data-URL route embeds the bytes in the account
    // row instead. If the upload path is unavailable (no email session, the
    // bucket not migrated yet, the server offline), the classic data URL
    // still works, so the feature degrades instead of failing.
    if (auth.account?.supabaseLinked && hasSupabaseConfig()) {
      const uploaded = await uploadAvatar(file);
      if (uploaded.ok) {
        auth.setAvatar(uploaded.url);
        return;
      }
      console.debug("[supabase] avatar upload fell back to data URL:", uploaded.error);
    }

    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("Could not read that image."));
      reader.readAsDataURL(file);
    });
    auth.setAvatar(dataUrl);
  };

  return (
    <>
      <Section
        title="This profile"
        description={
          auth.serverOnline
            ? "Accounts live on the CrystalOS account server. Passwords are stored only as scrypt hashes, and friend codes are assigned by the server."
            : "The account server is not reachable, so accounts cannot be created or changed right now."
        }
      >
        {!account ? (
          <>
            <div className="cr-account-signin">
              <AccountForm />
              <Button variant="ghost" icon="user" onClick={auth.startGuestSession}>
                Continue as guest
              </Button>
            </div>
            <p className="cr-row__desc">
              Guest sessions work normally and keep everything on this device, but they have no
              friend code, no friends list and nothing that syncs.
            </p>
          </>
        ) : (
          <>
            <div className="cr-profile">
              <div className="cr-profile__avatar">
                {account.avatar ? (
                  <img src={account.avatar} alt="" />
                ) : (
                  <span>{account.displayName.slice(0, 1).toUpperCase()}</span>
                )}
              </div>
              <div className="cr-profile__body">
                <div className="cr-profile__name">
                  {account.displayName}
                  <UserTag tags={account.tags} />
                </div>
                <div className="cr-row__desc">
                  {account.guest ? "Guest session · no account and no friend code" : `@${account.username}`}
                </div>
                <div className="cr-profile__actions">
                  <Button size="sm" icon="image" onClick={() => fileRef.current?.click()}>
                    Change picture
                  </Button>
                  {account.avatar && (
                    <Button size="sm" variant="ghost" onClick={() => auth.setAvatar(undefined)}>
                      Remove picture
                    </Button>
                  )}
                  {account.guest && <Badge tone="warning">Guest</Badge>}
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="cr-visually-hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void pickAvatar(file);
                    event.target.value = "";
                  }}
                />
              </div>
            </div>

            {!account.guest && (
              <Row
                label="Friend code"
                description="Assigned when the account was created. It is permanent — there is no control anywhere in CrystalOS that can change it."
                control={
                  <div className="cr-friend-code">
                    <span className="cr-code">{account.friendCode ?? "—"}</span>
                    <Button size="sm" icon="copy" onClick={() => void copyFriendCode()}>
                      Copy
                    </Button>
                  </div>
                }
              />
            )}
            {!account.guest && (
              <Row
                label="Friend-code rarity"
                description="Drawn by the server once, alongside your friend code, and stored with the account. Cosmetic only — it carries no permissions and no privileges."
                control={
                  <div className="cr-friend-code">
                    <RarityBadge rarity={account.rarity} showRank />
                    <Button size="sm" icon="info" onClick={() => setRarityOpen(true)}>
                      Rarity guide
                    </Button>
                  </div>
                }
              />
            )}
            {!account.guest && copied && <p className="cr-row__desc">{copied}</p>}
            {!account.guest && (
              <Row
                label="Friends"
                description={
                  social.status === "online"
                    ? "Add people by code in Messages → Friends. Requests, acceptances and removals happen on the server."
                    : "The account server is unreachable, so the friends list is unavailable."
                }
                control={<Badge tone={social.status === "online" ? "success" : "warning"}>{social.friends.length} friends</Badge>}
              />
            )}

            <Field label="Display name" htmlFor="display-name">
              <TextInput
                id="display-name"
                value={account.displayName}
                onChange={(event) => void auth.updateProfile({ displayName: event.target.value })}
              />
            </Field>
            <Field
              label="Username"
              hint="Letters, numbers, dot, dash or underscore. Usernames are unique across all CrystalOS accounts."
              htmlFor="username"
            >
              <TextInput
                id="username"
                value={account.username}
                disabled={account.guest}
                onChange={(event) => void auth.updateProfile({ username: event.target.value })}
              />
            </Field>
            <Field label="Bio" htmlFor="bio">
              <TextInput
                id="bio"
                value={account.bio ?? ""}
                onChange={(event) => void auth.updateProfile({ bio: event.target.value })}
              />
            </Field>

            {auth.error && <p className="cr-field__error">{auth.error}</p>}

            <div className="cr-button-row">
              {!account.guest && (
                <Button icon="lock" onClick={() => setPasswordOpen(true)}>
                  Change password
                </Button>
              )}
              <Button variant="ghost" icon="log-out" onClick={() => setSignOutOpen(true)}>
                Sign out
              </Button>
              {!account.guest && (
                <Button variant="danger" icon="trash" onClick={() => setDeleteOpen(true)}>
                  Delete account
                </Button>
              )}
            </div>
          </>
        )}
      </Section>

      <Section title="Guest mode">
        <Row
          label="Current mode"
          description="Guests have no server account: no friend code, no friends list, and no messages that leave this browser."
          control={<Badge tone={auth.mode === "guest" ? "warning" : "success"}>{auth.mode === "guest" ? "Guest" : account ? "Registered" : "Signed out"}</Badge>}
        />
        {auth.mode !== "guest" && (
          <Row
            label="Switch to guest"
            description="Your account stays on the server; sign back in at any time from the lock screen or here."
            control={
              <Button icon="user" onClick={auth.startGuestSession}>
                Use guest mode
              </Button>
            }
          />
        )}
      </Section>

      {legacy.length > 0 && (
        <Section
          title="Profiles from an earlier build"
          description="Older CrystalOS builds kept accounts inside this browser. Those records are not accounts any more — friend codes now belong to server accounts — so they are no longer used for signing in."
        >
          <Row
            label={`${legacy.length} local profile${legacy.length === 1 ? "" : "s"}`}
            description={legacy.map((entry) => entry.username).join(", ")}
            control={
              <Button
                variant="danger"
                icon="trash"
                onClick={() => {
                  forgetLegacyLocalAccounts();
                  setLegacy([]);
                }}
              >
                Remove this data
              </Button>
            }
          />
        </Section>
      )}

      <Modal
        open={signOutOpen}
        title="Sign out of this profile?"
        onClose={() => setSignOutOpen(false)}
        footer={
          <>
            <Button onClick={() => setSignOutOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              icon="log-out"
              onClick={() => {
                auth.signOut();
                setSignOutOpen(false);
              }}
            >
              Sign out
            </Button>
          </>
        }
      >
        <p className="cr-row__desc">
          Signing out ends the session on the account server and returns you to the lock screen.
          Your local files and settings stay on this device.
        </p>
      </Modal>

      <PasswordModal open={passwordOpen} onClose={() => setPasswordOpen(false)} />
      <DeleteAccountModal open={deleteOpen} onClose={() => setDeleteOpen(false)} />
      <RarityGuideModal open={rarityOpen} onClose={() => setRarityOpen(false)} />
    </>
  );
}

function DeleteAccountModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const removeAccount = useAuthStore((state) => state.removeAccount);
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <Modal
      open={open}
      title="Delete this account?"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="danger"
            icon="trash"
            disabled={busy || !password}
            onClick={async () => {
              setBusy(true);
              const ok = await removeAccount(password);
              setBusy(false);
              setPassword("");
              if (ok) {
                onClose();
                return;
              }
              setMessage(useAuthStore.getState().error ?? "Could not delete the account.");
            }}
          >
            {busy ? "Deleting…" : "Delete account"}
          </Button>
        </>
      }
    >
      <p className="cr-row__desc">
        This removes the account, its friend code, its friends and every message stored with it, on
        the server. It cannot be undone.
      </p>
      <Field label="Confirm with your password">
        <PasswordInput
          value={password}
          autoComplete="current-password"
          onChange={(event) => {
            setPassword(event.target.value);
            setMessage(null);
          }}
        />
      </Field>
      {message && <p className="cr-field__error">{message}</p>}
    </Modal>
  );
}

function PasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <Modal
      open={open}
      title="Change password"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={busy || !current || !next}
            onClick={async () => {
              setBusy(true);
              const result = await changePassword(current, next);
              setBusy(false);
              setMessage(result.ok ? "Password updated." : (result.error ?? "Could not update."));
              if (result.ok) {
                setCurrent("");
                setNext("");
              }
            }}
          >
            {busy ? "Saving…" : "Update password"}
          </Button>
        </>
      }
    >
      <Field label="Current password">
        <PasswordInput
          value={current}
          autoComplete="current-password"
          onChange={(event) => setCurrent(event.target.value)}
        />
      </Field>
      <Field label="New password" hint="At least 8 characters. Other sessions are signed out.">
        <PasswordInput
          value={next}
          autoComplete="new-password"
          onChange={(event) => setNext(event.target.value)}
        />
      </Field>
      {message && <p className="cr-row__desc">{message}</p>}
    </Modal>
  );
}

/* ---- privacy ----------------------------------------------------------- */

export function PrivacyPage() {
  const fs = useFsStore();
  const browser = useBrowserStore();
  const notifications = useNotificationStore();
  const chat = useChatStore();
  const widgets = useWidgetStore();
  const auth = useAuthStore();

  const [wallpapers, setWallpapers] = useState(listCustomWallpapers().length);
  const [confirm, setConfirm] = useState<null | (() => void)>(null);

  useEffect(() => {
    setWallpapers(listCustomWallpapers().length);
  }, []);

  return (
    <>
      <Section
        title="What CrystalOS stores"
        description="Everything below is kept in this browser profile. The exceptions are stated in each row: a signed-in account, its friends and its friend codes live on the CrystalOS account server."
      >
        <Row
          label="Account"
          description="On the server: username, display name, scrypt password hash and the assigned friend code. Never the password itself."
          control={<Badge tone={auth.mode === "signed-in" ? "success" : "warning"}>{auth.mode === "signed-in" ? "Signed in" : "Local only"}</Badge>}
        />
        <Row label="Filesystem entries" control={<span className="cr-num">{fs.nodes.length}</span>} />
        <Row label="Imported wallpapers" control={<span className="cr-num">{wallpapers}</span>} />
        <Row label="Browser history" control={<span className="cr-num">{browser.history.length}</span>} />
        <Row
          label="Chat messages"
          description="Direct messages between friends are also stored on the account server so the other person receives them."
          control={<span className="cr-num">{Object.values(chat.messages).flat().length}</span>}
        />
        <Row label="Notifications kept" control={<span className="cr-num">{notifications.history.length}</span>} />
        <Row label="Widgets placed" control={<span className="cr-num">{widgets.instances.length}</span>} />
      </Section>

      <Section title="Permissions" description="CrystalOS asks for browser permissions only when an application needs them.">
        <Row
          label="Microphone and camera"
          description="Requested by Messages when you start or accept a call, never before."
          control={<Badge>On demand</Badge>}
        />
        <Row
          label="Notifications"
          description="In-OS notifications are drawn by the shell. CrystalOS never asks for browser notifications."
          control={<Badge>Not requested</Badge>}
        />
        <Row
          label="Clipboard"
          description="Used only when you press a copy button, through the Clipboard API."
          control={<Badge>On demand</Badge>}
        />
        <Row
          label="Files"
          description="Files you import are read locally and copied into the virtual filesystem."
          control={<Badge>On demand</Badge>}
        />
      </Section>

      <Section title="Network requests" description="CrystalOS itself makes very few requests.">
        <Row
          label="Wallpaper CDN"
          description="Built-in photographic wallpapers load from an image CDN. If a request fails, the wallpaper falls back to its generated gradient."
        />
        <Row
          label="Game catalogue"
          description="Games are embedded from their publisher's host when you press Play."
        />
        <Row
          label="Proxy"
          description="Only when the CrystalOS proxy is enabled in Browser settings."
        />
        <Row
          label="Account server"
          description="/api/accounts/* on this origin: session, profile, friend codes, friend requests and direct messages."
          control={<Badge tone={auth.serverOnline ? "success" : "warning"}>{auth.serverOnline ? "Reachable" : "Unreachable"}</Badge>}
        />
      </Section>

      <Section title="Erase" description="Each action only touches its own data.">
        <div className="cr-button-row">
          <Button
            variant="danger"
            icon="trash"
            onClick={() => setConfirm(() => () => fs.resetToSeed())}
          >
            Reset filesystem
          </Button>
          <Button
            variant="danger"
            icon="trash"
            onClick={() => setConfirm(() => () => browser.clearHistory())}
          >
            Clear browsing history
          </Button>
          <Button
            variant="danger"
            icon="trash"
            onClick={() => setConfirm(() => () => notifications.clearHistory())}
          >
            Clear notifications
          </Button>
          <Button
            variant="danger"
            icon="trash"
            onClick={() => setConfirm(() => () => chat.reset())}
          >
            Clear messages and servers
          </Button>
        </div>
        <p className="cr-row__desc">
          Erasing means the data is removed from this browser. Your account, friends and sent
          messages live on the account server instead — delete the account below to remove those.
        </p>
      </Section>

      <Modal
        open={confirm !== null}
        title="Erase this data?"
        onClose={() => setConfirm(null)}
        footer={
          <>
            <Button onClick={() => setConfirm(null)}>Cancel</Button>
            <Button
              variant="danger"
              icon="trash"
              onClick={() => {
                confirm?.();
                setConfirm(null);
              }}
            >
              Erase
            </Button>
          </>
        }
      >
        <p className="cr-row__desc">This cannot be undone.</p>
      </Modal>
    </>
  );
}

/* ---- messaging --------------------------------------------------------- */

export function MessagingPage() {
  const chat = useChatStore();
  const auth = useAuthStore();
  const social = useSocialStore();
  const [queried, setQueried] = useState(false);

  const transportLabel =
    chat.transport === "local"
      ? "Local mesh (BroadcastChannel)"
      : chat.transport === "offline"
        ? "Unavailable"
        : chat.transport;

  const registered = Boolean(auth.account) && !auth.account?.guest;

  return (
    <>
      <Section
        title="How messages travel"
        description={
          registered
            ? "Direct messages between friends go through the CrystalOS account server, so they arrive on any machine your friend is signed in on. The local mesh still runs alongside it for sessions of the same account."
            : "Without an account, messaging uses a local transport that only reaches CrystalOS sessions in this browser profile — several tabs or windows on this machine."
        }
      >
        <Row
          label="Account server"
          description="Stores friendships, friend requests and the direct messages between friends."
          control={
            <Badge tone={social.status === "online" ? "success" : social.status === "idle" ? "warning" : "warning"}>
              {social.status === "online" ? "Connected" : social.status === "connecting" ? "Connecting" : "Not signed in"}
            </Badge>
          }
        />
        <Row
          label="Friends"
          description="Accepted friendships on your account. Manage them in Messages → Friends."
          control={<span className="cr-num">{social.friends.length}</span>}
        />
        <Row
          label="Pending requests"
          description="Incoming plus outgoing requests waiting on the server."
          control={<span className="cr-num">{social.incoming.length + social.outgoing.length}</span>}
        />
        <Row label="Local mesh status" control={<Badge tone={chat.transport === "local" ? "success" : "warning"}>{transportLabel}</Badge>} />
        <Row label="BroadcastChannel support" control={<Badge>{mesh.available ? "Available" : "Unavailable"}</Badge>} />
        <Row label="Sessions on this machine" control={<span className="cr-num">{chat.peers.length}</span>} />
        <Row
          label="Your friend code"
          description="Assigned by the server at registration. It cannot be chosen, edited or regenerated — there is no API that accepts one."
          control={<span className="cr-code">{auth.account?.friendCode ?? (auth.account?.guest ? "Guests have none" : "Sign in first")}</span>}
        />
      </Section>

      <Section title="Reachable sessions">
        {chat.peers.length === 0 ? (
          <EmptyState
            icon="users"
            title="No other sessions found"
            hint="Open CrystalOS in a second tab or window, sign in with a different profile, then send a friend request using the friend code shown here."
          />
        ) : (
          chat.peers.map((peer) => (
            <Row
              key={peer.peer.id}
              label={peer.peer.displayName}
              description={`${peer.peer.friendCode} · seen ${formatRelative(peer.lastSeen)}`}
              control={
                <Button
                  size="sm"
                  icon="messages"
                  onClick={() => {
                    chat.createDirectChannel(peer.peer);
                    setQueried(true);
                  }}
                >
                  Message
                </Button>
              }
            />
          ))
        )}
        {queried && <p className="cr-row__desc">Direct chat opened in Messages.</p>}
      </Section>

      <Section title="Calls">
        <Row
          label="Media transport"
          description="Calls are real WebRTC sessions between the connected browsers. Media never passes through a server."
          control={<Badge tone="success">WebRTC</Badge>}
        />
        <Row
          label="STUN servers"
          description="Public STUN is used for address discovery. Networks that force relay traffic need a TURN server, which this build does not provide."
          control={<Badge tone="warning">TURN not configured</Badge>}
        />
        <Row
          label="Call state"
          description={chat.call.error ?? "Idle"}
          control={<Badge>{chat.call.state}</Badge>}
        />
      </Section>

      <Section
        title="What still needs a relay"
        description="Friendships and direct messages are server-backed. Two things are not, and this build says so rather than pretending otherwise."
      >
        <Row
          label="WebRTC call signalling"
          description="Call offers and ICE candidates still travel over the local mesh, so a call works between two sessions in this browser. A WebSocket relay forwarding the same envelopes would extend calls to other machines without changing the call code."
          stacked
        >
          <span className="cr-code cr-code--wrap">
            ws://your-host/relay · forward {"{ kind, from, to, payload, at }"} to every other socket
          </span>
        </Row>
        <Row
          label="Live delivery"
          description="New messages are polled from the account server every few seconds. A push channel would remove that delay; the data model already supports it."
        />
      </Section>

      <Section title="Storage">
        <Row
          label="Local message history"
          description="Clears this browser's copy of the conversations, including the channel list. Messages already delivered to friends stay on the account server."
          control={
            <Button variant="danger" icon="trash" onClick={chat.reset}>
              Clear all messages
            </Button>
          }
        />
      </Section>
    </>
  );
}
