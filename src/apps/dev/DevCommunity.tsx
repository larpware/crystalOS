import { useCallback, useEffect, useState } from "react";
import { Badge, Button, EmptyState, Spinner } from "@/components/ui";
import { Icon } from "@/icons/Icon";
import { fetchFeed, TOPIC_LABELS, type PostTopic, type SocialPost } from "@/services/feed";
import { openApp } from "@/services/os";
import { useAuthStore } from "@/state/auth";
import { formatRelative } from "@/utils/format";

/* ==========================================================================
   Community inside Crystal Dev

   A window onto the same feed Crystal Community renders — read-only, one
   page, with the door to the full application one click away. The point is
   that a developer mid-problem can see the answer without leaving the
   workspace; anything that needs composing, replying or browsing belongs to
   the community app itself, which owns those controls.
   ========================================================================== */

export function DevCommunity() {
  const account = useAuthStore((state) => state.account);
  const signedIn = Boolean(account) && !account?.guest;

  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await fetchFeed(null, 12);
    if (result.ok) setPosts(result.data.feed.posts);
    else setError(result.error.message);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (signedIn) void load();
  }, [signedIn, load]);

  /* `compose` names a topic from the feed's own vocabulary, so the composer
     arrives with Questions already selected. */
  const openCommunity = (compose?: "questions") =>
    openApp("social", { args: compose ? { compose } : undefined });

  if (!signedIn) {
    return (
      <div className="cr-dev__pane">
        <EmptyState
          icon="users"
          title="Community needs an account"
          hint="Posts, replies and questions belong to your CrystalOS account. Sign in from Settings → Account, then come back."
          action={
            <Button variant="primary" icon="settings" onClick={() => openApp("settings", { args: { page: "accounts" } })}>
              Open account settings
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="cr-dev__pane cr-dev-community">
      <header className="cr-dev__pane-head">
        <div>
          <h2>Community</h2>
          <p className="cr-row__desc">
            The latest from Crystal Community — open it for replies, profiles and the full feed.
          </p>
        </div>
        <div className="cr-dev__pane-actions">
          <Button icon="refresh" onClick={() => void load()} disabled={loading}>
            Refresh
          </Button>
          <Button variant="primary" icon="messages" onClick={() => openCommunity("questions")}>
            Ask a question
          </Button>
          <Button variant="secondary" icon="users" onClick={() => openCommunity()}>
            Open Crystal Community
          </Button>
        </div>
      </header>

      {error && (
        <div className="cr-social__error">
          <Icon name="warning" size={14} />
          <span>{error}</span>
          <Button size="sm" icon="refresh" onClick={() => void load()}>
            Retry
          </Button>
        </div>
      )}

      {loading && posts.length === 0 && <Spinner label="Loading the feed" />}

      {!loading && !error && posts.length === 0 && (
        <EmptyState
          icon="users"
          title="Nothing in the feed yet"
          hint="Be the first: share what you are building, or ask the question you are stuck on."
          action={
            <Button variant="primary" icon="send" onClick={() => openCommunity("questions")}>
              Ask a question
            </Button>
          }
        />
      )}

      <ul className="cr-dev-community__list">
        {posts.map((post) => (
          <li key={post.id} className="cr-dev-community__post">
            <div className="cr-dev-community__meta">
              <strong>{post.author.displayName}</strong>
              <span className="cr-row__desc">@{post.author.username}</span>
              <span className="cr-row__desc">{formatRelative(post.createdAt)}</span>
              {post.topic !== "general" && (
                <Badge tone="accent">{TOPIC_LABELS[post.topic as PostTopic] ?? post.topic}</Badge>
              )}
            </div>
            <p className="cr-dev-community__body">{post.body}</p>
            <div className="cr-dev-community__stats">
              <span title="Likes">
                <Icon name="heart" size={12} /> {post.likes}
              </span>
              <span title="Comments">
                <Icon name="messages" size={12} /> {post.comments}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
