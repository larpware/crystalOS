/*
 * CrystalOS — Crystal Social storage
 *
 * Posts, likes, comments, follows, bookmarks, notifications, blocks and
 * moderation reports. Same rules as the rest of the accounts database:
 * everything enforced by the schema that can be, and every operation that
 * touches two tables runs inside the caller's transaction.
 *
 * Privacy model:
 *   - A private account's posts are visible only to approved followers; the
 *     follow request therefore carries a status (`accepted` | `pending`) and
 *     only an accepted follow grants visibility.
 *   - Blocking hides both directions: the blocked user's posts never reach the
 *     blocker and vice versa, and follows/comments/likes between them are
 *     refused.
 *
 * Images travel as data URLs validated by the API layer and stored inline.
 * They are capped well below anything that would threaten the database file;
 * this is a personal desktop OS, not an image host.
 */

import { createId } from "./ids.mjs";
import { tagsOf } from "./tags.mjs";

export const SOCIAL_SCHEMA = `
CREATE TABLE IF NOT EXISTS follows (
  follower_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followee_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status      TEXT NOT NULL DEFAULT 'accepted',
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (follower_id, followee_id)
);
CREATE INDEX IF NOT EXISTS follows_followee ON follows(followee_id, status);

CREATE TABLE IF NOT EXISTS blocks (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, blocked_id)
);

CREATE TABLE IF NOT EXISTS posts (
  id           TEXT PRIMARY KEY,
  author_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body         TEXT NOT NULL,
  image        TEXT,
  created_at   INTEGER NOT NULL,
  edited_at    INTEGER,
  deleted_at   INTEGER
);
CREATE INDEX IF NOT EXISTS posts_author ON posts(author_id, created_at);
CREATE INDEX IF NOT EXISTS posts_recent ON posts(created_at);

CREATE TABLE IF NOT EXISTS post_likes (
  post_id    TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (post_id, user_id)
);
CREATE INDEX IF NOT EXISTS post_likes_user ON post_likes(user_id);

CREATE TABLE IF NOT EXISTS comments (
  id         TEXT PRIMARY KEY,
  post_id    TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS comments_post ON comments(post_id, created_at);

CREATE TABLE IF NOT EXISTS comment_likes (
  comment_id TEXT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (comment_id, user_id)
);

CREATE TABLE IF NOT EXISTS bookmarks (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id    TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, post_id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  actor_id   TEXT REFERENCES users(id) ON DELETE CASCADE,
  post_id    TEXT,
  body       TEXT,
  created_at INTEGER NOT NULL,
  read_at    INTEGER
);
CREATE INDEX IF NOT EXISTS notifications_user ON notifications(user_id, created_at);

CREATE TABLE IF NOT EXISTS post_reports (
  id          TEXT PRIMARY KEY,
  post_id     TEXT NOT NULL,
  reporter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason      TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  resolved_at INTEGER,
  resolution  TEXT
);
CREATE INDEX IF NOT EXISTS post_reports_open ON post_reports(resolved_at);
`;

const MAX_FEED_PAGE = 40;

/** Accepted-follow visibility, private accounts included. */
export function createSocialStore(db, transaction) {
  db.exec(SOCIAL_SCHEMA);

  /* The topic column arrived after the first release. CREATE TABLE IF NOT
     EXISTS cannot add a column to a table that already exists, so this is the
     same one-step migration the users table uses — rows written before it keep
     a NULL topic and read back as "general" (see shapedPost / feedPage). */
  const postColumns = db.prepare("PRAGMA table_info(posts)").all();
  if (!postColumns.some((column) => column.name === "topic")) {
    db.exec("ALTER TABLE posts ADD COLUMN topic TEXT");
  }

  function isBlockedEither(a, b) {
    if (a === b) return false;
    return Boolean(
      db
        .prepare(
          `SELECT 1 FROM blocks
            WHERE (user_id = ? AND blocked_id = ?) OR (user_id = ? AND blocked_id = ?)`,
        )
        .get(a, b, b, a),
    );
  }

  function userByUsername(username) {
    return db.prepare("SELECT * FROM users WHERE username_lower = ?").get(String(username).toLowerCase());
  }

  function privacyOf(userId) {
    const row = db.prepare("SELECT private_account FROM users WHERE id = ?").get(userId);
    return { private: Boolean(row?.private_account) };
  }

  function followStatus(followerId, followeeId) {
    const row = db
      .prepare("SELECT status FROM follows WHERE follower_id = ? AND followee_id = ?")
      .get(followerId, followeeId);
    return row?.status ?? null;
  }

  function canViewPosts(viewerId, authorId) {
    if (viewerId === authorId) return true;
    if (isBlockedEither(viewerId, authorId)) return false;
    if (!privacyOf(authorId).private) return true;
    return followStatus(viewerId, authorId) === "accepted";
  }

  function notify(userId, kind, actorId, postId, body) {
    if (userId === actorId) return; // never notify yourself about yourself
    db.prepare(
      `INSERT INTO notifications (id, user_id, kind, actor_id, post_id, body, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(createId("ntf"), userId, kind, actorId ?? null, postId ?? null, body ?? null, Date.now());
  }

  /** One post, shaped for the client, with the viewer's own flags resolved. */
  function shapedPost(row, viewerId) {
    if (!row) return null;
    const author = db
      .prepare(
        `SELECT id, username, display_name, avatar, rarity, created_at, private_account, tags
           FROM users WHERE id = ?`,
      )
      .get(row.author_id);
    const likes = Number(db.prepare("SELECT COUNT(*) AS n FROM post_likes WHERE post_id = ?").get(row.id).n);
    const comments = Number(
      db
        .prepare("SELECT COUNT(*) AS n FROM comments WHERE post_id = ? AND deleted_at IS NULL")
        .get(row.id).n,
    );
    const liked = viewerId
      ? Boolean(db.prepare("SELECT 1 FROM post_likes WHERE post_id = ? AND user_id = ?").get(row.id, viewerId))
      : false;
    const bookmarked = viewerId
      ? Boolean(db.prepare("SELECT 1 FROM bookmarks WHERE post_id = ? AND user_id = ?").get(row.id, viewerId))
      : false;
    return {
      id: row.id,
      body: row.body,
      image: row.image ?? null,
      // Rows written before topics existed carry no value and read as general.
      topic: row.topic ?? "general",
      createdAt: row.created_at,
      editedAt: row.edited_at ?? null,
      author: {
        id: row.author_id,
        username: author?.username ?? "unknown",
        displayName: author?.display_name ?? "Unknown",
        avatar: author?.avatar ?? null,
        rarity: author?.rarity ?? null,
        tags: tagsOf(author),
        private: Boolean(author?.private_account),
      },
      likes,
      comments,
      liked,
      bookmarked,
    };
  }

  /**
   * `before` is a cursor: return the page of posts strictly older than it.
   *
   * `scope` narrows the feed to the people the viewer follows (plus their own
   * posts); `topic` narrows it to one topic. Both are optional, so the default
   * remains the plain reverse-chronological feed every existing client expects.
   * Visibility is still enforced per row by canViewPosts below the query — a
   * private account's posts never leak through a scope change.
   */
  function feedPage(viewerId, { before = null, limit = 20, scope = null, topic = null } = {}) {
    const size = Math.max(1, Math.min(MAX_FEED_PAGE, Number(limit) || 20));
    const where = ["deleted_at IS NULL"];
    const params = [];
    if (scope === "following") {
      where.push(
        `(author_id = ? OR author_id IN (
            SELECT followee_id FROM follows
             WHERE follower_id = ? AND status = 'accepted'))`,
      );
      params.push(viewerId, viewerId);
    }
    if (topic) {
      // COALESCE so rows written before topics existed still match "general".
      where.push("COALESCE(topic, 'general') = ?");
      params.push(topic);
    }
    if (before) {
      where.push("created_at < ?");
      params.push(Number(before));
    }
    const rows = db
      .prepare(
        `SELECT * FROM posts
          WHERE ${where.join("\n            AND ")}
          ORDER BY created_at DESC, rowid DESC
          LIMIT ?`,
      )
      .all(...params, size + 1);
    const page = rows.slice(0, size).filter((row) => canViewPosts(viewerId, row.author_id));
    return {
      posts: page.map((row) => shapedPost(row, viewerId)),
      nextBefore: rows.length > size ? (page[page.length - 1]?.created_at ?? null) : null,
    };
  }

  function postsByAuthor(viewerId, authorId, { before = null, limit = 20 } = {}) {
    if (!canViewPosts(viewerId, authorId)) return { posts: [], nextBefore: null, restricted: true };
    const size = Math.max(1, Math.min(MAX_FEED_PAGE, Number(limit) || 20));
    const rows = db
      .prepare(
        `SELECT * FROM posts
          WHERE author_id = ? AND deleted_at IS NULL
            ${before ? "AND created_at < ?" : ""}
          ORDER BY created_at DESC, rowid DESC
          LIMIT ?`,
      )
      .all(...(before ? [authorId, Number(before), size + 1] : [authorId, size + 1]));
    const page = rows.slice(0, size);
    return {
      posts: page.map((row) => shapedPost(row, viewerId)),
      nextBefore: rows.length > size ? (page[page.length - 1]?.created_at ?? null) : null,
    };
  }

  function followCounts(userId) {
    const followers = Number(
      db
        .prepare("SELECT COUNT(*) AS n FROM follows WHERE followee_id = ? AND status = 'accepted'")
        .get(userId).n,
    );
    const following = Number(
      db
        .prepare("SELECT COUNT(*) AS n FROM follows WHERE follower_id = ? AND status = 'accepted'")
        .get(userId).n,
    );
    const pendingFollowers = Number(
      db
        .prepare("SELECT COUNT(*) AS n FROM follows WHERE followee_id = ? AND status = 'pending'")
        .get(userId).n,
    );
    return { followers, following, pendingFollowers };
  }

  return {
    userByUsername,
    privacyOf,
    followStatus,
    followCounts,
    canViewPosts,
    isBlockedEither,
    shapedPost,
    feedPage,
    postsByAuthor,

    createPost(authorId, { body, image, topic }) {
      const id = createId("pst");
      db.prepare(
        "INSERT INTO posts (id, author_id, body, image, topic, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(id, authorId, body, image ?? null, topic || "general", Date.now());
      return shapedPost(db.prepare("SELECT * FROM posts WHERE id = ?").get(id), authorId);
    },

    postById(postId) {
      return db.prepare("SELECT * FROM posts WHERE id = ?").get(postId) ?? null;
    },

    editPost(postId, body) {
      db.prepare("UPDATE posts SET body = ?, edited_at = ? WHERE id = ?").run(body, Date.now(), postId);
      return shapedPost(db.prepare("SELECT * FROM posts WHERE id = ?").get(postId), null);
    },

    deletePost(postId) {
      db.prepare("UPDATE posts SET deleted_at = ? WHERE id = ?").run(Date.now(), postId);
      db.prepare("DELETE FROM bookmarks WHERE post_id = ?").run(postId);
    },

    isPostLikedBy(postId, userId) {
      return Boolean(
        db.prepare("SELECT 1 FROM post_likes WHERE post_id = ? AND user_id = ?").get(postId, userId),
      );
    },

    isBookmarkedBy(postId, userId) {
      return Boolean(
        db.prepare("SELECT 1 FROM bookmarks WHERE post_id = ? AND user_id = ?").get(postId, userId),
      );
    },

    isCommentLikedBy(commentId, userId) {
      return Boolean(
        db
          .prepare("SELECT 1 FROM comment_likes WHERE comment_id = ? AND user_id = ?")
          .get(commentId, userId),
      );
    },

    toggleLike(postId, userId) {
      const liked = db
        .prepare("SELECT 1 FROM post_likes WHERE post_id = ? AND user_id = ?")
        .get(postId, userId);
      if (liked) {
        db.prepare("DELETE FROM post_likes WHERE post_id = ? AND user_id = ?").run(postId, userId);
        return false;
      }
      db.prepare("INSERT INTO post_likes (post_id, user_id, created_at) VALUES (?, ?, ?)").run(
        postId,
        userId,
        Date.now(),
      );
      const post = db.prepare("SELECT author_id FROM posts WHERE id = ?").get(postId);
      if (post) notify(post.author_id, "like", userId, postId, null);
      return true;
    },

    toggleBookmark(postId, userId) {
      const saved = db
        .prepare("SELECT 1 FROM bookmarks WHERE post_id = ? AND user_id = ?")
        .get(postId, userId);
      if (saved) {
        db.prepare("DELETE FROM bookmarks WHERE post_id = ? AND user_id = ?").run(postId, userId);
        return false;
      }
      db.prepare("INSERT INTO bookmarks (user_id, post_id, created_at) VALUES (?, ?, ?)").run(
        userId,
        postId,
        Date.now(),
      );
      return true;
    },

    bookmarksFor(userId, { before = null, limit = 20 } = {}) {
      const size = Math.max(1, Math.min(MAX_FEED_PAGE, Number(limit) || 20));
      const rows = db
        .prepare(
          `SELECT p.* FROM bookmarks b JOIN posts p ON p.id = b.post_id
            WHERE b.user_id = ? AND p.deleted_at IS NULL
              ${before ? "AND b.created_at < ?" : ""}
            ORDER BY b.created_at DESC
            LIMIT ?`,
        )
        .all(...(before ? [userId, Number(before), size + 1] : [userId, size + 1]));
      const page = rows.slice(0, size).filter((row) => canViewPosts(userId, row.author_id));
      return {
        posts: page.map((row) => shapedPost(row, userId)),
        nextBefore: rows.length > size ? (page[page.length - 1]?.created_at ?? null) : null,
      };
    },

    commentsFor(postId, viewerId) {
      return db
        .prepare(
          `SELECT * FROM comments WHERE post_id = ? AND deleted_at IS NULL
            ORDER BY created_at ASC, rowid ASC LIMIT 500`,
        )
        .all(postId)
        .map((row) => {
          const author = db
            .prepare("SELECT id, username, display_name, avatar, rarity, tags FROM users WHERE id = ?")
            .get(row.author_id);
          const likes = Number(
            db.prepare("SELECT COUNT(*) AS n FROM comment_likes WHERE comment_id = ?").get(row.id).n,
          );
          const liked = viewerId
            ? Boolean(
                db
                  .prepare("SELECT 1 FROM comment_likes WHERE comment_id = ? AND user_id = ?")
                  .get(row.id, viewerId),
              )
            : false;
          return {
            id: row.id,
            postId: row.post_id,
            body: row.body,
            createdAt: row.created_at,
            likes,
            liked,
            author: {
              id: row.author_id,
              username: author?.username ?? "unknown",
              displayName: author?.display_name ?? "Unknown",
              avatar: author?.avatar ?? null,
              rarity: author?.rarity ?? null,
              tags: tagsOf(author),
            },
          };
        });
    },

    addComment(postId, authorId, body) {
      const id = createId("cmt");
      db.prepare(
        "INSERT INTO comments (id, post_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)",
      ).run(id, postId, authorId, body, Date.now());
      const post = db.prepare("SELECT author_id FROM posts WHERE id = ?").get(postId);
      if (post) notify(post.author_id, "comment", authorId, postId, body.slice(0, 140));
      const row = db.prepare("SELECT * FROM comments WHERE id = ?").get(id);
      const author = db
        .prepare("SELECT id, username, display_name, avatar, rarity, tags FROM users WHERE id = ?")
        .get(authorId);
      return {
        id: row.id,
        postId,
        body: row.body,
        createdAt: row.created_at,
        likes: 0,
        liked: false,
        author: {
          id: authorId,
          username: author.username,
          displayName: author.display_name,
          avatar: author.avatar ?? null,
          rarity: author.rarity ?? null,
          tags: tagsOf(author),
        },
      };
    },

    deleteComment(commentId, requesterId, isAdmin) {
      const row = db.prepare("SELECT * FROM comments WHERE id = ?").get(commentId);
      if (!row) return { found: false };
      if (row.author_id !== requesterId && !isAdmin) return { found: true, allowed: false };
      db.prepare("UPDATE comments SET deleted_at = ? WHERE id = ?").run(Date.now(), commentId);
      return { found: true, allowed: true };
    },

    toggleCommentLike(commentId, userId) {
      const liked = db
        .prepare("SELECT 1 FROM comment_likes WHERE comment_id = ? AND user_id = ?")
        .get(commentId, userId);
      if (liked) {
        db.prepare("DELETE FROM comment_likes WHERE comment_id = ? AND user_id = ?").run(
          commentId,
          userId,
        );
        return false;
      }
      db.prepare("INSERT INTO comment_likes (comment_id, user_id, created_at) VALUES (?, ?, ?)").run(
        commentId,
        userId,
        Date.now(),
      );
      return true;
    },

    /** Follow request. Returns the resulting status: accepted or pending. */
    requestFollow(followerId, followeeId) {
      const privacy = privacyOf(followeeId);
      const status = privacy.private ? "pending" : "accepted";
      db.prepare(
        `INSERT INTO follows (follower_id, followee_id, status, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(follower_id, followee_id) DO UPDATE SET status = excluded.status`,
      ).run(followerId, followeeId, status, Date.now());
      if (status === "accepted") notify(followeeId, "follow", followerId, null, null);
      return status;
    },

    /** Owner accepts or declines a pending follow. */
    respondFollow(followerId, followeeId, accept) {
      const row = db
        .prepare("SELECT * FROM follows WHERE follower_id = ? AND followee_id = ?")
        .get(followerId, followeeId);
      if (!row || row.status !== "pending") return false;
      if (accept) {
        db.prepare("UPDATE follows SET status = 'accepted' WHERE follower_id = ? AND followee_id = ?").run(
          followerId,
          followeeId,
        );
        notify(followerId, "follow-accepted", followeeId, null, null);
      } else {
        db.prepare("DELETE FROM follows WHERE follower_id = ? AND followee_id = ?").run(
          followerId,
          followeeId,
        );
      }
      return true;
    },

    unfollow(followerId, followeeId) {
      db.prepare("DELETE FROM follows WHERE follower_id = ? AND followee_id = ?").run(
        followerId,
        followeeId,
      );
    },

    pendingFollowers(userId) {
      return db
        .prepare(
          `SELECT f.follower_id AS id, u.username, u.display_name, u.avatar, u.rarity, u.tags, f.created_at
             FROM follows f JOIN users u ON u.id = f.follower_id
            WHERE f.followee_id = ? AND f.status = 'pending'
            ORDER BY f.created_at DESC LIMIT 100`,
        )
        .all(userId);
    },

    setBlocked(userId, blockedId, blocked) {
      if (blocked) {
        db.prepare(
          "INSERT OR IGNORE INTO blocks (user_id, blocked_id, created_at) VALUES (?, ?, ?)",
        ).run(userId, blockedId, Date.now());
        // Blocking severs both follow directions — a blocked account should
        // not linger in either list.
        db.prepare(
          "DELETE FROM follows WHERE (follower_id = ? AND followee_id = ?) OR (follower_id = ? AND followee_id = ?)",
        ).run(userId, blockedId, blockedId, userId);
      } else {
        db.prepare("DELETE FROM blocks WHERE user_id = ? AND blocked_id = ?").run(userId, blockedId);
      }
    },

    profile(viewerId, username) {
      const user = userByUsername(username);
      if (!user) return null;
      if (viewerId && isBlockedEither(viewerId, user.id)) return { blocked: true };
      const counts = followCounts(user.id);
      const relationship = viewerId
        ? {
            self: viewerId === user.id,
            following: followStatus(viewerId, user.id),
            followedBy: followStatus(user.id, viewerId),
          }
        : { self: false, following: null, followedBy: null };
      return {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        avatar: user.avatar ?? null,
        bio: user.bio ?? null,
        rarity: user.rarity ?? null,
        tags: tagsOf(user),
        createdAt: user.created_at,
        private: Boolean(user.private_account),
        counts,
        relationship,
      };
    },

    notifications(userId, since = 0, limit = 100) {
      const rows = db
        .prepare(
          `SELECT * FROM notifications
            WHERE user_id = ? AND created_at > ?
            ORDER BY created_at DESC LIMIT ?`,
        )
        .all(userId, Math.max(0, Number(since) || 0), Math.min(200, Number(limit) || 100));
      return rows.map((row) => {
        const actor = row.actor_id
          ? db
              .prepare("SELECT id, username, display_name, avatar, tags FROM users WHERE id = ?")
              .get(row.actor_id)
          : null;
        return {
          id: row.id,
          kind: row.kind,
          postId: row.post_id ?? null,
          body: row.body ?? null,
          createdAt: row.created_at,
          readAt: row.read_at ?? null,
          actor: actor
            ? {
                id: actor.id,
                username: actor.username,
                displayName: actor.display_name,
                avatar: actor.avatar ?? null,
                tags: tagsOf(actor),
              }
            : null,
        };
      });
    },

    markNotificationsRead(userId) {
      db.prepare("UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL").run(
        Date.now(),
        userId,
      );
    },

    reportPost(reporterId, postId, reason) {
      db.prepare(
        "INSERT INTO post_reports (id, post_id, reporter_id, reason, created_at) VALUES (?, ?, ?, ?, ?)",
      ).run(createId("rpt"), postId, reporterId, reason, Date.now());
    },

    openReports() {
      return db
        .prepare(
          `SELECT r.*, u.username AS reporter_username, p.body AS post_body, p.author_id
             FROM post_reports r
             JOIN users u ON u.id = r.reporter_id
             LEFT JOIN posts p ON p.id = r.post_id
            WHERE r.resolved_at IS NULL
            ORDER BY r.created_at ASC`,
        )
        .all();
    },

    resolveReport(reportId, resolution, postId, removePost) {
      if (removePost && postId) {
        db.prepare("UPDATE posts SET deleted_at = ? WHERE id = ?").run(Date.now(), postId);
      }
      db.prepare("UPDATE post_reports SET resolved_at = ?, resolution = ? WHERE id = ?").run(
        Date.now(),
        resolution,
        reportId,
      );
    },
  };
}
