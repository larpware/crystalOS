import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, IconButton, Row, Segmented, Switch, TextInput, Tooltip } from "@/components/ui";
import { Icon } from "@/icons/Icon";
import {
  gameLaunchModes,
  isDefaultGameProfile,
  normaliseGameProfile,
  useGamesStore,
} from "@/state/games";
import { formatRelative } from "@/utils/format";
import { useWindowStore } from "@/state/windows";
import { categoryLabels, type CrystalOSGame } from "./catalogue";
import { gameDisplayTitle } from "./launch";
import { BuiltinBreakout } from "./builtins/Breakout";
import { BuiltinSnake } from "./builtins/Snake";

/* ==========================================================================
   Shared Games parts

   Cards, the detail panel and the player. Both the Games app and the Game
   Library use these, so the library never drifts from the store.

   No cover art: the catalogue's cover URLs belong to hosts that serve them
   cross-origin, and the browser blocks most of them as opaque responses — the
   tiles spent their life on a broken image and a fallback letter. Until there
   is a real art API, a game is its name and its genre, which is also all a
   list of 1247 games needs to be scannable.
   ========================================================================== */

export function GameCard({
  game,
  onPlay,
  onOpen,
  launched = false,
  locked = false,
  onVerify,
}: {
  game: CrystalOSGame;
  onPlay: () => void;
  onOpen: () => void;
  launched?: boolean;
  locked?: boolean;
  onVerify?: () => void;
}) {
  const favourite = useGamesStore((state) => state.favourites.includes(game.id));
  const toggleFavourite = useGamesStore((state) => state.toggleFavourite);
  const profileTitle = useGamesStore((state) => state.profiles[game.id]?.title ?? "");
  const title = gameDisplayTitle(game, profileTitle);

  return (
    <article className="cr-game-card" data-launched={launched}>
      {game.editorsChoice && <span className="cr-game-card__choice">Editor's Choice</span>}
      <button type="button" className="cr-game-card__hit" onClick={onOpen} aria-label={`${title} details`}>
        <span className="cr-game-card__text">
          <span className="cr-game-card__title">{title}</span>
          <span className="cr-game-card__sub">{locked ? "Locked · verify ownership" : categoryLabels[game.category]}</span>
        </span>
        <span
          className="cr-game-card__favourite"
          role="button"
          tabIndex={0}
          aria-label={favourite ? `Unfavourite ${title}` : `Favourite ${title}`}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.stopPropagation();
              toggleFavourite(game.id);
            }
          }}
          onClick={(event) => {
            event.stopPropagation();
            toggleFavourite(game.id);
          }}
        >
          <Icon name="star" size={13} />
        </span>
      </button>
      <div className="cr-game-card__meta">
        <Tooltip label={`Play ${title}`}>
          <Button size="sm" variant={locked ? "ghost" : "primary"} icon={locked ? "lock" : "play"} onClick={locked ? onVerify : onPlay}>
            {locked ? "Verify ownership" : "Play"}
          </Button>
        </Tooltip>
      </div>
    </article>
  );
}

export function GameDetail({
  game,
  onClose,
  onPlay,
}: {
  game: CrystalOSGame;
  onClose: () => void;
  onPlay: () => void;
}) {
  const favourite = useGamesStore((state) => state.favourites.includes(game.id));
  const toggleFavourite = useGamesStore((state) => state.toggleFavourite);
  /* The store's array is read as-is and filtered in a memo. A selector that
     returns `state.sessions.filter(...)` hands React a brand-new array on every
     call, and React's external-store check reads it twice per commit — so it
     never settles, and the drawer dies with "Maximum update depth exceeded". */
  const allSessions = useGamesStore((state) => state.sessions);
  const sessions = useMemo(
    () => allSessions.filter((entry) => entry.gameId === game.id),
    [allSessions, game.id],
  );
  const lastSession = sessions[0];

  const storedProfile = useGamesStore((state) => state.profiles[game.id]);
  const setProfile = useGamesStore((state) => state.setProfile);
  const resetProfile = useGamesStore((state) => state.resetProfile);
  const profile = useMemo(() => normaliseGameProfile(storedProfile), [storedProfile]);
  const title = gameDisplayTitle(game, profile.title);
  const mode = gameLaunchModes.find((entry) => entry.value === profile.launchMode) ?? gameLaunchModes[0];

  /* Tags are typed as one comma-separated line. The field keeps its own draft
     while it is being edited and commits on blur or Enter, so a half-typed
     "co-op," is not rewritten out from under the caret on every keystroke. The
     ref lets the commit also run when the drawer closes or the selection moves
     to another game — otherwise anything typed but not blurred is dropped. */
  const [tagDraft, setTagDraft] = useState<string | null>(null);
  const pendingTags = useRef<string | null>(tagDraft);
  pendingTags.current = tagDraft;

  const commitTags = () => {
    if (tagDraft === null) return;
    setProfile(game.id, {
      tags: tagDraft.split(",").map((tag) => tag.trim()).filter(Boolean),
    });
    setTagDraft(null);
  };

  useEffect(() => {
    return () => {
      const pending = pendingTags.current;
      if (pending === null) return;
      useGamesStore.getState().setProfile(game.id, {
        tags: pending.split(",").map((tag) => tag.trim()).filter(Boolean),
      });
    };
  }, [game.id]);

  return (
    <div className="cr-game-detail">
      <div className="cr-game-detail__body">
        <header>
          <h2>{title}</h2>
          <p className="cr-row__desc">
            {title === game.title ? null : `${game.title} · `}
            {categoryLabels[game.category]} · {game.host || "unknown host"}
          </p>
        </header>

        <div className="cr-game-detail__badges">
          <Badge>{game.collection}</Badge>
          {profile.tags.map((tag) => (
            <Badge key={tag} tone="accent">
              {tag}
            </Badge>
          ))}
          {sessions.length > 0 && (
            <Badge tone="accent">
              {sessions.length} session{sessions.length === 1 ? "" : "s"}
            </Badge>
          )}
          {lastSession && <Badge>Last played {formatRelative(lastSession.at)}</Badge>}
        </div>

        <p className="cr-game-detail__url cr-code">{game.url}</p>

        <p className="cr-row__desc">
          This game is embedded from its publisher's own host and runs in a sandboxed frame.
          CrystalOS cannot read inside that frame, so no performance figure is shown.
        </p>

        <div className="cr-game-detail__actions">
          <Button variant="primary" icon="play" onClick={onPlay}>
            Play now
          </Button>
          <Button
            variant="ghost"
            icon="star"
            onClick={() => toggleFavourite(game.id)}
          >
            {favourite ? "Remove favourite" : "Add to favourites"}
          </Button>
          <Button variant="ghost" icon="close" onClick={onClose}>
            Close
          </Button>
        </div>

        <div className="cr-game-profile">
          <h3>Profile</h3>
          <p className="cr-row__desc">
            Kept in this browser profile and applied to this game wherever it is launched from.
          </p>

          <Row
            label="Display name"
            description="Shown in place of the catalogue title."
            stacked
          >
            <TextInput
              aria-label="Display name"
              placeholder={game.title}
              value={profile.title}
              onChange={(event) => setProfile(game.id, { title: event.target.value })}
            />
          </Row>

          <Row
            label="Note"
            description="Private to this profile; nothing reads it but you."
            stacked
          >
            <TextInput
              aria-label="Note"
              placeholder="Add a note"
              value={profile.notes}
              onChange={(event) => setProfile(game.id, { notes: event.target.value })}
            />
          </Row>

          <Row
            label="Tags"
            description="Comma separated. Up to eight, shown with the game in this panel."
            stacked
          >
            <TextInput
              aria-label="Tags"
              placeholder="co-op, short, arcade"
              value={tagDraft ?? profile.tags.join(", ")}
              onChange={(event) => setTagDraft(event.target.value)}
              onBlur={commitTags}
              onKeyDown={(event) => {
                if (event.key === "Enter") commitTags();
              }}
            />
          </Row>

          <Row
            label="Launch"
            description={mode.hint}
            control={
              <Segmented
                label="Launch mode"
                value={profile.launchMode}
                onChange={(value) => setProfile(game.id, { launchMode: value })}
                options={gameLaunchModes.map((entry) => ({ value: entry.value, label: entry.label }))}
              />
            }
          />

          <Row
            label="Fullscreen on launch"
            description="Asks for fullscreen as the frame opens, where the browser allows it without a fresh click."
            control={
              <Switch
                label="Fullscreen on launch"
                checked={profile.fullscreenOnLaunch}
                onChange={(checked) => setProfile(game.id, { fullscreenOnLaunch: checked })}
              />
            }
          />

          <Row
            label="Reset"
            description={
              isDefaultGameProfile(profile)
                ? "This game is already on the catalogue defaults."
                : "Returns the name, note, tags and launch behaviour to the defaults."
            }
            control={
              <Button
                size="sm"
                icon="refresh"
                disabled={isDefaultGameProfile(profile)}
                onClick={() => resetProfile(game.id)}
              >
                Reset profile
              </Button>
            }
          />
        </div>
      </div>
    </div>
  );
}

/**
 * The player. Games are embedded from their own host, so the only honest
 * controls are the frame's own, plus the ones CrystalOS actually performs:
 * reload, fullscreen, muting the frame and closing.
 */
export function GamePlayer({
  windowId,
  game,
  onClose,
  onSession,
}: {
  windowId: string;
  game: CrystalOSGame;
  onClose: () => void;
  onSession: (seconds: number) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const startedAt = useRef(Date.now());
  const [nonce, setNonce] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [failed, setFailed] = useState(false);

  const storedProfile = useGamesStore((state) => state.profiles[game.id]);
  const profile = useMemo(() => normaliseGameProfile(storedProfile), [storedProfile]);
  const title = gameDisplayTitle(game, profile.title);

  /* The desk button: a window can fill the work area without leaving the shell,
     so the panel and the dock stay reachable. The stage's own fullscreen is a
     different, stricter mode and is still here beside it. */
  const maximized = useWindowStore(
    (state) => state.windows.find((window) => window.id === windowId)?.state === "maximized",
  );
  const shellFull = useWindowStore(
    (state) => state.windows.find((window) => window.id === windowId)?.full === true,
  );
  const toggleMaximize = useWindowStore((state) => state.toggleMaximize);
  const toggleFullScreen = useWindowStore((state) => state.toggleFullScreen);

  /* The caller builds `onSession` inline, so it is a new function on every
     render of the library — which is why it must not be a dependency of the
     session timer. It was, and the result was a loop with a five-second fuse:
     every render re-ran this effect, once five seconds had passed each run
     reported a session, that updated the store, the store re-rendered the
     library, the library built a new callback, and the effect ran again. The
     shell never got another frame and the frame's document was torn down on
     every pass. A callback's identity says nothing about the session it
     reports, so the current one is held in a ref instead. */
  const reportSession = useRef(onSession);
  reportSession.current = onSession;

  useEffect(() => {
    startedAt.current = Date.now();
    return () => {
      const seconds = Math.round((Date.now() - startedAt.current) / 1000);
      if (seconds >= 5) reportSession.current(seconds);
    };
  }, [game.id, nonce]);

  /* The shell's own full screen: the window to the viewport with the panel and
     dock standing aside, exactly what the title bar's Full screen button does.
     It needs no permission, so it is also where a refused browser request
     lands. */
  const enterShellFull = () => {
    const current = useWindowStore.getState().windows.find((window) => window.id === windowId);
    if (current?.full) return;
    toggleFullScreen(windowId);
  };

  /* A profile asking for fullscreen gets one attempt as the frame mounts.
     Browsers only honour requestFullscreen while a gesture is still live, and
     Play was clicked a moment ago, so it usually lands — but a refusal is not a
     failure: it falls through to the shell's own full screen rather than
     leaving the setting with no visible effect. Re-attempted when the frame is
     reloaded, matching the reset on `nonce`. */
  useEffect(() => {
    if (!profile.fullscreenOnLaunch) return;
    if (!document.fullscreenEnabled) {
      enterShellFull();
      return;
    }
    hostRef.current
      ?.requestFullscreen?.()
      .catch(() => useWindowStore.getState().toggleFullScreen(windowId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.fullscreenOnLaunch, nonce, windowId]);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === hostRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  /* Two modes, and the button must never do nothing. The browser's own takes
     the stage to the top layer; the shell's takes the window to the viewport
     and hides the chrome. A browser that refuses the first — no live gesture, a
     hidden window, an embedding frame without the permission — used to leave
     this click with no effect at all, which read as "fullscreen does nothing
     and nothing hides". The refusal now falls through to the shell's mode, and
     exiting leaves whichever mode was actually entered. */
  const engaged = fullscreen || shellFull;

  const toggleFullscreen = async () => {
    const host = hostRef.current;
    if (!host) return;
    if (fullscreen) {
      try {
        await document.exitFullscreen();
      } catch {
        setFullscreen(false);
      }
      return;
    }
    if (shellFull) {
      toggleFullScreen(windowId);
      return;
    }
    if (document.fullscreenEnabled) {
      try {
        await host.requestFullscreen();
        return;
      } catch {
        /* refused — the shell's mode below is the same view without asking */
      }
    }
    enterShellFull();
  };

  return (
    <div className="cr-game-player">
      <header className="cr-game-player__bar">
        <span className="cr-game-player__title">
          <Icon name="games" size={15} /> {title}
        </span>
        <span className="cr-game-player__host">{game.host}</span>
        <div className="cr-game-player__controls">
          <IconButton icon="refresh" label="Reload game" onClick={() => setNonce((value) => value + 1)} />
          {!game.builtin && (
            <IconButton
              icon="external"
              label="Open on the publisher's site"
              onClick={() => window.open(game.url, "_blank", "noopener,noreferrer")}
            />
          )}
          <Tooltip label={maximized ? "Restore window" : "Fill the desk (keeps the dock and panel)"}>
            <IconButton
              icon={maximized ? "restore" : "maximize"}
              label={maximized ? "Restore window" : "Fill the desk"}
              onClick={() => toggleMaximize(windowId)}
            />
          </Tooltip>
          <Tooltip label={engaged ? "Exit fullscreen" : "Fullscreen"}>
            <IconButton
              icon={engaged ? "collapse" : "expand"}
              label={engaged ? "Exit fullscreen" : "Fullscreen"}
              onClick={() => void toggleFullscreen()}
            />
          </Tooltip>
          <Button size="sm" icon="close" onClick={onClose}>
            Close
          </Button>
        </div>
      </header>

      <div className="cr-game-player__stage" ref={hostRef}>
        {game.builtin ? (
          <div key={nonce} className="cr-game-player__builtin">
            {game.builtin === "snake" ? <BuiltinSnake /> : <BuiltinBreakout />}
          </div>
        ) : (
          <iframe
          key={nonce}
          className="cr-game-player__frame"
          title={title}
          src={game.url}
          allow="autoplay; fullscreen; gamepad; clipboard-write"
          sandbox="allow-forms allow-modals allow-orientation-lock allow-pointer-lock allow-popups allow-popups-to-escape-sandbox allow-presentation allow-same-origin allow-scripts"
          onError={() => setFailed(true)}
        />
        )}
        {failed && !game.builtin && (
          <div className="cr-game-player__error">
            <Icon name="warning" size={22} />
            <p>
              This game would not load in a frame. Many hosts block embedded play; opening it
              directly usually works.
            </p>
            <Button
              variant="primary"
              icon="external"
              onClick={() => window.open(game.url, "_blank", "noopener,noreferrer")}
            >
              Open on {game.host}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
