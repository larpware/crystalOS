import type { ComponentType } from "react";
import type { IconName } from "@/icons/icons";

export type { IconName };

/* ==========================================================================
   Applications
   ========================================================================== */

export type AppCategory =
  | "system"
  | "internet"
  | "media"
  | "games"
  | "productivity"
  | "utilities";

export const APP_CATEGORY_LABEL: Record<AppCategory, string> = {
  system: "System",
  internet: "Internet",
  media: "Media",
  games: "Games",
  productivity: "Productivity",
  utilities: "Utilities",
};

export type AppCapability =
  | "filesystem"
  | "network"
  | "notifications"
  | "storage"
  | "microphone"
  | "camera";

export interface AppProps {
  /** Window the app instance is running in. */
  windowId: string;
  /** Arguments supplied at launch, e.g. `open terminal ls ~/Downloads`. */
  args?: Record<string, unknown>;
}

export interface AppDefinition {
  id: string;
  name: string;
  /** Short description shown in the store and launcher. */
  summary: string;
  icon: IconName;
  category: AppCategory;
  defaultSize: { width: number; height: number };
  minSize: { width: number; height: number };
  /** Applications that cannot be resized or maximized. */
  resizable?: boolean;
  /** Shown pinned in the dock after first launch unless the user unpins it. */
  pinnable?: boolean;
  /** Ships with the OS. Non-system apps can be removed from the store. */
  system?: boolean;
  capabilities?: AppCapability[];
  component: ComponentType<AppProps>;
}

/* ==========================================================================
   Windows
   ========================================================================== */

export type WindowState = "normal" | "minimized" | "maximized" | "snapped";

export type SnapZone =
  | "left"
  | "right"
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The same rect expressed as 0..1 of the work area.
 *
 * Used for tiled windows: a tile is a share of the desk, not a pixel size, so
 * it can be re-derived when the viewport changes.
 */
export interface FractionalRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowInstance {
  id: string;
  appId: string;
  title: string;
  icon: IconName;
  /** Stacking order; higher is closer to the front. */
  z: number;
  state: WindowState;
  /** Geometry when not maximized/snapped. */
  rect: Rect;
  /** Geometry to restore to after un-maximizing. */
  restoreRect: Rect;
  /**
   * Present only while the window is tiled (snapped or in a layout): the tile
   * as a share of the work area, so it survives a viewport change.
   */
  snapBox?: FractionalRect;
  minimized: boolean;
  focused: boolean;
  /**
   * Full screen: the window owns the entire viewport instead of the work area.
   * Unlike maximize it reserves nothing for the panel or the dock — the shell's
   * bars are not excluded, they keep their stacking order and stay painted above
   * the window. Geometry is deliberately untouched: `rect` still describes where
   * the window goes back to, so leaving full screen restores it exactly.
   */
  full?: boolean;
  args?: Record<string, unknown>;
  /** Blocking the rest of the desktop with a scrim. */
  modal?: boolean;
  /** Workspace this window belongs to; undefined means "wherever it opened". */
  workspaceId?: string;
  /** Sticky windows stay visible on every workspace. */
  sticky?: boolean;
}

/**
 * Everything the session restorer needs to bring a window back. Deliberately a
 * plain data contract: no DOM nodes, no component state, no functions.
 */
export interface WindowSnapshot {
  appId: string;
  title: string;
  icon: IconName;
  rect: Rect;
  restoreRect: Rect;
  snapBox?: FractionalRect;
  state: WindowState;
  minimized: boolean;
  workspaceId?: string;
  sticky?: boolean;
  args?: Record<string, unknown>;
}

/* ==========================================================================
   Appearance
   ========================================================================== */

/*
 * A theme is a complete material system, not a tint: surfaces, chrome
 * materials, lighting and elevation all travel together so switching themes
 * changes the atmosphere of the OS rather than only its accent colour.
 */
export interface ThemeTokens {
  /* root + surfaces */
  bgRoot: string;
  bgDesktop: string;
  surface0: string;
  surface1: string;
  surface2: string;
  surface3: string;
  surfaceHover: string;
  surfaceActive: string;
  surfaceSunken: string;

  /* named materials for the chrome layers */
  panelMaterial: string;
  dockMaterial: string;
  windowMaterial: string;
  modalMaterial: string;

  /* text */
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  textMuted: string;

  /* borders + lighting */
  borderSubtle: string;
  borderDefault: string;
  borderStrong: string;
  innerHighlight: string;
  edgeLight: string;

  /* icon treatment */
  iconSurface: string;
  iconSurfaceStrong: string;

  /* elevation */
  shadowSoft: string;
  shadowPopover: string;
  shadowWindow: string;

  /* accent */
  accent: string;
  accentHover: string;
  accentMuted: string;
  accentOnMuted: string;

  /** Optional wallpaper this theme was designed against. */
  wallpaperDefault?: string;
}

export interface ThemePreset {
  id: string;
  name: string;
  appearance: "dark" | "light";
  description: string;
  tokens: ThemeTokens;
  /**
   * Font persona some themes ship with (the Solarized pair swaps the whole
   * type system). Honoured while the user's font picks are the interface
   * defaults; any explicit font choice in Settings wins.
   */
  defaultFonts?: { ui: string; mono: string; display: string };
  /** Curated flag: these carry the unified design system at its best. */
  recommended?: boolean;
  /**
   * Kept so existing profiles and custom themes built from it still work, but
   * no longer promoted: badged as deprecated and listed last in every picker.
   */
  deprecated?: boolean;
}

export interface CustomTheme extends ThemePreset {
  createdAt: number;
}

export interface IconPack {
  id: string;
  name: string;
  /** Maps an application id to an image URL or data URL. */
  mapping: Record<string, string>;
  createdAt: number;
  builtIn?: boolean;
}

export interface CustomWallpaperRecord {
  id: string;
  name: string;
  kind: WallpaperKind;
  mime: string;
  /** Stored in IndexedDB under `blobs`. */
  blobKey: string;
  createdAt: number;
  width?: number;
  height?: number;
}

export type WallpaperScale = "cover" | "contain" | "fill" | "tile";


export type MotionLevel = "full" | "subtle" | "reduced";

/* ==========================================================================
   Wallpapers
   ========================================================================== */

export type WallpaperKind = "image" | "live" | "gradient";

export interface WallpaperSource {
  id: string;
  name: string;
  kind: WallpaperKind;
  /**
   * Shown under the tile name and included in the library search, so the
   * values are the words a user would actually type ("space", "city"), not
   * an internal taxonomy.
   */
  category: "landscape" | "abstract" | "graphics" | "space" | "city" | "custom" | "video";
  /** Remote or object URL for image/video wallpapers. */
  url?: string;
  /** CSS background used when the remote asset cannot load, and for gradients. */
  fallback: string;
  /** Live wallpaper scene identifier. */
  scene?: LiveSceneId;
  credit?: string;
  /** Custom wallpapers are stored in IndexedDB under this key. */
  localKey?: string;
}

export type LiveSceneId =
  | "aurora"
  | "drift"
  | "mesh"
  | "starfield"
  | "waves"
  | "rainfall"
  | "ember"
  | "snowfall"
  | "dunes";

/* ==========================================================================
   Widgets
   ========================================================================== */

export type WidgetId =
  | "clock"
  | "calendar"
  | "weather"
  | "notes"
  | "system"
  | "music"
  | "shortcuts"
  | "battery"
  | "todo"
  | "files"
  | "network"
  | "countdown";

export interface WidgetInstance {
  id: string;
  widget: WidgetId;
  x: number;
  y: number;
  /** Grid cells for width/height, 1 cell ≈ 96px. */
  w: number;
  h: number;
  settings?: Record<string, unknown>;
}

/* ==========================================================================
   Notifications
   ========================================================================== */

export interface NotificationAction {
  label: string;
  run: () => void;
}

export interface OsNotification {
  id: string;
  appId: string;
  icon: IconName;
  title: string;
  body?: string;
  createdAt: number;
  read: boolean;
  /** Transient notifications are not written to history. */
  transient?: boolean;
  actions?: NotificationAction[];
}

/* ==========================================================================
   Virtual filesystem
   ========================================================================== */

export type FileKind = "file" | "folder";

export interface FileNode {
  id: string;
  name: string;
  kind: FileKind;
  parentId: string | null;
  /** Bytes; folders report the sum of their children. */
  size: number;
  modified: number;
  created: number;
  mime?: string;
  /** Text contents for editable text files. */
  content?: string;
  /** Data URL for user-added binaries. */
  dataUrl?: string;
  trashed?: boolean;
  /** Position on the desktop layer, for entries in ~/Desktop. */
  desktopPosition?: { x: number; y: number };
  readonly?: boolean;
  /**
   * Set on an application shortcut: the catalogue id this entry opens. Used by
   * the desktop to draw the application's own icon and to open it straight
   * from the desktop.
   */
  appId?: string;
}

export interface ClipboardState {
  mode: "copy" | "cut";
  ids: string[];
}

/* ==========================================================================
   Accounts
   ========================================================================== */

/**
 * The tiers a friend code can be drawn into, lowest first. Rarity is cosmetic:
 * it decides how the profile card is painted and nothing else. The weights and
 * the generation logic live in `server/accounts/rarity.mjs`, which is the only
 * thing that draws one.
 */
export type RarityId =
  | "basic"
  | "uncommon"
  | "rare"
  | "epic"
  | "legendary"
  | "prismatic"
  | "transcendent";

export interface AccountProfile {
  id: string;
  username: string;
  displayName: string;
  /**
   * Assigned by the account server when a registered account is created and
   * immutable afterwards. Absent for guests, who have no server identity.
   */
  friendCode?: string;
  /**
   * Drawn by the server alongside the friend code and stored with the account.
   * Also immutable: no route accepts a rarity, so it can never be re-rolled.
   */
  rarity?: RarityId;
  /**
   * Labels worn beside the name (owner, staff, …). Set by administrators on
   * the account server; presentation only — they grant nothing.
   */
  tags?: string[];
  /** Data URL of the avatar image. */
  avatar?: string;
  bio?: string;
  /**
   * Moderation authority as the account server records it: the first
   * registered account, anyone named in CRESCENT_ADMINS, or nobody.
   */
  role?: "admin" | "user";
  createdAt: number;
  guest?: boolean;
}

/* ==========================================================================
   Friends

   These mirror the account server's payloads exactly; nothing here is derived
   or cached as a source of truth on the client.
   ========================================================================== */

export interface FriendSummary {
  id: string;
  username: string;
  displayName: string;
  friendCode: string;
  avatar?: string;
  /** The friend's friend-code rarity, as drawn by the server. */
  rarity?: RarityId;
  /** Labels worn beside the friend's name (owner, staff, …). */
  tags?: string[];
  /** True when the account was seen within the last minute. */
  online: boolean;
  lastSeenAt: number;
  friendsSince?: number;
}

export interface IncomingFriendRequest {
  id: string;
  from: FriendSummary;
  createdAt: number;
}

export interface OutgoingFriendRequest {
  id: string;
  to: FriendSummary;
  status: "pending" | "accepted" | "declined";
  createdAt: number;
}

/** A message stored on the account server. */
export interface ServerMessage {
  id: string;
  authorId: string;
  authorName: string;
  body: string;
  sentAt: number;
}

/* ==========================================================================
   Messaging
   ========================================================================== */

export interface ChatMessage {
  id: string;
  channelId: string;
  authorId: string;
  authorName: string;
  body: string;
  sentAt: number;
  /** Locally delivered messages not yet acknowledged by the session. */
  pending?: boolean;
}

export interface DirectChannel {
  id: string;
  kind: "direct";
  peerId: string;
  peerName: string;
  peerCode: string;
}

export interface GroupChannel {
  id: string;
  kind: "group";
  name: string;
  memberIds: string[];
}

export interface ServerChannel {
  id: string;
  kind: "server";
  serverId: string;
  name: string;
}

export type Channel = DirectChannel | GroupChannel | ServerChannel;

export interface ChatServer {
  id: string;
  name: string;
  ownerId: string;
  memberIds: string[];
  channels: { id: string; name: string }[];
}



/* ==========================================================================
   Browser
   ========================================================================== */

export interface BrowserTab {
  id: string;
  title: string;
  url: string;
  favicon?: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  /** Incremented on reload to remount the frame. */
  nonce: number;
  error?: string;
  /**
   * Set when the tab was switched to direct mode: the page is loaded by this
   * window itself instead of through Scramjet. Used as a fallback when the
   * proxy is unavailable, so it stays inside the OS rather than opening the
   * user's own browser.
   */
  direct?: boolean;
}

/*
 * OS-level tab identity. A web application cannot rewrite the browser's own
 * chrome, so a preset controls exactly what the shell is allowed to control:
 * the document title and the favicon of the host tab.
 */
export interface TabIdentityPreset {
  id: string;
  name: string;
  /** Document title, e.g. "Course Materials — Week 6". */
  title: string;
  /** Local favicon asset served from this origin, e.g. `/cloak/study.svg`. */
  favicon: string;
  description: string;
  builtIn?: boolean;
}

/* ==========================================================================
   System
   ========================================================================== */

export interface SystemVersion {
  version: string;
  build: string;
  releaseDate: string;
  codename: string;
}

export interface ReleaseNote {
  version: string;
  date: string;
  added?: string[];
  changed?: string[];
  fixed?: string[];
  known?: string[];
}

export interface DeviceInfo {
  deviceType: "desktop" | "laptop";
  performanceMode: boolean;
}
