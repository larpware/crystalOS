/* ==========================================================================
   Worker environment bindings
   ========================================================================== */

/** The minimal static-assets binding shape the Worker uses. */
export interface AssetsBinding {
  fetch(request: Request): Promise<Response>;
}

export interface Env {
  /** Project URL (public; also present in the frontend bundle). */
  SUPABASE_URL: string;
  /** Publishable (anon) key — set as a Worker secret or var, never in code. */
  SUPABASE_PUBLISHABLE_KEY?: string;
  SUPABASE_ANON_KEY?: string;
  /** The same two values under the names the shell's build reads. */
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  VITE_SUPABASE_ANON_KEY?: string;
  /** Optional moderation authority list, like CRESCENT_ADMINS on the Node backend. */
  CRESCENT_ADMINS?: string;
  /** Comma-separated origins/hosts allowed to call the API cross-origin. */
  CRESCENT_PUBLIC_ORIGINS?: string;
  /** Secret the Yapin bot uses to authenticate with the Worker (set via wrangler). */
  VERIFICATION_BOT_SECRET?: string;
  /** The Yapin user id of the bot itself, for audit context. */
  VERIFICATION_BOT_YAPIN_USER_ID?: string;
  /** Service-role key for calling SECURITY DEFINER functions (set via wrangler secret). */
  SUPABASE_SERVICE_KEY?: string;
  /** Static assets pipeline; absent when the Worker runs without assets. */
  ASSETS?: AssetsBinding;
}
