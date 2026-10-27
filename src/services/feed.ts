import { apiPath, apiRequest, type ApiResult } from "./api";

/* ==========================================================================
   Crystal Social — the client

   Thin client over the social endpoints of the accounts API. The server owns
   every decision: who may see a private account's posts, who may edit or
   delete what, who is blocked. Everything here is a request that can be
   refused, and every refusal comes back as a readable error.

   This module sits beside `./social` (friends and direct messages) rather
   than inside it: Crystal Social and Crystal Chat are separate applications
   that share an account, not one application with two tabs.
   ========================================================================== */

export interface SocialUserBrief {
  id: string;
  username: string;
  displayName: string;
  avatar: string | null;
  rarity: string | null;
  tags?: string[];
}

export interface SocialPost {
  id: string;
  body: string;
  image: string | null;
  createdAt: number;
  editedAt: number | null;
  author: SocialUserBrief & { private: boolean };
  likes: number;
  comments: number;
  liked: boolean;
  bookmarked: boolean;
}

export interface SocialComment {
  id: string;
  postId: string;
  body: string;
  createdAt: number;
  likes: number;
  liked: boolean;
  author: SocialUserBrief;
}

export interface PostPage {
  posts: SocialPost[];
  nextBefore: number | null;
}

export interface SocialProfile {
  id: string;
  username: string;
  displayName: string;
  avatar: string | null;
  bio: string | null;
  rarity: string | null;
  /** Labels worn beside the name (owner, staff, …); presentation only. */
  tags?: string[];
  createdAt: number;
  private: boolean;
  counts: { followers: number; following: number; pendingFollowers: number };
  relationship: {
    self: boolean;
    following: "accepted" | "pending" | null;
    followedBy: "accepted" | "pending" | null;
  };
}

export interface SocialNotification {
  id: string;
  kind: "like" | "comment" | "follow" | "follow-accepted";
  postId: string | null;
  body: string | null;
  createdAt: number;
  readAt: number | null;
  actor: { id: string; username: string; displayName: string; avatar: string | null } | null;
}

export function fetchFeed(before: number | null = null, limit = 20): Promise<ApiResult<{ feed: PostPage }>> {
  const query = new URLSearchParams({ limit: String(limit) });
  if (before) query.set("before", String(before));
  return apiRequest(`/feed?${query}`);
}

export function createPost(body: string, image: string | null) {
  return apiRequest<{ post: SocialPost }>("/posts", { method: "POST", body: { body, image } });
}

export function editPost(postId: string, body: string) {
  return apiRequest<{ post: SocialPost }>(apiPath("posts", postId), {
    method: "PATCH",
    body: { body },
  });
}

export function deletePost(postId: string) {
  return apiRequest(apiPath("posts", postId), { method: "DELETE" });
}

export function setLiked(postId: string, liked: boolean) {
  return apiRequest<{ liked: boolean }>(apiPath("posts", postId, "like"), {
    method: liked ? "POST" : "DELETE",
  });
}

export function setBookmarked(postId: string, bookmarked: boolean) {
  return apiRequest<{ bookmarked: boolean }>(apiPath("posts", postId, "bookmark"), {
    method: bookmarked ? "POST" : "DELETE",
  });
}

export function fetchBookmarks(): Promise<ApiResult<PostPage>> {
  return apiRequest("/bookmarks");
}

export function fetchComments(postId: string) {
  return apiRequest<{ comments: SocialComment[] }>(apiPath("posts", postId, "comments"));
}

export function addComment(postId: string, body: string) {
  return apiRequest<{ comment: SocialComment }>(apiPath("posts", postId, "comments"), {
    method: "POST",
    body: { body },
  });
}

export function deleteComment(commentId: string) {
  return apiRequest(apiPath("comments", commentId), { method: "DELETE" });
}

export function reportPost(postId: string, reason: string) {
  return apiRequest(apiPath("posts", postId, "report"), { method: "POST", body: { reason } });
}

export function fetchProfile(username: string) {
  return apiRequest<{ profile: SocialProfile }>(apiPath("users", username));
}

export function fetchUserPosts(username: string, before: number | null = null, limit = 20) {
  const query = new URLSearchParams({ limit: String(limit) });
  if (before) query.set("before", String(before));
  return apiRequest<PostPage>(`${apiPath("users", username, "posts")}?${query}`);
}

export function setFollowing(username: string, following: boolean) {
  return apiRequest<{ following: boolean; pending?: boolean }>(apiPath("users", username, "follow"), {
    method: following ? "POST" : "DELETE",
  });
}

export function setBlocked(username: string, blocked: boolean) {
  return apiRequest<{ blocked: boolean }>(apiPath("users", username, "block"), {
    method: blocked ? "POST" : "DELETE",
  });
}

export function fetchFollowRequests() {
  return apiRequest<{
    requests: { id: string; username: string; displayName: string; avatar: string | null; createdAt: number }[];
  }>("/follow-requests");
}

export function respondFollowRequest(followerId: string, accept: boolean) {
  return apiRequest(`/follow-requests/${encodeURIComponent(followerId)}/${accept ? "accept" : "decline"}`, {
    method: "POST",
    body: {},
  });
}

export function fetchNotifications(since = 0) {
  return apiRequest<{ notifications: SocialNotification[] }>(`/notifications?since=${Math.max(0, Math.floor(since))}`);
}

export function markNotificationsRead() {
  return apiRequest("/notifications", { method: "POST" });
}

export function setPrivateAccount(isPrivate: boolean) {
  return apiRequest<{ user: unknown }>("/me", { method: "PATCH", body: { privateAccount: isPrivate } });
}

/** Reads an ApiResult or returns its message — the app's single error path. */
export function feedError(result: ApiResult<unknown>): string | null {
  return result.ok ? null : result.error.message;
}
