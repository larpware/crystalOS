import type { ReactNode } from "react";

/* ==========================================================================
   CrystalOS icon set

   Every icon is authored on the same 24x24 grid, drawn with a 1.6px round
   stroke and no fills. Optical padding is kept consistent (content lives
   inside a 3–21 unit box) so icons line up when mixed at any size.
   ========================================================================== */

export const iconNames = [
  // applications
  "browser",
  "files",
  "drive",
  "spotify",
  "audiomack",
  "discord",
  "qmovies",
  "terminal",
  "settings",
  "games",
  "music",
  "media",
  "store",
  "library",
  "updates",
  "trash",
  "messages",
  "wallpaper",
  "notes",
  "calculator",
  "calendar",
  "camera",
  "photos",
  "clock",
  // window + shell
  "close",
  "minimize",
  "maximize",
  "restore",
  "chevron-left",
  "chevron-right",
  "chevron-up",
  "chevron-down",
  "arrow-left",
  "arrow-right",
  "arrow-up",
  "arrow-down",
  "corner-up-left",
  "external",
  "drag",
  "grid",
  "list",
  "columns",
  // status
  "wifi",
  "wifi-off",
  "volume",
  "volume-mute",
  "brightness",
  "battery-full",
  "battery-low",
  "battery-charging",
  "power",
  "restart",
  "sleep",
  "lock",
  "bell",
  "bell-off",
  "shield",
  "gauge",
  "activity",
  "monitor",
  "laptop",
  "server",
  "database",
  "globe",
  // actions
  "search",
  "plus",
  "minus",
  "check",
  "copy",
  "cut",
  "paste",
  "pencil",
  "download",
  "upload",
  "refresh",
  "pin",
  "star",
  "heart",
  "eye",
  "eye-off",
  "more-vertical",
  "more-horizontal",
  "filter",
  "sliders",
  "layout",
  "layers",
  "palette",
  "keyboard",
  "code",
  "link",
  "print",
  "share",
  "play",
  "pause",
  "skip-back",
  "skip-forward",
  "shuffle",
  "repeat",
  "queue",
  "expand",
  "collapse",
  "zoom-in",
  "zoom-out",
  "crop",
  "maximize-all",
  // people
  "user",
  "users",
  "user-plus",
  "log-out",
  "phone",
  "phone-off",
  "mic",
  "mic-off",
  "video-cam",
  "hash",
  "send",
  "folder",
  "folder-plus",
  "file",
  "file-text",
  "image",
  "video",
  "archive",
  "info",
  "warning",
  "error",
  "success",
  "question",
  "sparkle",
] as const;

export type IconName = (typeof iconNames)[number];

export const icons: Record<IconName, ReactNode> = {
  /* ---- applications ---------------------------------------------------- */
  browser: (
    <>
      <circle cx="12" cy="12" r="8.2" />
      <path d="M3.9 9.4h16.2M3.9 14.6h16.2" />
      <path d="M12 3.8c2.1 2.3 3.2 5.1 3.2 8.2s-1.1 5.9-3.2 8.2c-2.1-2.3-3.2-5.1-3.2-8.2S9.9 6.1 12 3.8Z" />
    </>
  ),
  files: (
    <>
      <path d="M3.6 7.4a1.8 1.8 0 0 1 1.8-1.8h3.3l1.7 2.1h8a1.8 1.8 0 0 1 1.8 1.8v7.1a1.8 1.8 0 0 1-1.8 1.8H5.4a1.8 1.8 0 0 1-1.8-1.8Z" />
      <path d="M3.6 11.1h16.6" />
    </>
  ),
  terminal: (
    <>
      <rect x="3.2" y="4.6" width="17.6" height="14.8" rx="2.4" />
      <path d="m7.6 10 2.6 2.4-2.6 2.4M12.6 15.2h4" />
    </>
  ),
  settings: (
    <>
      <path d="M4 7.4h5.7M13.4 7.4H20M4 12h8.2M15.9 12H20M4 16.6h3.9M11.6 16.6H20" />
      <circle cx="11.2" cy="7.4" r="1.9" />
      <circle cx="13.7" cy="12" r="1.9" />
      <circle cx="9.4" cy="16.6" r="1.9" />
    </>
  ),
  games: (
    <>
      <path d="M8.2 7.6h7.6a5.4 5.4 0 0 1 5.3 4.4l.5 3.1a2.5 2.5 0 0 1-4.4 2.1l-1.1-1.4H8l-1.1 1.4a2.5 2.5 0 0 1-4.4-2.1l.5-3.1A5.4 5.4 0 0 1 8.2 7.6Z" />
      <path d="M7.4 11.2v2.6M6.1 12.5h2.6" />
      <circle cx="16.3" cy="11.9" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="18.4" cy="13.6" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
  music: (
    <>
      <path d="M9.4 17.2V6.6l9-1.7v10.3" />
      <circle cx="6.9" cy="17.4" r="2.6" />
      <circle cx="15.9" cy="15.5" r="2.6" />
    </>
  ),
  media: (
    <>
      <rect x="3.2" y="5.2" width="17.6" height="13.6" rx="2.4" />
      <path d="M10.2 9.6l4.6 2.8-4.6 2.8Z" />
    </>
  ),
  store: (
    <>
      <path d="M4.4 8.4h15.2l-1.1 10.1a1.9 1.9 0 0 1-1.9 1.7H7.4a1.9 1.9 0 0 1-1.9-1.7Z" />
      <path d="M8.7 8.4V6.9a3.3 3.3 0 0 1 6.6 0v1.5" />
    </>
  ),
  library: (
    <>
      <rect x="3.4" y="3.6" width="7.4" height="7.4" rx="1.6" />
      <rect x="13.2" y="3.6" width="7.4" height="7.4" rx="1.6" />
      <rect x="3.4" y="13.2" width="7.4" height="7.4" rx="1.6" />
      <rect x="13.2" y="13.2" width="7.4" height="7.4" rx="1.6" />
    </>
  ),
  updates: (
    <>
      <path d="M20.2 12a8.2 8.2 0 1 1-2.4-5.8" />
      <path d="M20.4 4.6v3.9h-3.9" />
      <path d="M12 8.4V12l2.4 1.6" />
    </>
  ),
  trash: (
    <>
      <path d="M4.6 7.2h14.8" />
      <path d="M9.2 7.2V5.6a1.4 1.4 0 0 1 1.4-1.4h2.8a1.4 1.4 0 0 1 1.4 1.4v1.6" />
      <path d="M6.4 7.2l.9 11a1.7 1.7 0 0 0 1.7 1.6h6a1.7 1.7 0 0 0 1.7-1.6l.9-11" />
      <path d="M10.4 11v5.4M13.6 11v5.4" />
    </>
  ),
  messages: (
    <>
      <path d="M3.8 9.4a2.6 2.6 0 0 1 2.6-2.6h6.4a2.6 2.6 0 0 1 2.6 2.6v2.9a2.6 2.6 0 0 1-2.6 2.6H7.9l-3.3 2.6v-2.6a.8.8 0 0 1-.8-.8Z" />
      <path d="M18.1 8.6h.3a2.4 2.4 0 0 1 2.4 2.4v2.7a2.4 2.4 0 0 1-2.4 2.4h-.9v2.3l-2.8-2.3h-2.2" />
    </>
  ),
  wallpaper: (
    <>
      <rect x="3.4" y="4.6" width="17.2" height="14.8" rx="2.2" />
      <circle cx="8.6" cy="9.6" r="1.6" />
      <path d="m4.2 16.6 4.3-4.2a1.7 1.7 0 0 1 2.4 0l3.1 3.1 2-1.9a1.7 1.7 0 0 1 2.4 0l1.9 1.9" />
    </>
  ),
  notes: (
    <>
      <path d="M6.4 3.8h11.2a1.8 1.8 0 0 1 1.8 1.8v12.8a1.8 1.8 0 0 1-1.8 1.8H6.4a1.8 1.8 0 0 1-1.8-1.8V5.6a1.8 1.8 0 0 1 1.8-1.8Z" />
      <path d="M8.4 8.4h7.2M8.4 12h7.2M8.4 15.4h4.4" />
    </>
  ),
  calculator: (
    <>
      <rect x="5.2" y="3.4" width="13.6" height="17.2" rx="2.2" />
      <path d="M8.6 7.8h6.8" />
      <path d="M8.8 12h.9M11.6 12h.9M14.4 12h.9M8.8 15.6h.9M11.6 15.6h.9M14.4 15.6h.9" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.6" y="5" width="16.8" height="15" rx="2.2" />
      <path d="M3.6 10h16.8M8.4 3.4v3.2M15.6 3.4v3.2" />
    </>
  ),
  camera: (
    <>
      <path d="M3.4 9.4a2.2 2.2 0 0 1 2.2-2.2h1.7l1.3-2h6.8l1.3 2h1.7a2.2 2.2 0 0 1 2.2 2.2v7.2a2.2 2.2 0 0 1-2.2 2.2H5.6a2.2 2.2 0 0 1-2.2-2.2Z" />
      <circle cx="12" cy="12.9" r="3.3" />
    </>
  ),
  photos: (
    <>
      <rect x="3.4" y="5.4" width="17.2" height="13.2" rx="2.2" />
      <circle cx="8.8" cy="10" r="1.5" />
      <path d="m4.4 16.2 3.9-3.7a1.6 1.6 0 0 1 2.2 0l2.8 2.7 1.9-1.7a1.6 1.6 0 0 1 2.2 0l2.4 2.3" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 7.2V12l3.2 2.1" />
    </>
  ),

  /* ---- window + shell -------------------------------------------------- */
  close: <path d="m6.8 6.8 10.4 10.4M17.2 6.8 6.8 17.2" />,
  minimize: <path d="M5.6 12h12.8" />,
  maximize: <rect x="5.4" y="5.4" width="13.2" height="13.2" rx="1.8" />,
  restore: (
    <>
      <rect x="4.2" y="8.2" width="11.6" height="11.6" rx="1.8" />
      <path d="M8.4 5.6a1.8 1.8 0 0 1 1.8-1.4h8a1.8 1.8 0 0 1 1.8 1.8v8a1.8 1.8 0 0 1-1.4 1.8" />
    </>
  ),
  "chevron-left": <path d="m14.4 6.4-5.6 5.6 5.6 5.6" />,
  "chevron-right": <path d="m9.6 6.4 5.6 5.6-5.6 5.6" />,
  "chevron-up": <path d="m6.4 14.4 5.6-5.6 5.6 5.6" />,
  "chevron-down": <path d="m6.4 9.6 5.6 5.6 5.6-5.6" />,
  "arrow-left": <path d="M19.2 12H4.8m0 0 5.6-5.6M4.8 12l5.6 5.6" />,
  "arrow-right": <path d="M4.8 12h14.4m0 0-5.6-5.6M19.2 12l-5.6 5.6" />,
  "arrow-up": <path d="M12 19.2V4.8m0 0-5.6 5.6M12 4.8l5.6 5.6" />,
  "arrow-down": <path d="M12 4.8v14.4m0 0 5.6-5.6M12 19.2l-5.6-5.6" />,
  "corner-up-left": <path d="M8.6 8.4H18a2 2 0 0 1 2 2v2M8.6 8.4l3.8-3.8M8.6 8.4l3.8 3.8M6 20h4.4" />,
  external: (
    <>
      <path d="M13.6 4.6h5.8v5.8" />
      <path d="M19.4 4.6 11 13" />
      <path d="M17.2 14.4v3.8a2 2 0 0 1-2 2H6.4a2 2 0 0 1-2-2V9.4a2 2 0 0 1 2-2h3.8" />
    </>
  ),
  drag: (
    <>
      <circle cx="9.2" cy="6.4" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="14.8" cy="6.4" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="9.2" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="14.8" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="9.2" cy="17.6" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="14.8" cy="17.6" r="1.2" fill="currentColor" stroke="none" />
    </>
  ),
  grid: (
    <>
      <rect x="3.8" y="3.8" width="6.6" height="6.6" rx="1.4" />
      <rect x="13.6" y="3.8" width="6.6" height="6.6" rx="1.4" />
      <rect x="3.8" y="13.6" width="6.6" height="6.6" rx="1.4" />
      <rect x="13.6" y="13.6" width="6.6" height="6.6" rx="1.4" />
    </>
  ),
  list: <path d="M8.4 6.6h11M8.4 12h11M8.4 17.4h11M4.6 6.6h.01M4.6 12h.01M4.6 17.4h.01" />,
  columns: (
    <>
      <rect x="3.6" y="4.6" width="16.8" height="14.8" rx="2.2" />
      <path d="M9.8 4.6v14.8" />
    </>
  ),

  /* ---- status ---------------------------------------------------------- */
  wifi: (
    <>
      <path d="M3.4 8.6a13 13 0 0 1 17.2 0" />
      <path d="M6.4 12.1a8.6 8.6 0 0 1 11.2 0" />
      <path d="M9.4 15.6a4.2 4.2 0 0 1 5.2 0" />
      <circle cx="12" cy="19" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  "wifi-off": (
    <>
      <path d="M3.4 8.6a13 13 0 0 1 5-2.9M15.4 6.2a13 13 0 0 1 5.2 2.4" />
      <path d="M6.4 12.1a8.6 8.6 0 0 1 3.4-1.7M15.9 11.2a8.6 8.6 0 0 1 1.7.9" />
      <path d="M9.4 15.6a4.2 4.2 0 0 1 4.5-.4" />
      <path d="m4 4 16 16" />
    </>
  ),
  volume: (
    <>
      <path d="M4.6 9.4h3l4-3.2v11.6l-4-3.2h-3a1 1 0 0 1-1-1v-3.2a1 1 0 0 1 1-1Z" />
      <path d="M15 9.4a4 4 0 0 1 0 5.2M17.6 7.2a7.4 7.4 0 0 1 0 9.6" />
    </>
  ),
  "volume-mute": (
    <>
      <path d="M4.6 9.4h3l4-3.2v11.6l-4-3.2h-3a1 1 0 0 1-1-1v-3.2a1 1 0 0 1 1-1Z" />
      <path d="m15.4 10 4 4M19.4 10l-4 4" />
    </>
  ),
  brightness: (
    <>
      <circle cx="12" cy="12" r="3.8" />
      <path d="M12 3.4v2M12 18.6v2M3.4 12h2M18.6 12h2M6 6l1.4 1.4M16.6 16.6 18 18M18 6l-1.4 1.4M7.4 16.6 6 18" />
    </>
  ),
  "battery-full": (
    <>
      <rect x="3.2" y="8" width="15.4" height="8" rx="2.2" />
      <path d="M21 10.8v2.4" />
      <path d="M5.6 10.4h6v3.2h-6z" fill="currentColor" stroke="none" />
    </>
  ),
  "battery-low": (
    <>
      <rect x="3.2" y="8" width="15.4" height="8" rx="2.2" />
      <path d="M21 10.8v2.4" />
      <path d="M5.6 10.4h2.2v3.2H5.6z" fill="currentColor" stroke="none" />
    </>
  ),
  "battery-charging": (
    <>
      <rect x="3.2" y="8" width="15.4" height="8" rx="2.2" />
      <path d="M21 10.8v2.4" />
      <path d="m11.6 8.8-2 3.4h2.6l-1.4 3 3.4-4h-2.6l1.2-2.4Z" fill="currentColor" stroke="none" />
    </>
  ),
  power: <path d="M12 3.8v7.4M6.9 6.4a7.4 7.4 0 1 0 10.2 0" />,
  restart: (
    <>
      <path d="M20.4 12a8.4 8.4 0 1 1-2.5-6" />
      <path d="M20.6 4.4v4.2h-4.2" />
    </>
  ),
  sleep: <path d="M20.2 14.4A8.6 8.6 0 0 1 9.6 3.8a8.6 8.6 0 1 0 10.6 10.6Z" />,
  lock: (
    <>
      <rect x="4.8" y="10.4" width="14.4" height="9.4" rx="2.2" />
      <path d="M8.4 10.4V7.8a3.6 3.6 0 0 1 7.2 0v2.6" />
    </>
  ),
  bell: (
    <>
      <path d="M6.6 16.4V11a5.4 5.4 0 0 1 10.8 0v5.4l1.4 2H5.2Z" />
      <path d="M10.2 18.6a1.9 1.9 0 0 0 3.6 0" />
    </>
  ),
  "bell-off": (
    <>
      <path d="M6.6 16.4V11a5.4 5.4 0 0 1 8-4.7M17.4 10.4v6l1.4 2H5.2l1.4-2" />
      <path d="M10.2 18.6a1.9 1.9 0 0 0 3.6 0M4 4l16 16" />
    </>
  ),
  shield: <path d="M12 3.6 5.4 6.2v5.6c0 4.3 2.7 7.4 6.6 8.6 3.9-1.2 6.6-4.3 6.6-8.6V6.2Z" />,
  gauge: (
    <>
      <path d="M4.2 17.2a8.6 8.6 0 1 1 15.6 0" />
      <path d="m12 12.6 3.4-2.8" />
      <circle cx="12" cy="13.4" r="1.2" fill="currentColor" stroke="none" />
    </>
  ),
  activity: <path d="M3.4 12.6h3.4l2.4-6.4 3.6 12 2.6-7.2 1.6 3.2h3.6" />,
  monitor: (
    <>
      <rect x="3.2" y="4.6" width="17.6" height="11.8" rx="2" />
      <path d="M8.4 20h7.2M12 16.4V20" />
    </>
  ),
  laptop: (
    <>
      <rect x="4.6" y="5.4" width="14.8" height="10" rx="1.8" />
      <path d="M3 18.6h18" />
    </>
  ),
  server: (
    <>
      <rect x="3.6" y="4.2" width="16.8" height="6.4" rx="1.8" />
      <rect x="3.6" y="13.4" width="16.8" height="6.4" rx="1.8" />
      <path d="M7 7.4h.01M7 16.6h.01" />
    </>
  ),
  database: (
    <>
      <ellipse cx="12" cy="6.4" rx="7.4" ry="2.8" />
      <path d="M4.6 6.4v11.2c0 1.6 3.3 2.8 7.4 2.8s7.4-1.2 7.4-2.8V6.4" />
      <path d="M4.6 12c0 1.6 3.3 2.8 7.4 2.8s7.4-1.2 7.4-2.8" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="8.2" />
      <path d="M4 12h16M12 3.8c2.2 2.4 3.3 5.2 3.3 8.2s-1.1 5.8-3.3 8.2c-2.2-2.4-3.3-5.2-3.3-8.2S9.8 6.2 12 3.8Z" />
    </>
  ),

  /* ---- actions --------------------------------------------------------- */
  search: (
    <>
      <circle cx="10.8" cy="10.8" r="6.2" />
      <path d="m15.4 15.4 4.2 4.2" />
    </>
  ),
  plus: <path d="M12 5.4v13.2M5.4 12h13.2" />,
  minus: <path d="M5.4 12h13.2" />,
  check: <path d="m5.4 12.6 4.4 4.4 8.8-9.6" />,
  copy: (
    <>
      <rect x="8.6" y="8.6" width="11.8" height="11.8" rx="2" />
      <path d="M15.4 5.6a2 2 0 0 0-2-2H5.6a2 2 0 0 0-2 2v7.8a2 2 0 0 0 2 2" />
    </>
  ),
  cut: (
    <>
      <circle cx="6.8" cy="17.6" r="2.6" />
      <circle cx="17.2" cy="17.6" r="2.6" />
      <path d="M8.6 15.8 16.4 4M15.4 15.8 7.6 4" />
    </>
  ),
  paste: (
    <>
      <path d="M9 5.4H7.4a2 2 0 0 0-2 2v10.2a2 2 0 0 0 2 2h9.2a2 2 0 0 0 2-2V7.4a2 2 0 0 0-2-2H15" />
      <rect x="9" y="3.4" width="6" height="3.6" rx="1.2" />
    </>
  ),
  pencil: (
    <>
      <path d="M16.4 4.6l3 3L8.2 18.8l-3.9 1 1-3.9Z" />
      <path d="m14.4 6.6 3 3" />
    </>
  ),
  download: <path d="M12 4.4v10.2m0 0 4-4m-4 4-4-4M4.6 17.6v1.4a1 1 0 0 0 1 1h12.8a1 1 0 0 0 1-1v-1.4" />,
  upload: <path d="M12 15.2V5m0 0 4 4m-4-4-4 4M4.6 17.6v1.4a1 1 0 0 0 1 1h12.8a1 1 0 0 0 1-1v-1.4" />,
  refresh: (
    <>
      <path d="M20.2 12a8.2 8.2 0 1 1-2.4-5.8" />
      <path d="M20.4 4.6v3.9h-3.9" />
    </>
  ),
  pin: <path d="M14.6 3.6 20.4 9.4l-2.6 1-2.3 4.9-1.7-1.7-4.6 4.6-1.3-1.3 4.6-4.6-1.7-1.7 4.9-2.3ZM6.4 17.6l-2.8 2.8" />,
  star: <path d="m12 4 2.5 5.1 5.6.8-4 3.9 1 5.6-5.1-2.7-5.1 2.7 1-5.6-4-3.9 5.6-.8Z" />,
  heart: <path d="M12 19.6s-7.4-4.4-7.4-9.4a4 4 0 0 1 7.4-2.4 4 4 0 0 1 7.4 2.4c0 5-7.4 9.4-7.4 9.4Z" />,
  eye: (
    <>
      <path d="M2.6 12S6 6.4 12 6.4 21.4 12 21.4 12 18 17.6 12 17.6 2.6 12 2.6 12Z" />
      <circle cx="12" cy="12" r="2.8" />
    </>
  ),
  "eye-off": (
    <>
      <path d="M9.6 6.8A9.4 9.4 0 0 1 12 6.4c6 0 9.4 5.6 9.4 5.6a16 16 0 0 1-2.6 3.3M6.4 8.6A16 16 0 0 0 2.6 12S6 17.6 12 17.6a9 9 0 0 0 3.4-.6" />
      <path d="m4 4 16 16M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </>
  ),
  "more-vertical": (
    <>
      <circle cx="12" cy="5.6" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="12" cy="18.4" r="1.3" fill="currentColor" stroke="none" />
    </>
  ),
  "more-horizontal": (
    <>
      <circle cx="5.6" cy="12" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="18.4" cy="12" r="1.3" fill="currentColor" stroke="none" />
    </>
  ),
  filter: <path d="M4.4 5.6h15.2l-5.9 6.6v5.6l-3.4 1.6v-7.2Z" />,
  sliders: (
    <>
      <path d="M5.4 6.6v10.8M12 6.6v10.8M18.6 6.6v10.8" />
      <rect x="3.6" y="13.4" width="3.6" height="3.6" rx="1.4" />
      <rect x="10.2" y="7.4" width="3.6" height="3.6" rx="1.4" />
      <rect x="16.8" y="12" width="3.6" height="3.6" rx="1.4" />
    </>
  ),
  layout: (
    <>
      <rect x="3.6" y="4.6" width="16.8" height="14.8" rx="2.2" />
      <path d="M3.6 9.4h16.8M10.2 9.4v10" />
    </>
  ),
  layers: (
    <>
      <path d="m12 3.8 8.2 4.2-8.2 4.2-8.2-4.2Z" />
      <path d="m4.6 12.6 7.4 3.8 7.4-3.8M4.6 16.6l7.4 3.8 7.4-3.8" />
    </>
  ),
  palette: (
    <>
      <path d="M12 3.6a8.4 8.4 0 0 0 0 16.8 2.2 2.2 0 0 0 1.7-3.6 2.2 2.2 0 0 1 1.7-3.6h2.2a2.6 2.6 0 0 0 2.6-2.6 8.2 8.2 0 0 0-8.2-7Z" />
      <circle cx="8.4" cy="10" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="7.6" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="15.6" cy="10" r="1.1" fill="currentColor" stroke="none" />
    </>
  ),
  keyboard: (
    <>
      <rect x="2.8" y="6.6" width="18.4" height="10.8" rx="2" />
      <path d="M7 10h.01M10 10h.01M13 10h.01M16 10h.01M8 13.8h8" />
    </>
  ),
  code: <path d="m8.6 8.6-3.8 3.4 3.8 3.4M15.4 8.6l3.8 3.4-3.8 3.4M13.4 5.6l-2.8 12.8" />,
  link: (
    <>
      <path d="M10.4 13.6a3.4 3.4 0 0 0 4.8 0l2.6-2.6a3.4 3.4 0 0 0-4.8-4.8l-1.2 1.2" />
      <path d="M13.6 10.4a3.4 3.4 0 0 0-4.8 0l-2.6 2.6a3.4 3.4 0 0 0 4.8 4.8l1.2-1.2" />
    </>
  ),
  print: (
    <>
      <path d="M7.4 8.4V4.6h9.2v3.8" />
      <rect x="3.6" y="8.4" width="16.8" height="7.6" rx="1.8" />
      <rect x="7.4" y="14.4" width="9.2" height="5" rx="1" />
    </>
  ),
  share: (
    <>
      <circle cx="17.4" cy="6.6" r="2.6" />
      <circle cx="6.6" cy="12" r="2.6" />
      <circle cx="17.4" cy="17.4" r="2.6" />
      <path d="m9 10.8 6-2.8M9 13.2l6 2.8" />
    </>
  ),
  play: <path d="M8.4 5.6 18 12l-9.6 6.4Z" />,
  pause: <path d="M9.2 5.6v12.8M14.8 5.6v12.8" />,
  "skip-back": (
    <>
      <path d="M18.4 5.8v12.4L9.6 12Z" />
      <path d="M5.6 5.6v12.8" />
    </>
  ),
  "skip-forward": (
    <>
      <path d="M5.6 5.8v12.4L14.4 12Z" />
      <path d="M18.4 5.6v12.8" />
    </>
  ),
  shuffle: <path d="M4.4 7.4h3.4l8 9.2h3.6M16.8 5.6l2.8 1.8-2.8 1.8M4.4 16.6h3.4l2-2.3M13.6 9.7l2.2-2.3h3.6M16.8 14.9l2.8 1.7-2.8 1.7" />,
  repeat: <path d="M6.4 8.6h11.2l-2.4-2.4M17.6 15.4H6.4l2.4 2.4" />,
  queue: <path d="M4.4 6.6h11M4.4 12h11M4.4 17.4h6M18.4 12v8M18.4 12l3.2-1.4v3.4" />,
  expand: <path d="M9.4 4.6H4.6v4.8M14.6 4.6h4.8v4.8M19.4 14.6v4.8h-4.8M4.6 14.6v4.8h4.8" />,
  collapse: <path d="M4.6 9.4h4.8V4.6M19.4 9.4h-4.8V4.6M14.6 19.4v-4.8h4.8M9.4 19.4v-4.8H4.6" />,
  "zoom-in": (
    <>
      <circle cx="10.8" cy="10.8" r="6.2" />
      <path d="m15.4 15.4 4.2 4.2M8.4 10.8h4.8M10.8 8.4v4.8" />
    </>
  ),
  "zoom-out": (
    <>
      <circle cx="10.8" cy="10.8" r="6.2" />
      <path d="m15.4 15.4 4.2 4.2M8.4 10.8h4.8" />
    </>
  ),
  crop: <path d="M6.6 3.6v13.8h13.8M3.6 6.6h13.8v13.8" />,
  "maximize-all": (
    <>
      <rect x="4.2" y="4.2" width="6.4" height="6.4" rx="1.4" />
      <rect x="13.4" y="4.2" width="6.4" height="6.4" rx="1.4" />
      <rect x="4.2" y="13.4" width="6.4" height="6.4" rx="1.4" />
      <rect x="13.4" y="13.4" width="6.4" height="6.4" rx="1.4" />
    </>
  ),

  /* ---- people ---------------------------------------------------------- */
  user: (
    <>
      <circle cx="12" cy="8.4" r="3.6" />
      <path d="M4.8 20a7.2 7.2 0 0 1 14.4 0" />
    </>
  ),
  users: (
    <>
      <circle cx="9.6" cy="8.4" r="3.2" />
      <path d="M3.4 19.2a6.2 6.2 0 0 1 12.4 0" />
      <path d="M16 5.6a3.2 3.2 0 0 1 0 6.2M17.4 14.6a6.2 6.2 0 0 1 3.2 4.6" />
    </>
  ),
  "user-plus": (
    <>
      <circle cx="10" cy="8.4" r="3.6" />
      <path d="M3.6 19.8a6.4 6.4 0 0 1 12.8 0" />
      <path d="M18.4 7.4v5.2M15.8 10h5.2" />
    </>
  ),
  "log-out": <path d="M9.4 4.6H6.4a2 2 0 0 0-2 2v10.8a2 2 0 0 0 2 2h3M15.6 8.4l3.6 3.6-3.6 3.6M19 12H9.4" />,
  phone: <path d="M7.6 3.6h8.8a1.8 1.8 0 0 1 1.8 1.8v13.2a1.8 1.8 0 0 1-1.8 1.8H7.6a1.8 1.8 0 0 1-1.8-1.8V5.4a1.8 1.8 0 0 1 1.8-1.8Z" />,
  "phone-off": (
    <>
      <path d="M7.6 3.6h8.8a1.8 1.8 0 0 1 1.8 1.8v3.2M18.2 14.6v4a1.8 1.8 0 0 1-1.8 1.8H7.6a1.8 1.8 0 0 1-1.8-1.8V5.4a1.8 1.8 0 0 1 1.1-1.7" />
      <path d="m4 4 16 16" />
    </>
  ),
  mic: (
    <>
      <rect x="9.4" y="3.4" width="5.2" height="10" rx="2.6" />
      <path d="M5.8 11.4a6.2 6.2 0 0 0 12.4 0M12 17.6v3" />
    </>
  ),
  "mic-off": (
    <>
      <path d="M9.4 5.6a2.6 2.6 0 0 1 5.2 0v5.6M9.4 10.4v3a2.6 2.6 0 0 0 4.4 1.9" />
      <path d="M5.8 11.4a6.2 6.2 0 0 0 9.6 5.3M12 17.6v3M4 4l16 16" />
    </>
  ),
  "video-cam": (
    <>
      <rect x="3.2" y="6.4" width="12.8" height="11.2" rx="2.2" />
      <path d="m16 11.4 4.8-2.8v6.8L16 12.6Z" />
    </>
  ),
  hash: <path d="M9.6 4.4 7.6 19.6M16.4 4.4l-2 15.2M4.6 9h15M4 15h15" />,
  send: <path d="M20.4 3.6 3.4 10.4l6.6 2.4 2.4 6.6Z" />,
  folder: <path d="M3.6 7.4a1.8 1.8 0 0 1 1.8-1.8h3.3l1.7 2.1h8a1.8 1.8 0 0 1 1.8 1.8v7.1a1.8 1.8 0 0 1-1.8 1.8H5.4a1.8 1.8 0 0 1-1.8-1.8Z" />,
  "folder-plus": (
    <>
      <path d="M3.6 7.4a1.8 1.8 0 0 1 1.8-1.8h3.3l1.7 2.1h8a1.8 1.8 0 0 1 1.8 1.8v7.1a1.8 1.8 0 0 1-1.8 1.8H5.4a1.8 1.8 0 0 1-1.8-1.8Z" />
      <path d="M12 10.6v5.2M9.4 13.2h5.2" />
    </>
  ),
  file: (
    <>
      <path d="M13.4 3.6H7.4a2 2 0 0 0-2 2v12.8a2 2 0 0 0 2 2h9.2a2 2 0 0 0 2-2V8.8Z" />
      <path d="M13.4 3.6v5.2h5.2" />
    </>
  ),
  "file-text": (
    <>
      <path d="M13.4 3.6H7.4a2 2 0 0 0-2 2v12.8a2 2 0 0 0 2 2h9.2a2 2 0 0 0 2-2V8.8Z" />
      <path d="M13.4 3.6v5.2h5.2M8.6 13h6.8M8.6 16.4h4.4" />
    </>
  ),
  image: (
    <>
      <rect x="3.4" y="4.6" width="17.2" height="14.8" rx="2.2" />
      <circle cx="8.8" cy="9.6" r="1.6" />
      <path d="m4.4 16.6 4.3-4.2a1.6 1.6 0 0 1 2.3 0l3 2.9 1.9-1.8a1.6 1.6 0 0 1 2.3 0l1.8 1.7" />
    </>
  ),
  video: (
    <>
      <rect x="3.4" y="5.6" width="17.2" height="12.8" rx="2.2" />
      <path d="M4.2 9.4h15.6M4.2 14.6h15.6M7.6 5.6v12.8M16.4 5.6v12.8" />
    </>
  ),
  archive: (
    <>
      <rect x="3.6" y="4.6" width="16.8" height="5.2" rx="1.6" />
      <path d="M5.2 9.8v8a1.8 1.8 0 0 0 1.8 1.8h10a1.8 1.8 0 0 0 1.8-1.8v-8M10.4 13.4h3.2" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 11v5.4M12 8.2h.01" />
    </>
  ),
  warning: <path d="M12 4.2 20.4 19H3.6ZM12 10v3.8M12 16.4h.01" />,
  error: (
    <>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M9.2 9.2l5.6 5.6M14.8 9.2l-5.6 5.6" />
    </>
  ),
  success: (
    <>
      <circle cx="12" cy="12" r="8.4" />
      <path d="m8.4 12.4 2.6 2.6 4.6-5.4" />
    </>
  ),
  question: (
    <>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M9.8 9.6a2.3 2.3 0 1 1 3.4 2.1c-.8.5-1.2 1-1.2 1.9M12 16.6h.01" />
    </>
  ),
  sparkle: <path d="M12 3.8l1.9 5.1 5.1 1.9-5.1 1.9L12 17.8l-1.9-5.1L5 10.8l5.1-1.9ZM18.4 15.6l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8Z" />,
  drive: (
    <>
      <path d="M7.7 18.6h9.4a3.7 3.7 0 0 0 .5-7.36 5.3 5.3 0 0 0-10.2-1.22A4 4 0 0 0 7.7 18.6Z" />
      <path d="M12 15.6V9.7M9.7 12l2.3-2.3 2.3 2.3" />
    </>
  ),
  spotify: (
    <>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M7.5 9.7c3.1-1 6.6-.5 9.2 1.2M8.2 12.7c2.5-.8 5.3-.4 7.4 1M9 15.5c1.9-.6 3.9-.3 5.5.8" />
    </>
  ),
  audiomack: (
    <>
      <path d="M5.6 14.4V9.6M9.6 17.2V6.8M13.6 15.6V8.4M17.6 13.4v-2.8" />
      <path d="M3.6 19.4h16.8" opacity=".5" />
    </>
  ),
  discord: (
    <>
      <path d="M12 3.6 5 10.5 8 13l3-1.5L15 9l3 2.5-3 2.1-7-6.9Z" />
    </>
  ),
  /* Film strip: two rails of perforations around a frame. */
  qmovies: (
    <>
      <rect x="3.4" y="5.4" width="17.2" height="13.2" rx="2.2" />
      <path d="M7.6 5.4v13.2M16.4 5.4v13.2" />
      <path d="M3.4 9.2h4.2M3.4 14.8h4.2M16.4 9.2h4.2M16.4 14.8h4.2" />
      <path d="m11.2 10.6 3.4 1.9-3.4 1.9Z" />
    </>
  ),
};
