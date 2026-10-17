import { useState, type FormEvent } from "react";
import { Badge, Button, IconButton, TextInput } from "@/components/ui";
import { Icon } from "@/icons/Icon";
import { openApp } from "@/services/os";
import { useAuthStore } from "@/state/auth";
import { useChatStore } from "@/state/chat";
import { useSocialStore } from "@/state/social";
import type { FriendSummary } from "@/types";
import { FRIEND_CODE_PATTERN, formatFriendCode, normalizeFriendCode } from "@/utils/format";

/* ==========================================================================
   Friends rail

   Everything in here is decided by the account server: whether a code exists,
   whether a request may be sent, who may accept it, and who is a friend. This
   component renders that state and reports failures verbatim instead of
   guessing — a wrong code says so, a duplicate says so.
   ========================================================================== */

function toPeer(friend: FriendSummary) {
  return {
    id: friend.id,
    username: friend.username,
    displayName: friend.displayName,
    friendCode: friend.friendCode,
    avatar: friend.avatar,
  };
}

export function FriendsPanel() {
  const social = useSocialStore();
  const account = useAuthStore((state) => state.account);
  const mode = useAuthStore((state) => state.mode);
  const createDirectChannel = useChatStore((state) => state.createDirectChannel);

  const [code, setCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  const registered = mode === "signed-in" && Boolean(account) && !account?.guest;

  const report = (result: { ok: boolean; message: string }) => {
    setMessage(result.message);
    setIsError(!result.ok);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const canonical = normalizeFriendCode(code);
    if (!canonical) {
      report({ ok: false, message: "Enter the friend code you were given." });
      return;
    }
    if (!FRIEND_CODE_PATTERN.test(canonical)) {
      report({ ok: false, message: "Friend codes look like CR-7K4M-9Q2X." });
      return;
    }
    report(await social.addFriendByCode(canonical));
    setCode("");
  };

  return (
    <section className="cr-messages__rail-section cr-messages__rail-section--grow">
      <header>
        <span>Friends</span>
        {registered && <Badge>{social.friends.length}</Badge>}
      </header>

      {!registered && (
        <div className="cr-messages__guest-note">
          <Icon name="shield" size={13} />
          <p>
            Guest sessions have no account, so there is no friend code and no friends list. Sign in
            with a username and password to add people by code.
          </p>
          <Button
            size="sm"
            icon="settings"
            onClick={() => openApp("settings", { args: { page: "accounts" } })}
          >
            Sign in
          </Button>
        </div>
      )}

      {registered && (
        <>
          <form className="cr-messages__add-friend" onSubmit={(event) => void submit(event)}>
            <TextInput
              value={code}
              placeholder="CR-7K4M-9Q2X"
              aria-label="Friend code"
              spellCheck={false}
              autoComplete="off"
              onChange={(event) => setCode(formatFriendCode(event.target.value))}
            />
            <Button size="sm" variant="primary" type="submit" icon="user-plus" disabled={social.busy}>
              Add
            </Button>
          </form>

          {message && (
            <p className="cr-messages__friend-message" data-error={isError}>
              {message}
            </p>
          )}
          {social.status === "offline" && (
            <p className="cr-messages__friend-message" data-error>
              {social.error ?? "The account server is unreachable."}
            </p>
          )}

          {social.incoming.length > 0 && (
            <div className="cr-messages__requests">
              <span className="cr-messages__rail-hint">Requests for you</span>
              {social.incoming.map((request) => (
                <div key={request.id} className="cr-messages__request">
                  <div className="cr-messages__request-head">
                    <span className="cr-truncate">{request.from.displayName}</span>
                    <span className="cr-code cr-code--sm">{request.from.friendCode}</span>
                  </div>
                  <div className="cr-messages__request-actions">
                    <Button
                      size="sm"
                      variant="primary"
                      icon="check"
                      onClick={() => void social.accept(request.id).then(report)}
                    >
                      Accept
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon="close"
                      onClick={() => void social.decline(request.id).then(report)}
                    >
                      Decline
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {social.outgoing.length > 0 && (
            <div className="cr-messages__outgoing">
              <span className="cr-messages__rail-hint">Sent requests</span>
              {social.outgoing.map((entry) => (
                <div key={entry.id} className="cr-messages__outgoing-row" data-status={entry.status}>
                  <Icon
                    name={entry.status === "pending" ? "clock" : entry.status === "declined" ? "close" : "check"}
                    size={12}
                  />
                  <span className="cr-truncate">{entry.to.displayName}</span>
                  <span className="cr-row__desc">
                    {entry.status === "pending" ? "waiting" : entry.status}
                  </span>
                  {entry.status === "pending" && (
                    <IconButton
                      icon="close"
                      size={11}
                      label={`Cancel request to ${entry.to.displayName}`}
                      onClick={() => void social.cancel(entry.id).then(report)}
                    />
                  )}
                </div>
              ))}
            </div>
          )}

          {social.friends.length === 0 ? (
            <p className="cr-messages__rail-hint">
              No friends yet. Enter the code someone shared with you to send them a request — they
              accept it once and it is mutual.
            </p>
          ) : (
            social.friends.map((friend) => (
              <div key={friend.id} className="cr-messages__friend-row">
                <button
                  type="button"
                  className="cr-messages__friend"
                  onClick={() => createDirectChannel(toPeer(friend))}
                >
                  <span className="cr-messages__presence" data-online={friend.online} />
                  <span>{friend.displayName}</span>
                  <span className="cr-code cr-code--sm">{friend.friendCode}</span>
                </button>
                <IconButton
                  icon="trash"
                  size={11}
                  label={`Remove ${friend.displayName} from your friends`}
                  onClick={() => void social.removeFriend(friend.id).then(report)}
                />
              </div>
            ))
          )}

          <p className="cr-messages__rail-hint">
            Friend codes are assigned by CrystalOS when an account is created. They cannot be chosen,
            edited or regenerated — share yours and the other person adds you.
          </p>
        </>
      )}
    </section>
  );
}
