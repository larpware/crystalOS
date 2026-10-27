import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Badge,
  Button,
  EmptyState,
  IconButton,
  Menu,
  Modal,
  Spinner,
  Textarea,
  UserTag,
  type MenuItem,
} from "@/components/ui";
import { Icon } from "@/icons/Icon";
import { notify } from "@/services/os";
import { useAuthStore } from "@/state/auth";
import {
  addComment,
  createPost,
  deleteComment,
  deletePost,
  editPost,
  fetchBookmarks,
  fetchComments,
  fetchFeed,
  fetchFollowRequests,
  fetchNotifications,
  fetchProfile,
  fetchUserPosts,
  markNotificationsRead,
  reportPost,
  respondFollowRequest,
  setBlocked,
  setBookmarked,
  setFollowing,
  setLiked,
  type SocialComment,
  type SocialNotification,
  type SocialPost,
  type SocialProfile,
} from "@/services/feed";
import { formatRelative } from "@/utils/format";
import type { AppProps } from "@/types";

/* ==========================================================================
   Crystal Social

   One feed, several shapes: text posts, image posts, short and long alike —
   whatever a person wrote. Every count on screen came from the server, which
   counted rows it actually holds; nothing here estimates, and nothing here
   fabricates engagement.

   The server decides who may see what. A private account's posts simply do
   not arrive for anyone but accepted followers, and a blocked account's posts
   arrive for nobody on either side of the block. This app renders that
   verdict; it does not second-guess it.
   ========================================================================== */

type View = "home" | "notifications" | "bookmarks" | "profile";

const IMAGE_MAX_BYTES = 2 * 1024 * 1024;

function Avatar({ user, size = 32 }: { user: { avatar: string | null; displayName: string }; size?: number }) {
  return user.avatar ? (
    <img className="cr-social__avatar" src={user.avatar} alt="" style={{ width: size, height: size }} />
  ) : (
    <span className="cr-social__avatar cr-social__avatar--letter" style={{ width: size, height: size }}>
      {(user.displayName ?? "?").slice(0, 1).toUpperCase()}
    </span>
  );
}

/** Reads a picked file as a data URL, refusing anything over the server cap. */
function readImage(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    if (!/^image\//.test(file.type)) {
      notify({ title: "Crystal Social", body: "That file is not an image." });
      resolve(null);
      return;
    }
    if (file.size > IMAGE_MAX_BYTES) {
      notify({ title: "Crystal Social", body: "Post images are limited to 2 MB. Try a smaller picture." });
      resolve(null);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

export function Social({ args }: AppProps) {
  const account = useAuthStore((state) => state.account);
  const signedIn = Boolean(account) && !account?.guest;

  const [view, setView] = useState<View>("home");
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [notifications, setNotifications] = useState<SocialNotification[]>([]);
  const [profile, setProfile] = useState<SocialProfile | null>(null);
  const [commentsFor, setCommentsFor] = useState<Record<string, SocialComment[]>>({});
  const [openComments, setOpenComments] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState("");
  const [menu, setMenu] = useState<{ x: number; y: number; post: SocialPost } | null>(null);
  const [editing, setEditing] = useState<{ post: SocialPost; body: string } | null>(null);
  const [followRequests, setFollowRequests] = useState<
    { id: string; username: string; displayName: string; avatar: string | null }[]
  >([]);
  const fileRef = useRef<HTMLInputElement | null>(null);
  /* Which profile the view should show: set when a name is clicked, so
     navigating to a profile no longer falls back to your own username. */
  const [profileTarget, setProfileTarget] = useState<string | null>(
    typeof args?.username === "string" ? args.username : null,
  );

  const profileUsername =
    view === "profile" ? (profileTarget ?? (account?.username ?? "")) : "";

  const loadFeed = useCallback(async (before: number | null = null) => {
    setLoading(true);
    setError(null);
    const result = await fetchFeed(before);
    if (result.ok) {
      setPosts((current) => (before ? [...current, ...result.data.feed.posts] : result.data.feed.posts));
      setNextBefore(result.data.feed.nextBefore);
    } else {
      setError(result.error.message);
    }
    setLoading(false);
  }, []);

  const loadNotifications = useCallback(async () => {
    const result = await fetchNotifications();
    if (result.ok) {
      setNotifications(result.data.notifications);
      if (result.data.notifications.some((n) => !n.readAt)) void markNotificationsRead();
    } else {
      setError(result.error.message);
    }
  }, []);

  const loadBookmarks = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await fetchBookmarks();
    if (result.ok) {
      setPosts(result.data.posts);
      setNextBefore(result.data.nextBefore);
    } else {
      setError(result.error.message);
    }
    setLoading(false);
  }, []);

  const loadProfile = useCallback(async (username: string) => {
    if (!username) return;
    setLoading(true);
    setError(null);
    const result = await fetchProfile(username);
    if (result.ok) {
      setProfile(result.data.profile);
      const postsResult = await fetchUserPosts(username);
      if (postsResult.ok) {
        setPosts(postsResult.data.posts);
        setNextBefore(postsResult.data.nextBefore);
      } else {
        setError(postsResult.error.message);
      }
    } else {
      setProfile(null);
      setError(result.error.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!signedIn) return;
    if (view === "home") void loadFeed();
    else if (view === "notifications") void loadNotifications();
    else if (view === "bookmarks") void loadBookmarks();
    else if (view === "profile") void loadProfile(profileUsername);
  }, [view, profileUsername, signedIn, loadFeed, loadNotifications, loadBookmarks, loadProfile]);

  /* Follow requests on a private account are part of its profile. */
  useEffect(() => {
    if (!signedIn || !profile?.relationship.self || !profile.private) return;
    void fetchFollowRequests().then((result) => {
      if (result.ok) setFollowRequests(result.data.requests);
    });
  }, [signedIn, profile?.relationship.self, profile?.private]);

  /* A launch argument can name a profile to open (from Chat or the terminal). */
  useEffect(() => {
    const username = typeof args?.username === "string" ? args.username : null;
    if (username && account && username !== account.username) {
      setProfileTarget(username);
      setView("profile");
    }
  }, [args?.username, account]);

  const submitPost = useCallback(async () => {
    const body = draft.trim();
    if (!body || posting) return;
    setPosting(true);
    const result = await createPost(body, image);
    setPosting(false);
    if (result.ok) {
      setDraft("");
      setImage(null);
      setPosts((current) => [result.data.post, ...current]);
      if (view !== "home") setView("home");
    } else {
      notify({ title: "Crystal Social", body: result.error.message });
    }
  }, [draft, image, posting, view]);

  const toggleLike = useCallback(async (post: SocialPost) => {
    const next = !post.liked;
    setPosts((current) =>
      current.map((p) => (p.id === post.id ? { ...p, liked: next, likes: p.likes + (next ? 1 : -1) } : p)),
    );
    const result = await setLiked(post.id, next);
    if (!result.ok) {
      setPosts((current) =>
        current.map((p) => (p.id === post.id ? { ...p, liked: post.liked, likes: post.likes } : p)),
      );
      notify({ title: "Crystal Social", body: result.error.message });
    }
  }, []);

  const toggleBookmark = useCallback(async (post: SocialPost) => {
    const next = !post.bookmarked;
    setPosts((current) => current.map((p) => (p.id === post.id ? { ...p, bookmarked: next } : p)));
    const result = await setBookmarked(post.id, next);
    if (!result.ok) notify({ title: "Crystal Social", body: result.error.message });
  }, []);

  const toggleComments = useCallback(
    async (post: SocialPost) => {
      if (openComments === post.id) {
        setOpenComments(null);
        return;
      }
      const result = await fetchComments(post.id);
      if (result.ok) {
        setCommentsFor((current) => ({ ...current, [post.id]: result.data.comments }));
        setOpenComments(post.id);
      } else {
        notify({ title: "Crystal Social", body: result.error.message });
      }
    },
    [openComments],
  );

  const submitComment = useCallback(
    async (post: SocialPost) => {
      const body = commentDraft.trim();
      if (!body) return;
      const result = await addComment(post.id, body);
      if (result.ok) {
        setCommentDraft("");
        setCommentsFor((current) => ({
          ...current,
          [post.id]: [...(current[post.id] ?? []), result.data.comment],
        }));
        setPosts((current) =>
          current.map((p) => (p.id === post.id ? { ...p, comments: p.comments + 1 } : p)),
        );
      } else {
        notify({ title: "Crystal Social", body: result.error.message });
      }
    },
    [commentDraft],
  );

  const menuItems: MenuItem[] = menu
    ? [
        {
          id: "open",
          label: "Open profile",
          icon: "user",
          run: () => {
            setProfileTarget(menu.post.author.username);
            setView("profile");
          },
        },
        ...(menu.post.author.id === account?.id
          ? ([
              {
                id: "edit",
                label: "Edit post",
                icon: "pencil",
                run: () => setEditing({ post: menu.post, body: menu.post.body }),
              },
              {
                id: "delete",
                label: "Delete post",
                icon: "trash",
                danger: true,
                run: () => {
                  void deletePost(menu.post.id).then((result) => {
                    if (result.ok) setPosts((current) => current.filter((p) => p.id !== menu.post.id));
                    else notify({ title: "Crystal Social", body: result.error.message });
                  });
                },
              },
            ] as MenuItem[])
          : ([
              {
                id: "report",
                label: "Report post",
                icon: "warning",
                danger: true,
                run: () => {
                  const reason = window.prompt("Why are you reporting this post?");
                  if (!reason) return;
                  void reportPost(menu.post.id, reason).then((result) => {
                    notify({
                      title: "Crystal Social",
                      body: result.ok
                        ? "Reported. A moderator will look at it."
                        : result.error.message,
                    });
                  });
                },
              },
              {
                id: "block",
                label: `Block @${menu.post.author.username}`,
                icon: "eye-off",
                danger: true,
                run: () => {
                  void setBlocked(menu.post.author.username, true).then((result) => {
                    if (result.ok) {
                      setPosts((current) => current.filter((p) => p.author.id !== menu.post.author.id));
                      notify({
                        title: "Crystal Social",
                        body: `@${menu.post.author.username} is blocked. Their posts are hidden both ways.`,
                      });
                    } else {
                      notify({ title: "Crystal Social", body: result.error.message });
                    }
                  });
                },
              },
            ] as MenuItem[])),
      ]
    : [];

  const tabs = useMemo(
    () =>
      [
        { id: "home" as const, label: "Home", icon: "grid" as const },
        { id: "notifications" as const, label: "Notifications", icon: "bell" as const },
        { id: "bookmarks" as const, label: "Bookmarks", icon: "pin" as const },
        { id: "profile" as const, label: "Profile", icon: "user" as const },
      ],
    [],
  );

  if (!signedIn) {
    return (
      <div className="cr-social">
        <EmptyState
          icon="users"
          title="Crystal Social needs an account"
          hint="Posts, follows and notifications belong to an account. Sign in from the desktop's account area (Settings → Account), then come back."
        />
      </div>
    );
  }

  return (
    <div className="cr-social">
      <nav className="cr-social__nav" aria-label="Crystal Social">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className="cr-social__nav-item"
            data-active={view === tab.id}
            onClick={() => {
              /* The Profile tab is your own profile unless a name was clicked. */
              if (tab.id === "profile") setProfileTarget(null);
              setView(tab.id);
              setError(null);
            }}
          >
            <Icon name={tab.icon} size={15} />
            <span>{tab.label}</span>
            {tab.id === "notifications" && notifications.some((n) => !n.readAt) && (
              <span className="cr-social__dot" aria-label="unread notifications" />
            )}
          </button>
        ))}
      </nav>

      <main className="cr-social__main">
        {view === "home" && (
          <div className="cr-social__composer">
            <Textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              rows={3}
              placeholder="What's happening?"
              aria-label="Write a post"
            />
            {image && (
              <div className="cr-social__composer-image">
                <img src={image} alt="Attachment preview" />
                <IconButton label="Remove attachment" icon="close" onClick={() => setImage(null)} />
              </div>
            )}
            <div className="cr-social__composer-row">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                hidden
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  if (file) setImage(await readImage(file));
                  event.target.value = "";
                }}
              />
              <Button variant="ghost" icon="image" onClick={() => fileRef.current?.click()}>
                {image ? "Change image" : "Add image"}
              </Button>
              <span className="cr-social__composer-count">{4000 - draft.length}</span>
              <Button variant="primary" icon="send" disabled={!draft.trim() || posting} onClick={() => void submitPost()}>
                {posting ? "Posting…" : "Post"}
              </Button>
            </div>
          </div>
        )}

        {error && (
          <div className="cr-social__error">
            <Icon name="warning" size={14} />
            <span>{error}</span>
            <Button
              size="sm"
              icon="refresh"
              onClick={() => {
                if (view === "home") void loadFeed();
                else if (view === "bookmarks") void loadBookmarks();
                else if (view === "notifications") void loadNotifications();
                else void loadProfile(profileUsername);
              }}
            >
              Retry
            </Button>
          </div>
        )}

        {view === "profile" && profile && (
          <header className="cr-social__profile-head">
            <Avatar user={profile} size={56} />
            <div className="cr-social__profile-id">
              <h2>
                {profile.displayName}
                <UserTag tags={profile.tags} />
                {profile.private && <Badge icon="lock">Private</Badge>}
              </h2>
              <span className="cr-social__handle">@{profile.username}</span>
              {profile.bio && <p className="cr-social__bio">{profile.bio}</p>}
              <div className="cr-social__profile-counts">
                <span>
                  <strong>{profile.counts.followers}</strong> followers
                </span>
                <span>
                  <strong>{profile.counts.following}</strong> following
                </span>
                <span>joined {new Date(profile.createdAt).toLocaleDateString()}</span>
              </div>
            </div>
            <div className="cr-social__profile-actions">
              {!profile.relationship.self && (
                <Button
                  variant={profile.relationship.following ? "secondary" : "primary"}
                  icon={profile.relationship.following ? "check" : "plus"}
                  onClick={() => {
                    const following = Boolean(profile.relationship.following);
                    void setFollowing(profile.username, !following).then((result) => {
                      if (result.ok) {
                        setProfile({
                          ...profile,
                          relationship: {
                            ...profile.relationship,
                            following: result.data.pending ? "pending" : following ? null : "accepted",
                          },
                          counts: {
                            ...profile.counts,
                            followers: profile.counts.followers + (following ? -1 : result.data.pending ? 0 : 1),
                          },
                        });
                      } else {
                        notify({ title: "Crystal Social", body: result.error.message });
                      }
                    });
                  }}
                >
                  {profile.relationship.following === "accepted"
                    ? "Following"
                    : profile.relationship.following === "pending"
                      ? "Requested"
                      : "Follow"}
                </Button>
              )}
              {!profile.relationship.self && (
                <Button
                  variant="ghost"
                  icon="messages"
                  onClick={() => {
                    notify({
                      title: "Crystal Social",
                      body: "Opening a conversation happens in Crystal Chat, from this person's friends list.",
                    });
                  }}
                >
                  Message
                </Button>
              )}
              <Button
                variant="ghost"
                icon="refresh"
                onClick={() => void loadProfile(profile.username)}
              >
                Refresh
              </Button>
            </div>
          </header>
        )}

        {view === "profile" && profile?.relationship.self && profile.private && (
          <section className="cr-social__requests">
            <h3>Pending follow requests</h3>
            {followRequests.length === 0 && <p className="cr-social__muted">None right now.</p>}
            {followRequests.map((request) => (
              <div key={request.id} className="cr-social__request">
                <Avatar user={{ avatar: request.avatar, displayName: request.displayName }} />
                <span>{request.displayName}</span>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() =>
                    void respondFollowRequest(request.id, true).then(() => {
                      setFollowRequests((current) => current.filter((r) => r.id !== request.id));
                      void loadProfile(profile.username);
                    })
                  }
                >
                  Accept
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    void respondFollowRequest(request.id, false).then(() => {
                      setFollowRequests((current) => current.filter((r) => r.id !== request.id));
                    })
                  }
                >
                  Decline
                </Button>
              </div>
            ))}
          </section>
        )}

        {view === "notifications" && notifications.length === 0 && !error && (
          <EmptyState icon="bell" title="Nothing yet" hint="Likes, comments and follows will show up here." />
        )}
        {view === "bookmarks" && posts.length === 0 && !error && !loading && (
          <EmptyState icon="pin" title="No bookmarks" hint="Posts you save land here." />
        )}

        {view !== "notifications" &&
          posts.map((post) => (
            <article key={post.id} className="cr-social__post">
              <button
                type="button"
                className="cr-social__post-author"
                onClick={() => {
                  setProfileTarget(post.author.username);
                  setView("profile");
                }}
              >
                <Avatar user={post.author} />
                <span className="cr-social__name">
                  {post.author.displayName}
                  <UserTag tags={post.author.tags} />
                </span>
                <span className="cr-social__handle">@{post.author.username}</span>
                <span className="cr-social__time">{formatRelative(post.createdAt)}</span>
                {post.editedAt && <span className="cr-social__time">(edited)</span>}
              </button>
              <p className="cr-social__body">{post.body}</p>
              {post.image && <img className="cr-social__image" src={post.image} alt="" />}
              <div className="cr-social__actions">
                <IconButton
                  label={post.liked ? "Unlike" : "Like"}
                  icon="heart"
                  active={post.liked}
                  onClick={() => void toggleLike(post)}
                />
                <span>{post.likes}</span>
                <IconButton
                  label="Comments"
                  icon="messages"
                  active={openComments === post.id}
                  onClick={() => void toggleComments(post)}
                />
                <span>{post.comments}</span>
                <IconButton
                  label={post.bookmarked ? "Remove bookmark" : "Bookmark"}
                  icon="pin"
                  active={post.bookmarked}
                  onClick={() => void toggleBookmark(post)}
                />
                <span className="cr-social__spacer" />
                <IconButton
                  label="Post actions"
                  icon="more-horizontal"
                  onClick={(event) => {
                    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
                    setMenu({ x: rect.left, y: rect.bottom + 4, post });
                  }}
                />
              </div>
              {openComments === post.id && (
                <div className="cr-social__comments">
                  {(commentsFor[post.id] ?? []).map((comment) => (
                    <div key={comment.id} className="cr-social__comment">
                      <Avatar user={comment.author} size={24} />
                      <div>
                        <span className="cr-social__name">
                          {comment.author.displayName}
                          <UserTag tags={comment.author.tags} />
                        </span>{" "}
                        <span className="cr-social__time">{formatRelative(comment.createdAt)}</span>
                        <p>{comment.body}</p>
                      </div>
                      {comment.author.id === account?.id && (
                        <IconButton
                          label="Delete comment"
                          icon="trash"
                          size={13}
                          onClick={() =>
                            void deleteComment(comment.id).then((result) => {
                              if (result.ok) {
                                setCommentsFor((current) => ({
                                  ...current,
                                  [post.id]: (current[post.id] ?? []).filter((c) => c.id !== comment.id),
                                }));
                              }
                            })
                          }
                        />
                      )}
                    </div>
                  ))}
                  <div className="cr-social__comment-row">
                    <Textarea
                      value={commentDraft}
                      onChange={(event) => setCommentDraft(event.target.value)}
                      rows={1}
                      placeholder="Write a comment…"
                      aria-label="Write a comment"
                    />
                    <Button size="sm" variant="primary" disabled={!commentDraft.trim()} onClick={() => void submitComment(post)}>
                      Reply
                    </Button>
                  </div>
                </div>
              )}
            </article>
          ))}

        {view === "notifications" &&
          notifications.map((item) => (
            <div key={item.id} className="cr-social__notification">
              <Icon
                name={item.kind === "like" ? "heart" : item.kind === "comment" ? "messages" : "user-plus"}
                size={14}
              />
              <span>
                <strong>{item.actor?.displayName ?? "Someone"}</strong>{" "}
                {item.kind === "like"
                  ? "liked your post"
                  : item.kind === "comment"
                    ? `commented: ${item.body ?? ""}`
                    : item.kind === "follow-accepted"
                      ? "accepted your follow request"
                      : "followed you"}
              </span>
              <span className="cr-social__time">{formatRelative(item.createdAt)}</span>
            </div>
          ))}

        {loading && <Spinner label="Loading" />}
        {!loading && nextBefore !== null && view !== "notifications" && (
          <Button variant="ghost" onClick={() => {
            if (view === "home") void loadFeed(nextBefore);
            else if (view === "bookmarks") void loadBookmarks();
            else void loadProfile(profileUsername);
          }}>
            Load older posts
          </Button>
        )}
      </main>

      {menu && (
        <Menu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />
      )}

      <Modal
        open={Boolean(editing)}
        title="Edit post"
        onClose={() => setEditing(null)}
      >
        <Textarea
          value={editing?.body ?? ""}
          onChange={(event) => setEditing((current) => (current ? { ...current, body: event.target.value } : current))}
          rows={5}
          aria-label="Edit post"
        />
        <div className="cr-social__composer-row">
          <Button
            variant="primary"
            onClick={() => {
              if (!editing) return;
              void editPost(editing.post.id, editing.body.trim()).then((result) => {
                if (result.ok) {
                  setPosts((current) =>
                    current.map((p) => (p.id === editing.post.id ? { ...p, ...result.data.post } : p)),
                  );
                  setEditing(null);
                } else {
                  notify({ title: "Crystal Social", body: result.error.message });
                }
              });
            }}
          >
            Save
          </Button>
          <Button variant="ghost" onClick={() => setEditing(null)}>
            Cancel
          </Button>
        </div>
      </Modal>
    </div>
  );
}
