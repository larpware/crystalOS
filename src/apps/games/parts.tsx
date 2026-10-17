import { useEffect, useRef, useState } from "react";
import { Badge, Button, IconButton, Tooltip } from "@/components/ui";
import { Icon } from "@/icons/Icon";
import { useGamesStore } from "@/state/games";
import { formatRelative } from "@/utils/format";
import { categoryLabels, tilePalette, type CrystalOSGame } from "./catalogue";

/* ==========================================================================
   Shared Games parts

   Cover art, tiles, the detail panel and the player. Both the Games app and
   the Game Library use these, so the library never drifts from the store.
   ========================================================================== */

export function GameCover({ game, radius = 6 }: { game: CrystalOSGame; radius?: number }) {
  const [failed, setFailed] = useState(false);
  const palette = tilePalette(game.title);

  if (!game.cover || failed) {
    return (
      <div
        className="cr-game-cover cr-game-cover--generated"
        style={{
          borderRadius: radius,
          background: `linear-gradient(155deg, ${palette.from} 0%, ${palette.to} 100%)`,
        }}
        aria-hidden="true"
      >
        <span className="cr-game-cover__letter">{palette.letter}</span>
        <span className="cr-game-cover__title">{game.title}</span>
      </div>
    );
  }

  return (
    <div className="cr-game-cover" style={{ borderRadius: radius }} aria-hidden="true">
      <img src={game.cover} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />
    </div>
  );
}

export function GameCard({
  game,
  onPlay,
  onOpen,
  launched = false,
}: {
  game: CrystalOSGame;
  onPlay: () => void;
  onOpen: () => void;
  launched?: boolean;
}) {
  const favourite = useGamesStore((state) => state.favourites.includes(game.id));
  const toggleFavourite = useGamesStore((state) => state.toggleFavourite);

  return (
    <article className="cr-game-card" data-launched={launched}>
      {game.editorsChoice && <span className="cr-game-card__choice">Editor's Choice</span>}
      <button type="button" className="cr-game-card__hit" onClick={onOpen} aria-label={`${game.title} details`}>
        <GameCover game={game} />
        <span
          className="cr-game-card__favourite"
          role="button"
          tabIndex={0}
          aria-label={favourite ? `Unfavourite ${game.title}` : `Favourite ${game.title}`}
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
        <div className="cr-game-card__text">
          <span className="cr-game-card__title">{game.title}</span>
          <span className="cr-game-card__sub">{categoryLabels[game.category]}</span>
        </div>
        <Tooltip label={`Play ${game.title}`}>
          <Button size="sm" variant="primary" icon="play" onClick={onPlay}>
            Play
          </Button>
        </Tooltip>
      </div>
      {favourite && (
        <span className="cr-game-card__flag">
          <Icon name="star" size={11} />
        </span>
      )}
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
  const sessions = useGamesStore((state) => state.sessions.filter((entry) => entry.gameId === game.id));
  const lastSession = sessions[0];

  return (
    <div className="cr-game-detail">
      <div className="cr-game-detail__art">
        <GameCover game={game} radius={8} />
      </div>
      <div className="cr-game-detail__body">
        <header>
          <h2>{game.title}</h2>
          <p className="cr-row__desc">
            {categoryLabels[game.category]} · {game.host || "unknown host"}
          </p>
        </header>

        <div className="cr-game-detail__badges">
          <Badge>{game.collection}</Badge>
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
  game,
  onClose,
  onSession,
}: {
  game: CrystalOSGame;
  onClose: () => void;
  onSession: (seconds: number) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const startedAt = useRef(Date.now());
  const [nonce, setNonce] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    startedAt.current = Date.now();
    return () => {
      const seconds = Math.round((Date.now() - startedAt.current) / 1000);
      if (seconds >= 5) onSession(seconds);
    };
  }, [game.id, nonce, onSession]);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === hostRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = async () => {
    const host = hostRef.current;
    if (!host) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await host.requestFullscreen();
    } catch {
      setFullscreen(false);
    }
  };

  return (
    <div className="cr-game-player">
      <header className="cr-game-player__bar">
        <span className="cr-game-player__title">
          <Icon name="games" size={15} /> {game.title}
        </span>
        <span className="cr-game-player__host">{game.host}</span>
        <div className="cr-game-player__controls">
          <IconButton icon="refresh" label="Reload game" onClick={() => setNonce((value) => value + 1)} />
          <IconButton
            icon="external"
            label="Open on the publisher's site"
            onClick={() => window.open(game.url, "_blank", "noopener,noreferrer")}
          />
          <Tooltip label={fullscreen ? "Exit fullscreen" : "Fullscreen"}>
            <IconButton
              icon={fullscreen ? "collapse" : "expand"}
              label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
              onClick={() => void toggleFullscreen()}
            />
          </Tooltip>
          <Button size="sm" icon="close" onClick={onClose}>
            Close
          </Button>
        </div>
      </header>

      <div className="cr-game-player__stage" ref={hostRef}>
        <iframe
          key={nonce}
          className="cr-game-player__frame"
          title={game.title}
          src={game.url}
          allow="autoplay; fullscreen; gamepad; clipboard-write"
          sandbox="allow-forms allow-modals allow-orientation-lock allow-pointer-lock allow-popups allow-popups-to-escape-sandbox allow-presentation allow-same-origin allow-scripts"
          onError={() => setFailed(true)}
        />
        {failed && (
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
