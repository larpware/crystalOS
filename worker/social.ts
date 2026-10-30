/* ==========================================================================
   Crystal Social + Store on the Worker — /api/accounts/{users,feed,posts,
   comments,bookmarks,follow-requests,store}

   The same contract `src/services/feed.ts` and `src/services/appStore.ts`
   already speak: same paths, same JSON, same error codes, now answered from
   Supabase Postgres through PostgREST.

   Authorization is two-layered on purpose:
     * the Worker validates shape and size, and resolves "who is asking" from
       a verified session — never from anything in the body;
     * Postgres RLS (migrations/0002) makes every statement scoped to
       auth.uid(), so a body that lied about an id simply matches no rows.
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
import { bodyAsJson, cleanText, fail, intParam, isoFromMs, json, ms, orFilter } from "./http";

const POST_TOPICS = ["general", "gaming", "development", "customization", "questions"];
const POST_BODY_MAX = 5000;
const COMMENT_MAX = 1000;
const IMAGE_MAX_BYTES = 2 * 1024 * 1024;
const IMAGE_DATA_PATTERN = /^data:image\/(?:png|jpe?g|webp|gif|avif|svg\+xml);base64,[A-Za-z0-9+/=]+$/;

/* ---- row shapes ---------------------------------------------------------- */

interface PostRow {
  id: string;
  author_id: string;
  body: string;
  image: string | null;
  topic: string;
  created_at: string;
  edited_at: string | null;
}

interface CommentRow {
  id: string;
  post_id: string;
  author_id: string;
  body: string;
  created_at: string;
}

interface FollowRow {
  follower_id: string;
  followee_id: string;
  status: string;
  created_at: string;
}

/* ---- shaping ------------------------------------------------------------- */

function brief(row: ProfileRow) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatar: row.avatar_url ?? null,
    rarity: row.rarity ?? null,
    tags: row.tags ?? [],
  };
}

function postAuthor(row: ProfileRow | undefined) {
  return {
    id: row?.id ?? "",
    username: row?.username ?? null,
    displayName: row?.display_name ?? null,
    avatar: row?.avatar_url ?? null,
    rarity: row?.rarity ?? null,
    tags: row?.tags ?? [],
    private: Boolean(row?.private_account),
  };
}

async function profilesByIds(
  session: Session,
  ids: string[],
): Promise<Map<string, ProfileRow>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map();
  const { data } = await postgrest(session.config, "profiles", {
    params: { select: "*", id: `in.(${unique.join(",")})` },
    token: session.token,
  });
  const rows = Array.isArray(data) ? (data as ProfileRow[]) : [];
  return new Map(rows.map((row) => [row.id, row]));
}

async function profileByUsername(
  session: Session,
  username: string,
): Promise<ProfileRow | null> {
  const { data } = await postgrest(session.config, "profiles", {
    params: { select: "*", username: `eq.${username}` },
    token: session.token,
  });
  return Array.isArray(data) && data.length ? (data[0] as ProfileRow) : null;
}

/** ids of everyone blocked in either direction between me and them. */
async function blockedBetween(session: Session, me: string, other: string): Promise<boolean> {
  const { data } = await postgrest(session.config, "blocks", {
    params: {
      select: "blocker_id",
      or: orFilter([
        `and(blocker_id.eq.${other},blocked_id.eq.${me})`,
        `and(blocker_id.eq.${me},blocked_id.eq.${other})`,
      ]),
    },
    token: session.token,
  });
  return Array.isArray(data) && data.length > 0;
}

/** Everyone I have blocked, or who blocked me — excluded from my feed. */
async function blockedIds(session: Session, me: string): Promise<string[]> {
  const { data } = await postgrest(session.config, "blocks", {
    params: {
      select: "blocker_id,blocked_id",
      or: orFilter([`blocker_id.eq.${me}`, `blocked_id.eq.${me}`]),
    },
    token: session.token,
  });
  if (!Array.isArray(data)) return [];
  return (data as { blocker_id: string; blocked_id: string }[]).map((row) =>
    row.blocker_id === me ? row.blocked_id : row.blocker_id,
  );
}

/* ---- feed ---------------------------------------------------------------- */

async function hydratePosts(
  session: Session,
  rows: PostRow[],
): Promise<{ posts: Array<Record<string, unknown>>; nextBefore: number | null }> {
  if (!rows.length) return { posts: [], nextBefore: null };
  const ids = rows.map((row) => row.id);
  const idList = `(${ids.join(",")})`;

  const [likes, mineLikes, bookmarks, comments] = await Promise.all([
    postgrest(session.config, "post_likes", {
      params: { select: "post_id", post_id: `in.${idList}` },
      token: session.token,
    }),
    postgrest(session.config, "post_likes", {
      params: { select: "post_id", post_id: `in.${idList}`, user_id: `eq.${session.userId}` },
      token: session.token,
    }),
    postgrest(session.config, "bookmarks", {
      params: { select: "post_id", post_id: `in.${idList}`, user_id: `eq.${session.userId}` },
      token: session.token,
    }),
    postgrest(session.config, "post_comments", {
      params: { select: "id,post_id", post_id: `in.${idList}` },
      token: session.token,
    }),
  ]);

  const rowsOf = (result: { data: unknown }): Record<string, string>[] =>
    Array.isArray(result.data) ? (result.data as Record<string, string>[]) : [];

  const likeCount = new Map<string, number>();
  for (const row of rowsOf(likes)) likeCount.set(row.post_id, (likeCount.get(row.post_id) ?? 0) + 1);
  const commentCount = new Map<string, number>();
  for (const row of rowsOf(comments))
    commentCount.set(row.post_id, (commentCount.get(row.post_id) ?? 0) + 1);
  const likedSet = new Set(rowsOf(mineLikes).map((row) => row.post_id));
  const bookmarkedSet = new Set(rowsOf(bookmarks).map((row) => row.post_id));

  const authors = await profilesByIds(session, rows.map((row) => row.author_id));

  return {
    posts: rows.map((row) => ({
      id: row.id,
      body: row.body,
      image: row.image ?? null,
      topic: row.topic,
      createdAt: ms(row.created_at),
      editedAt: row.edited_at ? ms(row.edited_at) : null,
      author: postAuthor(authors.get(row.author_id)),
      likes: likeCount.get(row.id) ?? 0,
      comments: commentCount.get(row.id) ?? 0,
      liked: likedSet.has(row.id),
      bookmarked: bookmarkedSet.has(row.id),
    })),
    nextBefore: rows.length ? ms(rows[rows.length - 1].created_at) : null,
  };
}

async function feedRoute(request: Request, url: URL, session: Session): Promise<Response> {
  const method = request.method.toUpperCase();
  if (method !== "GET") return fail(405, "METHOD_NOT_ALLOWED", `${method} is not supported on /feed.`);

  const limit = intParam(url, "limit", 20, 1, 50);
  const before = isoFromMs(url.searchParams.get("before"));
  const scope = url.searchParams.get("scope");
  if (scope && scope !== "following" && scope !== "discover") {
    return fail(400, "INVALID_SCOPE", "Scope must be following or discover.");
  }
  const topic = url.searchParams.get("topic");
  if (topic && !POST_TOPICS.includes(topic)) {
    return fail(400, "INVALID_TOPIC", "That topic does not exist.");
  }

  const params: Record<string, string> = {
    select: "*",
    order: "created_at.desc",
    limit: String(limit + 1),
  };
  if (before) params.created_at = `lt.${before}`;
  if (topic) params.topic = `eq.${topic}`;

  // Visibility has two independent filters: who I asked for (scope) and who
  // I never want to see (blocks). PostgREST takes one value per column, so
  // when both apply they are combined into a single `and=(…)` predicate.
  const authorConditions: string[] = [];
  if (scope === "following") {
    const { data } = await postgrest(session.config, "follows", {
      params: { select: "followee_id", follower_id: `eq.${session.userId}`, status: "eq.accepted" },
      token: session.token,
    });
    const followees = Array.isArray(data)
      ? [...new Set((data as { followee_id: string }[]).map((row) => row.followee_id))]
      : [];
    if (!followees.length) return json({ feed: { posts: [], nextBefore: null } });
    authorConditions.push(`author_id.in.(${followees.join(",")})`);
  }

  const blocked = await blockedIds(session, session.userId);
  if (blocked.length) authorConditions.push(`author_id.not.in.(${blocked.join(",")})`);

  if (authorConditions.length === 1) {
    const dot = authorConditions[0].indexOf(".");
    params[authorConditions[0].slice(0, dot)] = authorConditions[0].slice(dot + 1);
  } else if (authorConditions.length > 1) {
    params.and = `(${authorConditions.join(",")})`;
  }

  const { data } = await postgrest(session.config, "posts", { params, token: session.token });
  const all = Array.isArray(data) ? (data as PostRow[]) : [];
  const page = all.slice(0, limit);
  const hydrated = await hydratePosts(session, page);
  return json({ feed: { posts: hydrated.posts, nextBefore: all.length > limit ? hydrated.nextBefore : null } });
}

/* ---- posts --------------------------------------------------------------- */

function validatePostBody(raw: unknown): { value?: string; error?: string } {
  const value = cleanText(raw).trim();
  if (!value) return { error: "A post needs some text." };
  if (value.length > POST_BODY_MAX) return { error: `Posts are limited to ${POST_BODY_MAX} characters.` };
  return { value };
}

function validateImage(raw: unknown): { value?: string | null; error?: string } {
  if (raw === null || raw === undefined || raw === "") return { value: null };
  const value = String(raw);
  if (value.length > IMAGE_MAX_BYTES) return { error: "That image is too large." };
  if (IMAGE_DATA_PATTERN.test(value)) return { value };
  if (/^https?:\/\/[^\s]+$/i.test(value) && value.length <= 2000) return { value };
  return { error: "That image is not a supported image URL." };
}

async function createPost(session: Session, request: Request): Promise<Response> {
  const body = await bodyAsJson(request);
  const text = validatePostBody(body.body);
  if (text.error) return fail(400, "INVALID_POST_BODY", text.error);
  const image = validateImage(body.image);
  if (image.error) return fail(400, "INVALID_IMAGE", image.error);
  const topic = POST_TOPICS.includes(String(body.topic)) ? String(body.topic) : "general";

  const { data } = await postgrest(session.config, "posts", {
    method: "POST",
    token: session.token,
    body: { author_id: session.userId, body: text.value, image: image.value ?? null, topic },
  });
  const row = (Array.isArray(data) ? data[0] : data) as PostRow;
  const authors = await profilesByIds(session, [row.author_id]);
  const hydrated = await hydratePosts(session, [row]);
  return json({ post: { ...hydrated.posts[0], author: postAuthor(authors.get(row.author_id)) } }, { status: 201 });
}

async function patchPost(session: Session, postId: string, request: Request): Promise<Response> {
  const body = await bodyAsJson(request);
  const text = validatePostBody(body.body);
  if (text.error) return fail(400, "INVALID_POST_BODY", text.error);
  const patch: Record<string, unknown> = { body: text.value, edited_at: new Date().toISOString() };
  if (body.topic !== undefined) {
    if (!POST_TOPICS.includes(String(body.topic)))
      return fail(400, "INVALID_TOPIC", "That topic does not exist.");
    patch.topic = String(body.topic);
  }

  const { data } = await postgrest(session.config, "posts", {
    method: "PATCH",
    token: session.token,
    params: { id: `eq.${postId}` },
    body: patch,
  });
  const rows = Array.isArray(data) ? (data as PostRow[]) : [];
  // RLS means "no row" is exactly "not your post" — say it plainly.
  if (!rows.length) return fail(404, "POST_NOT_FOUND", "That post does not exist or is not yours.");
  const hydrated = await hydratePosts(session, rows);
  return json({ post: hydrated.posts[0] });
}

async function deletePost(session: Session, postId: string): Promise<Response> {
  const { data } = await postgrest(session.config, "posts", {
    method: "DELETE",
    token: session.token,
    params: { id: `eq.${postId}` },
  });
  const removed = Array.isArray(data) ? data.length : 0;
  if (!removed) return fail(404, "POST_NOT_FOUND", "That post does not exist or is not yours.");
  return json({ ok: true });
}

async function setLiked(session: Session, postId: string, liked: boolean): Promise<Response> {
  if (liked) {
    try {
      await postgrest(session.config, "post_likes", {
        method: "POST",
        token: session.token,
        body: { post_id: postId, user_id: session.userId },
        representation: false,
      });
    } catch (error) {
      // Already liked is the answer the client asked for, not an error.
      if (!(error instanceof SupabaseError && error.status === 409)) throw error;
    }
    await notifyPostOwner(session, postId, "like", "liked your post");
  } else {
    await postgrest(session.config, "post_likes", {
      method: "DELETE",
      token: session.token,
      params: { post_id: `eq.${postId}`, user_id: `eq.${session.userId}` },
      representation: false,
    });
  }
  return json({ liked });
}

async function setBookmarked(session: Session, postId: string, bookmarked: boolean): Promise<Response> {
  if (bookmarked) {
    try {
      await postgrest(session.config, "bookmarks", {
        method: "POST",
        token: session.token,
        body: { post_id: postId, user_id: session.userId },
        representation: false,
      });
    } catch (error) {
      if (!(error instanceof SupabaseError && error.status === 409)) throw error;
    }
  } else {
    await postgrest(session.config, "bookmarks", {
      method: "DELETE",
      token: session.token,
      params: { post_id: `eq.${postId}`, user_id: `eq.${session.userId}` },
      representation: false,
    });
  }
  return json({ bookmarked });
}

/** Best-effort inbox line for the post's owner; never fails the user's action. */
async function notifyPostOwner(
  session: Session,
  postId: string,
  kind: string,
  body: string,
): Promise<void> {
  try {
    const { data } = await postgrest(session.config, "posts", {
      params: { select: "author_id", id: `eq.${postId}` },
      token: session.token,
    });
    const author = Array.isArray(data) && data.length ? (data[0] as { author_id: string }) : null;
    if (!author) return;
    await postgrest(session.config, "rpc/notify", {
      method: "POST",
      token: session.token,
      body: { p_user_id: author.author_id, p_kind: kind, p_post_id: postId, p_body: body },
      representation: false,
    });
  } catch {
    /* a notification is never worth failing the action for */
  }
}

async function commentsRoute(
  request: Request,
  session: Session,
  postId: string,
): Promise<Response> {
  const method = request.method.toUpperCase();

  if (method === "GET") {
    const { data } = await postgrest(session.config, "post_comments", {
      params: { select: "*", post_id: `eq.${postId}`, order: "created_at.asc", limit: "200" },
      token: session.token,
    });
    const rows = Array.isArray(data) ? (data as CommentRow[]) : [];
    if (!rows.length) return json({ comments: [] });
    const commentIds = rows.map((row) => row.id);
    const [likes, mine] = await Promise.all([
      postgrest(session.config, "comment_likes", {
        params: { select: "comment_id", comment_id: `in.(${commentIds.join(",")})` },
        token: session.token,
      }),
      postgrest(session.config, "comment_likes", {
        params: { select: "comment_id", user_id: `eq.${session.userId}` },
        token: session.token,
      }),
    ]);
    const likeCount = new Map<string, number>();
    for (const row of (Array.isArray(likes.data) ? likes.data : []) as { comment_id: string }[]) {
      likeCount.set(row.comment_id, (likeCount.get(row.comment_id) ?? 0) + 1);
    }
    const mineSet = new Set(
      ((Array.isArray(mine.data) ? mine.data : []) as { comment_id: string }[]).map((row) => row.comment_id),
    );
    const authors = await profilesByIds(session, rows.map((row) => row.author_id));
    return json({
      comments: rows.map((row) => ({
        id: row.id,
        postId: row.post_id,
        body: row.body,
        createdAt: ms(row.created_at),
        likes: likeCount.get(row.id) ?? 0,
        liked: mineSet.has(row.id),
        author: brief(authors.get(row.author_id) ?? session.profile),
      })),
    });
  }

  if (method === "POST") {
    const body = await bodyAsJson(request);
    const value = cleanText(body.body).trim();
    if (!value) return fail(400, "INVALID_COMMENT", "Comments cannot be empty.");
    if (value.length > COMMENT_MAX)
      return fail(400, "INVALID_COMMENT", `Comments are limited to ${COMMENT_MAX} characters.`);
    const { data } = await postgrest(session.config, "post_comments", {
      method: "POST",
      token: session.token,
      body: { post_id: postId, author_id: session.userId, body: value },
    });
    const row = (Array.isArray(data) ? data[0] : data) as CommentRow;
    await notifyPostOwner(session, postId, "comment", "commented on your post");
    return json(
      {
        comment: {
          id: row.id,
          postId: row.post_id,
          body: row.body,
          createdAt: ms(row.created_at),
          likes: 0,
          liked: false,
          author: brief(session.profile),
        },
      },
      { status: 201 },
    );
  }

  return fail(405, "METHOD_NOT_ALLOWED", `${method} is not supported on comments.`);
}

async function bookmarksRoute(session: Session, url: URL): Promise<Response> {
  const limit = intParam(url, "limit", 20, 1, 50);
  const before = isoFromMs(url.searchParams.get("before"));
  const params: Record<string, string> = {
    select: "post_id,created_at",
    user_id: `eq.${session.userId}`,
    order: "created_at.desc",
    limit: String(limit + 1),
  };
  if (before) params.created_at = `lt.${before}`;
  const { data } = await postgrest(session.config, "bookmarks", { params, token: session.token });
  const rows = Array.isArray(data) ? (data as { post_id: string }[]) : [];
  const ids = rows.slice(0, limit).map((row) => row.post_id);
  if (!ids.length) return json({ posts: [], nextBefore: null });
  const { data: postRows } = await postgrest(session.config, "posts", {
    params: { select: "*", id: `in.(${ids.join(",")})`, order: "created_at.desc" },
    token: session.token,
  });
  const hydrated = await hydratePosts(session, (Array.isArray(postRows) ? postRows : []) as PostRow[]);
  return json({
    posts: hydrated.posts,
    nextBefore: rows.length > limit ? hydrated.nextBefore : null,
  });
}

/* ---- profiles, follows, blocks ------------------------------------------- */

async function profileRoute(session: Session, username: string): Promise<Response> {
  const target = await profileByUsername(session, username);
  if (!target) return fail(404, "ACCOUNT_NOT_FOUND", "That account does not exist.");
  if (target.id !== session.userId && (await blockedBetween(session, session.userId, target.id))) {
    return fail(403, "BLOCKED", "You cannot view that account.");
  }

  const [followers, following, pending] = await Promise.all([
    postgrest(session.config, "follows", {
      params: { select: "follower_id", followee_id: `eq.${target.id}`, status: "eq.accepted" },
      token: session.token,
      count: true,
    }),
    postgrest(session.config, "follows", {
      params: { select: "followee_id", follower_id: `eq.${target.id}`, status: "eq.accepted" },
      token: session.token,
      count: true,
    }),
    postgrest(session.config, "follows", {
      params: { select: "follower_id", followee_id: `eq.${target.id}`, status: "eq.pending" },
      token: session.token,
      count: true,
    }),
  ]);
  const countOf = (result: { total: number | null; data: unknown }) =>
    result.total ?? (Array.isArray(result.data) ? result.data.length : 0);

  const self = target.id === session.userId;
  const [mine, theirs] = await Promise.all([
    postgrest(session.config, "follows", {
      params: { select: "status", follower_id: `eq.${session.userId}`, followee_id: `eq.${target.id}` },
      token: session.token,
    }),
    postgrest(session.config, "follows", {
      params: { select: "status", follower_id: `eq.${target.id}`, followee_id: `eq.${session.userId}` },
      token: session.token,
    }),
  ]);
  const statusOf = (result: { data: unknown }): "accepted" | "pending" | null => {
    const rows = Array.isArray(result.data) ? (result.data as FollowRow[]) : [];
    if (!rows.length) return null;
    return rows[0].status === "pending" ? "pending" : "accepted";
  };

  return json({
    profile: {
      id: target.id,
      username: target.username,
      displayName: target.display_name,
      avatar: target.avatar_url ?? null,
      bio: target.bio ?? null,
      rarity: target.rarity ?? null,
      tags: target.tags ?? [],
      createdAt: ms(target.created_at),
      private: Boolean(target.private_account),
      counts: {
        followers: countOf(followers),
        following: countOf(following),
        pendingFollowers: countOf(pending),
      },
      relationship: {
        self,
        following: self ? null : statusOf(mine),
        followedBy: self ? null : statusOf(theirs),
      },
    },
  });
}

async function userPostsRoute(session: Session, url: URL, username: string): Promise<Response> {
  const target = await profileByUsername(session, username);
  if (!target) return fail(404, "ACCOUNT_NOT_FOUND", "That account does not exist.");
  if (target.id !== session.userId && (await blockedBetween(session, session.userId, target.id))) {
    return fail(403, "BLOCKED", "You cannot view that account.");
  }
  const limit = intParam(url, "limit", 20, 1, 50);
  const before = isoFromMs(url.searchParams.get("before"));
  const params: Record<string, string> = {
    select: "*",
    author_id: `eq.${target.id}`,
    order: "created_at.desc",
    limit: String(limit + 1),
  };
  if (before) params.created_at = `lt.${before}`;
  const { data } = await postgrest(session.config, "posts", { params, token: session.token });
  const all = Array.isArray(data) ? (data as PostRow[]) : [];
  const page = all.slice(0, limit);
  const hydrated = await hydratePosts(session, page);
  return json({
    posts: hydrated.posts,
    nextBefore: all.length > limit ? hydrated.nextBefore : null,
  });
}

async function followRoute(session: Session, username: string, following: boolean): Promise<Response> {
  const target = await profileByUsername(session, username);
  if (!target) return fail(404, "ACCOUNT_NOT_FOUND", "That account does not exist.");
  if (target.id === session.userId) return fail(400, "SELF_FOLLOW", "You cannot follow yourself.");
  if (await blockedBetween(session, session.userId, target.id))
    return fail(403, "BLOCKED", "You cannot follow that account.");

  if (following) {
    const status = target.private_account ? "pending" : "accepted";
    try {
      await postgrest(session.config, "follows", {
        method: "POST",
        token: session.token,
        body: { follower_id: session.userId, followee_id: target.id, status },
        representation: false,
      });
    } catch (error) {
      // Already following is the state the client asked for, not a failure.
      if (!(error instanceof SupabaseError && error.status === 409)) throw error;
    }
    if (status === "accepted") {
      await postgrest(session.config, "rpc/notify", {
        method: "POST",
        token: session.token,
        body: { p_user_id: target.id, p_kind: "follow", p_body: "started following you" },
        representation: false,
      }).catch(() => undefined);
    }
    return json({ following: true, ...(status === "pending" ? { pending: true } : {}) });
  }

  await postgrest(session.config, "follows", {
    method: "DELETE",
    token: session.token,
    params: { follower_id: `eq.${session.userId}`, followee_id: `eq.${target.id}` },
    representation: false,
  });
  return json({ following: false });
}

async function blockRoute(session: Session, username: string, blocked: boolean): Promise<Response> {
  const target = await profileByUsername(session, username);
  if (!target) return fail(404, "ACCOUNT_NOT_FOUND", "That account does not exist.");
  if (target.id === session.userId) return fail(400, "SELF_BLOCK", "You cannot block yourself.");

  if (blocked) {
    try {
      await postgrest(session.config, "blocks", {
        method: "POST",
        token: session.token,
        body: { blocker_id: session.userId, blocked_id: target.id },
        representation: false,
      });
    } catch (error) {
      if (!(error instanceof SupabaseError && error.status === 409)) throw error;
    }
    // Blocking also drops the follow relationship in both directions.
    await postgrest(session.config, "follows", {
      method: "DELETE",
      token: session.token,
      params: { follower_id: `eq.${session.userId}`, followee_id: `eq.${target.id}` },
      representation: false,
    }).catch(() => undefined);
    await postgrest(session.config, "follows", {
      method: "DELETE",
      token: session.token,
      params: { follower_id: `eq.${target.id}`, followee_id: `eq.${session.userId}` },
      representation: false,
    }).catch(() => undefined);
    return json({ blocked: true });
  }

  await postgrest(session.config, "blocks", {
    method: "DELETE",
    token: session.token,
    params: { blocker_id: `eq.${session.userId}`, blocked_id: `eq.${target.id}` },
    representation: false,
  });
  return json({ blocked: false });
}

async function followRequestsRoute(
  request: Request,
  session: Session,
  second: string | undefined,
  third: string | undefined,
): Promise<Response> {
  const method = request.method.toUpperCase();

  if (method === "GET" && second === undefined) {
    const { data } = await postgrest(session.config, "follows", {
      params: {
        select: "follower_id,created_at",
        followee_id: `eq.${session.userId}`,
        status: "eq.pending",
        order: "created_at.desc",
        limit: "100",
      },
      token: session.token,
    });
    const rows = Array.isArray(data) ? (data as { follower_id: string; created_at: string }[]) : [];
    const profiles = await profilesByIds(session, rows.map((row) => row.follower_id));
    return json({
      requests: rows
        .filter((row) => profiles.has(row.follower_id))
        .map((row) => {
          const profile = profiles.get(row.follower_id)!;
          return {
            id: row.follower_id,
            username: profile.username,
            displayName: profile.display_name,
            avatar: profile.avatar_url ?? null,
            createdAt: ms(row.created_at),
          };
        }),
    });
  }

  if (method === "POST" && second && (third === "accept" || third === "decline")) {
    const followerId = cleanText(second);
    if (third === "decline") {
      await postgrest(session.config, "follows", {
        method: "DELETE",
        token: session.token,
        params: { follower_id: `eq.${followerId}`, followee_id: `eq.${session.userId}`, status: "eq.pending" },
        representation: false,
      });
      return json({ ok: true });
    }
    const { data } = await postgrest(session.config, "follows", {
      method: "PATCH",
      token: session.token,
      params: { follower_id: `eq.${followerId}`, followee_id: `eq.${session.userId}`, status: "eq.pending" },
      body: { status: "accepted" },
    });
    const updated = Array.isArray(data) ? data.length : 0;
    if (!updated) return fail(404, "REQUEST_NOT_FOUND", "That request is not waiting for you.");
    await postgrest(session.config, "rpc/notify", {
      method: "POST",
      token: session.token,
      body: { p_user_id: followerId, p_kind: "follow-accepted", p_body: "accepted your follow" },
      representation: false,
    }).catch(() => undefined);
    return json({ ok: true });
  }

  return fail(404, "ROUTE_NOT_FOUND", `There is no ${method} /follow-requests on this deployment.`);
}

/* ---- store ---------------------------------------------------------------- */

interface StoreRow {
  id: string;
  submitter_id: string;
  name: string;
  description: string;
  category: string;
  url: string;
  status: string;
  review_note: string | null;
  created_at: string;
  reviewed_at: string | null;
}

function storeShape(row: StoreRow, submitter?: ProfileRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    category: row.category,
    url: row.url,
    status: row.status,
    reviewNote: row.review_note ?? null,
    createdAt: ms(row.created_at),
    reviewedAt: row.reviewed_at ? ms(row.reviewed_at) : null,
    submitter: {
      id: row.submitter_id,
      username: submitter?.username ?? null,
      displayName: submitter?.display_name ?? null,
    },
  };
}

async function withSubmitters(
  session: Session,
  rows: StoreRow[],
): Promise<Array<Record<string, unknown>>> {
  const profiles = await profilesByIds(session, rows.map((row) => row.submitter_id));
  return rows.map((row) => storeShape(row, profiles.get(row.submitter_id)));
}

async function storeRoute(
  request: Request,
  url: URL,
  session: Session,
  second: string | undefined,
  third: string | undefined,
  fourth: string | undefined,
): Promise<Response> {
  const method = request.method.toUpperCase();

  if (second === "approved" && method === "GET") {
    const { data } = await postgrest(session.config, "store_submissions", {
      params: { select: "*", status: "eq.approved", order: "reviewed_at.desc", limit: "200" },
      token: session.token,
    });
    return json({ submissions: await withSubmitters(session, (data as StoreRow[]) ?? []) });
  }

  if (second === "mine" && method === "GET") {
    const { data } = await postgrest(session.config, "store_submissions", {
      params: { select: "*", submitter_id: `eq.${session.userId}`, order: "created_at.desc", limit: "100" },
      token: session.token,
    });
    return json({ submissions: await withSubmitters(session, (data as StoreRow[]) ?? []) });
  }

  if (second === "submit" && method === "POST") {
    const body = await bodyAsJson(request);
    const name = cleanText(body.name).trim();
    const description = cleanText(body.description).trim();
    const category = cleanText(body.category).trim();
    const target = cleanText(body.url).trim();
    if (!name || name.length > 80) return fail(400, "INVALID_NAME", "Give the app a name (80 characters max).");
    if (!description || description.length > 500)
      return fail(400, "INVALID_DESCRIPTION", "Describe the app in 500 characters or fewer.");
    if (!category || category.length > 40) return fail(400, "INVALID_CATEGORY", "Pick a category (40 characters max).");
    if (!/^https?:\/\/[^\s]+$/i.test(target)) return fail(400, "INVALID_URL", "The link must be an http(s) URL.");

    try {
      const { data } = await postgrest(session.config, "store_submissions", {
        method: "POST",
        token: session.token,
        body: {
          submitter_id: session.userId,
          name,
          description,
          category,
          url: target,
          status: "pending",
        },
      });
      const row = (Array.isArray(data) ? data[0] : data) as StoreRow;
      return json({ submission: storeShape(row, session.profile) }, { status: 201 });
    } catch (error) {
      if (error instanceof SupabaseError && /url/i.test(error.message))
        return fail(400, "INVALID_URL", "The link must be an http(s) URL.");
      throw error;
    }
  }

  if (second === "admin" && method === "GET") {
    if (session.profile.role !== "admin")
      return fail(403, "NOT_ADMIN", "Only administrators can open the review queue.");
    const status = url.searchParams.get("status") ?? "pending";
    if (!["pending", "approved", "rejected"].includes(status))
      return fail(400, "INVALID_STATUS", "Status must be pending, approved or rejected.");
    const { data } = await postgrest(session.config, "store_submissions", {
      params: { select: "*", status: `eq.${status}`, order: "created_at.desc", limit: "200" },
      token: session.token,
    });
    const rows = (data as StoreRow[]) ?? [];
    const { data: pending } = await postgrest(session.config, "store_submissions", {
      params: { select: "id", status: "eq.pending" },
      token: session.token,
    });
    return json({ submissions: await withSubmitters(session, rows), pendingCount: Array.isArray(pending) ? pending.length : 0 });
  }

  if (second === "admin" && third && fourth === "review" && method === "POST") {
    if (session.profile.role !== "admin")
      return fail(403, "NOT_ADMIN", "Only administrators can review submissions.");
    const body = await bodyAsJson(request);
    const action = body.action === "approve" ? "approved" : body.action === "reject" ? "rejected" : null;
    if (!action) return fail(400, "INVALID_ACTION", "Action must be approve or reject.");
    const note = cleanText(body.note).slice(0, 500) || null;
    const { data } = await postgrest(session.config, "store_submissions", {
      method: "PATCH",
      token: session.token,
      params: { id: `eq.${third}` },
      body: {
        status: action,
        review_note: note,
        reviewed_at: new Date().toISOString(),
        reviewed_by: session.userId,
      },
    });
    const rows = Array.isArray(data) ? (data as StoreRow[]) : [];
    if (!rows.length) return fail(404, "SUBMISSION_NOT_FOUND", "That submission no longer exists.");
    return json({ submission: storeShape(rows[0], session.profile) });
  }

  return fail(404, "ROUTE_NOT_FOUND", `There is no ${method} /store/${second ?? ""} on this deployment.`);
}

async function communityAppsRoute(
  request: Request,
  url: URL,
  session: Session,
  second: string | undefined,
  third: string | undefined,
): Promise<Response> {
  const method = request.method.toUpperCase();

  if (second === "gallery" && method === "GET") {
    const category = url.searchParams.get("category");
    const params: Record<string, string> = {
      select: "*, profiles:developer_id(username, display_name, avatar_url)",
      visibility: "eq.public",
      verification_status: "eq.verified",
      order: "install_count.desc,created_at.desc",
      limit: "100",
    };
    if (category && category !== "all") {
      params.category = `eq.${category}`;
    }
    const { data } = await postgrest(session.config, "custom_apps", {
      params,
      token: session.token,
    });
    return json({ apps: Array.isArray(data) ? data : [] });
  }

  if (second === "mine" && method === "GET") {
    const { data } = await postgrest(session.config, "custom_apps", {
      params: {
        select: "*, profiles:developer_id(username, display_name, avatar_url)",
        developer_id: `eq.${session.userId}`,
        order: "created_at.desc",
        limit: "100",
      },
      token: session.token,
    });
    return json({ apps: Array.isArray(data) ? data : [] });
  }

  if (second === "submit" && method === "POST") {
    const body = await bodyAsJson(request);
    const { data } = await postgrest(session.config, "rpc/community_app_submit", {
      method: "POST",
      token: session.token,
      body: {
        p_name: body.name,
        p_description: body.description,
        p_website_url: body.website_url ?? body.url,
        p_icon_url: body.icon_url ?? null,
        p_category: body.category ?? "productivity",
        p_visibility: body.visibility ?? "public",
        p_moderator_notes: body.moderator_notes ?? "",
      },
    });
    return json({ app: data }, { status: 201 });
  }

  if (second === "resolve" && third && method === "GET") {
    const { data } = await postgrest(session.config, "rpc/community_app_resolve", {
      method: "POST",
      token: session.token,
      body: { p_identifier: third },
    });
    if (!data) return fail(404, "APP_NOT_FOUND", "Application not found or inaccessible.");
    return json({ app: data });
  }

  if (second && third === "install" && method === "POST") {
    const { data } = await postgrest(session.config, "rpc/community_app_install", {
      method: "POST",
      token: session.token,
      body: { p_app_id: second },
    });
    return json({ ok: true, result: data });
  }

  if (second && third === "install" && method === "DELETE") {
    const { data } = await postgrest(session.config, "rpc/community_app_uninstall", {
      method: "POST",
      token: session.token,
      body: { p_app_id: second },
    });
    return json({ ok: true, result: data });
  }

  if (second && third === "decide" && method === "POST") {
    if (session.profile.role !== "admin" && session.profile.role !== "moderator") {
      return fail(403, "NOT_AUTHORIZED", "Moderator authorization required.");
    }
    const body = await bodyAsJson(request);
    const { data } = await postgrest(session.config, "rpc/community_app_decide", {
      method: "POST",
      token: session.token,
      body: {
        p_app_id: second,
        p_action: body.action,
        p_reason: body.reason ?? "",
      },
    });
    return json({ ok: true, app: data });
  }

  return fail(404, "ROUTE_NOT_FOUND", `There is no ${method} /community-apps/${second ?? ""} on this deployment.`);
}

/* ---- router ---------------------------------------------------------------- */

export async function handleSocial(
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
  const [head, second, third] = segments;

  try {
    let response: Response;

    if (head === "feed" && segments.length === 1) {
      response = await feedRoute(request, url, session);
    } else if (head === "posts" && second === undefined && method === "POST") {
      response = await createPost(session, request);
    } else if (head === "posts" && second && third === undefined) {
      if (method === "PATCH") response = await patchPost(session, second, request);
      else if (method === "DELETE") response = await deletePost(session, second);
      else response = fail(405, "METHOD_NOT_ALLOWED", `${method} is not supported on /posts/:id.`);
    } else if (head === "posts" && second && third === "like" && (method === "POST" || method === "DELETE")) {
      response = await setLiked(session, second, method === "POST");
    } else if (head === "posts" && second && third === "bookmark" && (method === "POST" || method === "DELETE")) {
      response = await setBookmarked(session, second, method === "POST");
    } else if (head === "posts" && second && third === "comments") {
      response = await commentsRoute(request, session, second);
    } else if (head === "posts" && second && third === "report" && method === "POST") {
      const body = await bodyAsJson(request);
      const reason = cleanText(body.reason).trim() || "No reason given";
      if (reason.length > 500) return fail(400, "INVALID_REASON", "Keep the reason under 500 characters.");
      try {
        await postgrest(session.config, "post_reports", {
          method: "POST",
          token: session.token,
          body: { post_id: second, reporter_id: session.userId, reason },
          representation: false,
        });
      } catch (error) {
        if (!(error instanceof SupabaseError && error.status === 409)) throw error;
      }
      response = json({ ok: true });
    } else if (head === "comments" && second && method === "DELETE") {
      const { data } = await postgrest(session.config, "post_comments", {
        method: "DELETE",
        token: session.token,
        params: { id: `eq.${second}` },
      });
      response = Array.isArray(data) && data.length
        ? json({ ok: true })
        : fail(404, "COMMENT_NOT_FOUND", "That comment does not exist or is not yours.");
    } else if (head === "bookmarks" && segments.length === 1 && method === "GET") {
      response = await bookmarksRoute(session, url);
    } else if (head === "users" && second && third === undefined && method === "GET") {
      response = await profileRoute(session, second);
    } else if (head === "users" && second && third === "posts" && method === "GET") {
      response = await userPostsRoute(session, url, second);
    } else if (head === "users" && second && third === "follow" && (method === "POST" || method === "DELETE")) {
      response = await followRoute(session, second, method === "POST");
    } else if (head === "users" && second && third === "block" && (method === "POST" || method === "DELETE")) {
      response = await blockRoute(session, second, method === "POST");
    } else if (head === "follow-requests") {
      response = await followRequestsRoute(request, session, second, third);
    } else if (head === "store") {
      response = await storeRoute(request, url, session, second, third, segments[3]);
    } else if (head === "community-apps") {
      response = await communityAppsRoute(request, url, session, second, third);
    } else {
      response = fail(404, "ROUTE_NOT_FOUND", `There is no ${method} ${url.pathname} on this deployment.`);
    }

    return applyCookies(response, setCookies);
  } catch (error) {
    console.error("social route error", method, url.pathname, error);
    return fail(500, "INTERNAL_ERROR", "Something went wrong handling that request.");
  }
}
