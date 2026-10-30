import { useEffect, useMemo, useState } from "react";
import { Badge, Button, EmptyState, Segmented, Switch, TextInput } from "@/components/ui";
import { Icon } from "@/icons/Icon";
import { useGamesStore } from "@/state/games";
import { openApp } from "@/services/os";
import { useWindowStore } from "@/state/windows";
import { useAuthStore } from "@/state/auth";
import { loadVerificationSnapshot } from "@/services/verification";
import type { AppProps } from "@/types";
import { formatRelative } from "@/utils/format";
import {
  categoryLabels,
  collections,
  featuredGames,
  gameById,
  games,
  type CrystalOSGame,
} from "./catalogue";
import { GameCard, GamePlayer } from "./parts";
import { authorizeGameLaunch, gameDisplayTitle, launchGame, launchGameInWindow } from "./launch";

/* ==========================================================================
   Game Library

   A collection-first view over the same catalogue. "Installed" means the game
   is part of the bundled catalogue and can be launched right now; there is no
   download to fake, so nothing here shows invented progress.
   ========================================================================== */

type Sort = "recent" | "name" | "playtime";
type Filter = "all" | "favourites" | "played" | "never";

export function GameLibrary({ windowId, args }: AppProps) {
  /* A window launched with `playGameId` is a player window, not a library: it
     opens straight onto that game and closing the player closes the window. */
  const launchGameId = typeof args?.playGameId === "string" ? args.playGameId : null;
  const isPlayerWindow = Boolean(launchGameId);

  /* Home is the landing view: the featured picks, what you were playing, your
     favourites and the collections. Anything that filters, searches or sorts
     drops into the browse view, which is the full catalogue with its detail
     panel — so the home stays a starting point, not a second copy of it. */
  const [view, setView] = useState<"home" | "browse">("home");
  const [collection, setCollection] = useState<string>("all");
  const [sort, setSort] = useState<Sort>("recent");
  const [filter, setFilter] = useState<Filter>("all");
  const [layout, setLayout] = useState<"grid" | "list">("grid");
  const [query, setQuery] = useState("");
  const [playing, setPlaying] = useState<CrystalOSGame | null>(() =>
    launchGameId ? (gameById.get(launchGameId) ?? null) : null,
  );
  const [focusedId, setFocusedId] = useState<string>(featuredGames[0]?.id ?? games[0].id);

  const favourites = useGamesStore((state) => state.favourites);
  const recents = useGamesStore((state) => state.recents);
  const sessions = useGamesStore((state) => state.sessions);
  const recordSession = useGamesStore((state) => state.recordSession);
  const hidden = useGamesStore((state) => state.hidden);
  const clearHistory = useGamesStore((state) => state.clearHistory);
  const profiles = useGamesStore((state) => state.profiles);
  const windowPerGame = useGamesStore((state) => state.windowPerGame);
  const setWindowPerGame = useGamesStore((state) => state.setWindowPerGame);
  const setWindowTitle = useWindowStore((state) => state.setTitle);
  const closeWindow = useWindowStore((state) => state.close);
  const account = useAuthStore((state) => state.account);
  const [lockedIds, setLockedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    void loadVerificationSnapshot(true).then((state) => {
      if (alive) setLockedIds(new Set([...state.restricted].filter((id) => !state.owned.has(id))));
    });
    return () => { alive = false; };
  }, [account?.id]);

  /** The name a game is shown under: the profile's override, else the catalogue's. */
  const titleOf = (game: CrystalOSGame) => gameDisplayTitle(game, profiles[game.id]?.title ?? "");

  /** Every Play path goes through launchGame, so a profile set to open in a
      Browser tab never ends up in this window's frame. Embedded games either
      take over this window or open a player window of their own. */
  const startGame = async (game: CrystalOSGame) => {
    if (!(await authorizeGameLaunch(game))) {
      openApp("settings", { args: { page: "accounts" } });
      return;
    }
    if (launchGame(game) !== "embedded") return;
    if (windowPerGame) {
      launchGameInWindow(game);
      return;
    }
    setPlaying(game);
  };

  /** Closing a player window ends the programme, not just the frame. */
  const closePlayer = () => {
    if (isPlayerWindow) {
      closeWindow(windowId);
      return;
    }
    setPlaying(null);
  };

  useEffect(() => {
    setWindowTitle(
      windowId,
      playing
        ? isPlayerWindow
          ? gameDisplayTitle(playing, profiles[playing.id]?.title ?? "")
          : `${gameDisplayTitle(playing, profiles[playing.id]?.title ?? "")} — Game Library`
        : "Game Library",
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, profiles, setWindowTitle, windowId]);

  useEffect(() => {
    if (!playing) return;
    void authorizeGameLaunch(playing).then((allowed) => {
      if (!allowed) {
        closeWindow(windowId);
        openApp("settings", { args: { page: "accounts" } });
      }
    });
  }, [closeWindow, playing, windowId]);

  const playtime = useMemo(() => {
    const map = new Map<string, number>();
    for (const session of sessions) {
      map.set(session.gameId, (map.get(session.gameId) ?? 0) + session.seconds);
    }
    return map;
  }, [sessions]);

  const lastPlayed = useMemo(() => {
    const map = new Map<string, number>();
    for (const session of sessions) {
      if (!map.has(session.gameId)) map.set(session.gameId, session.at);
    }
    return map;
  }, [sessions]);

  const list = useMemo(() => {
    const value = query.trim().toLowerCase();
    const filtered = games.filter((game) => {
      if (hidden.includes(game.id)) return false;
      if (collection !== "all" && game.collection !== collection) return false;
      if (filter === "favourites" && !favourites.includes(game.id)) return false;
      if (filter === "played" && !playtime.has(game.id)) return false;
      if (filter === "never" && playtime.has(game.id)) return false;
      if (!value) return true;
      const profile = profiles[game.id];
      return `${gameDisplayTitle(game, profile?.title ?? "")} ${game.host} ${(profile?.tags ?? []).join(" ")}`
        .toLowerCase()
        .includes(value);
    });

    return filtered.sort((a, b) => {
      if (sort === "name") return titleOf(a).localeCompare(titleOf(b));
      if (sort === "playtime") return (playtime.get(b.id) ?? 0) - (playtime.get(a.id) ?? 0);
      const aRank = recents.indexOf(a.id);
      const bRank = recents.indexOf(b.id);
      if (aRank !== -1 || bRank !== -1) {
        if (aRank === -1) return 1;
        if (bRank === -1) return -1;
        return aRank - bRank;
      }
      return a.addedIndex - b.addedIndex;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collection, favourites, filter, hidden, profiles, query, recents, sessions, sort]);

  const totalSeconds = [...playtime.values()].reduce((total, value) => total + value, 0);
  const focused = gameById.get(focusedId) ?? list[0] ?? games[0];

  /* ---- home shelves -------------------------------------------------- */
  const playable = (ids: string[]) =>
    ids
      .map((id) => gameById.get(id))
      .filter((game): game is CrystalOSGame => Boolean(game) && !hidden.includes((game as CrystalOSGame).id))
      .slice(0, 8);

  const continueShelf = playable(recents);
  const favouriteShelf = playable(favourites);
  const hero = featuredGames[0] ?? games[0];
  const heroSide = featuredGames.slice(1, 4);

  /** First session on record for a game — the shelf's "last played" stamp. */
  const lastPlayedAt = (game: CrystalOSGame) =>
    sessions.find((entry) => entry.gameId === game.id)?.at ?? null;

  /** Details lives in the browse view's panel, so asking for them navigates. */
  const openDetails = (game: CrystalOSGame) => {
    setFocusedId(game.id);
    setView("browse");
  };

  /** Typing, filtering or sorting is the user asking for the full library. */
  const goBrowse = (patch?: { collection?: string }) => {
    if (patch?.collection !== undefined) setCollection(patch.collection);
    setView("browse");
  };

  return (
    <div className="cr-library">
      {playing ? (
        <GamePlayer
          windowId={windowId}
          game={playing}
          onClose={closePlayer}
          onSession={(seconds) => recordSession({ gameId: playing.id, at: Date.now(), seconds })}
        />
      ) : (
        <>
          <aside className="cr-library__rail">
            <div className="cr-library__rail-head">
              <Icon name="library" size={16} />
              <span>Collections</span>
            </div>
            <button
              type="button"
              className="cr-library__rail-item"
              aria-current={view === "home"}
              onClick={() => setView("home")}
            >
              Home
            </button>
            <button
              type="button"
              className="cr-library__rail-item"
              aria-current={view === "browse" && collection === "all"}
              onClick={() => goBrowse({ collection: "all" })}
            >
              All games <span>{games.length - hidden.length}</span>
            </button>
            {collections.map((name) => (
              <button
                key={name}
                type="button"
                className="cr-library__rail-item"
                aria-current={view === "browse" && collection === name}
                onClick={() => goBrowse({ collection: name })}
              >
                {name}
                <span>{games.filter((game) => game.collection === name).length}</span>
              </button>
            ))}

            <div className="cr-library__rail-head cr-library__rail-head--spaced">
              <Icon name="clock" size={16} />
              <span>Play history</span>
            </div>
            <div className="cr-library__rail-stat">
              <strong>{recents.length}</strong> games played
            </div>
            <div className="cr-library__rail-stat">
              <strong>{Math.round(totalSeconds / 60)}</strong> minutes measured
            </div>
            {(sessions.length > 0 || recents.length > 0) && (
              <Button size="sm" variant="ghost" icon="trash" onClick={clearHistory}>
                Clear history
              </Button>
            )}
            <p className="cr-library__rail-note">
              Session lengths come from the player. CrystalOS never estimates play time it did
              not measure.
            </p>

            <div className="cr-library__rail-head cr-library__rail-head--spaced">
              <Icon name="sliders" size={16} />
              <span>Library settings</span>
            </div>
            <label className="cr-library__rail-toggle">
              <span>Open games in their own window</span>
              <Switch
                label="Open games in their own window"
                checked={windowPerGame}
                onChange={setWindowPerGame}
              />
            </label>
            <p className="cr-library__rail-note">
              On, the library stays put and every Play opens a player window of its own. Off, the
              player takes over this window.
            </p>
          </aside>

          <div className="cr-library__main">
            {view === "home" && (
              <div className="cr-library__home">
                <section className="cr-library__hero" aria-label="Featured game">
                  <article className="cr-library__feature">
                    <div className="cr-library__feature-body">
                      <Badge tone="accent">Featured</Badge>
                      <h2>{titleOf(hero)}</h2>
                      <p className="cr-row__desc">
                        {hero.collection} · hosted on {hero.host}
                        {lastPlayedAt(hero)
                          ? ` · last played ${formatRelative(lastPlayedAt(hero) as number)}`
                          : ""}
                      </p>
                      <div className="cr-library__feature-actions">
                        <Button variant="primary" icon="play" onClick={() => startGame(hero)}>
                          Play
                        </Button>
                        <Button variant="ghost" icon="info" onClick={() => openDetails(hero)}>
                          Details
                        </Button>
                      </div>
                    </div>
                  </article>
                  <div className="cr-library__hero-side">
                    {heroSide.map((game) => (
                      <button
                        key={game.id}
                        type="button"
                        className="cr-library__hero-tile"
                        onClick={() => startGame(game)}
                      >
                        <span className="cr-library__hero-tile-text">
                          <span>{titleOf(game)}</span>
                          <span className="cr-row__desc">{categoryLabels[game.category]}</span>
                        </span>
                        <Icon name="play" size={14} />
                      </button>
                    ))}
                  </div>
                </section>

                <HomeShelf
                  title="Continue playing"
                  hint="Sessions the player actually measured."
                  empty="Nothing played yet. Start anything from Featured and it lands here."
                  games={continueShelf}
                  onPlay={startGame}
                  onOpen={openDetails}
                />

                <HomeShelf
                  title="Your favourites"
                  hint={favouriteShelf.length ? `${favourites.length} starred` : undefined}
                  empty="Star a game anywhere in the library and it keeps its place here."
                  games={favouriteShelf}
                  onPlay={startGame}
                  onOpen={openDetails}
                />

                <section className="cr-library__shelf-section">
                  <header className="cr-library__shelf-head">
                    <h3>Collections</h3>
                    <span className="cr-row__desc">Browse the catalogue by kind</span>
                  </header>
                  <div className="cr-library__collections">
                    {collections.map((name) => (
                      <button
                        key={name}
                        type="button"
                        className="cr-library__collection-card"
                        onClick={() => goBrowse({ collection: name })}
                      >
                        <span>{name}</span>
                        <span className="cr-row__desc">
                          {games.filter((game) => game.collection === name && !hidden.includes(game.id)).length}{" "}
                          games
                        </span>
                      </button>
                    ))}
                  </div>
                </section>

                <div className="cr-library__home-cta">
                  <Button variant="secondary" icon="library" onClick={() => goBrowse({ collection: "all" })}>
                    Browse all {games.length - hidden.length} games
                  </Button>
                  <span className="cr-row__desc">
                    Search, sort by name or play time, and filter by favourites.
                  </span>
                </div>
              </div>
            )}

            {view === "browse" && (
              <>
            <header className="cr-library__bar">
              <div className="cr-library__search">
                <TextInput
                  icon="search"
                  value={query}
                  aria-label="Search library"
                  placeholder="Search the library"
                  onChange={(event) => {
                    setQuery(event.target.value);
                    if (event.target.value) setView("browse");
                  }}
                />
              </div>
              <Segmented
                label="Filter"
                value={filter}
                onChange={(value) => {
                  setFilter(value);
                  setView("browse");
                }}
                options={[
                  { value: "all", label: "All" },
                  { value: "favourites", label: "Favourites" },
                  { value: "played", label: "Played" },
                  { value: "never", label: "Unplayed" },
                ]}
              />
              <select
                className="cr-select"
                aria-label="Sort library"
                value={sort}
                onChange={(event) => setSort(event.target.value as Sort)}
              >
                <option value="recent">Recently played</option>
                <option value="name">Name</option>
                <option value="playtime">Play time</option>
              </select>
              <Segmented
                label="Layout"
                value={layout}
                onChange={setLayout}
                options={[
                  { value: "grid", label: "Grid", icon: "grid" },
                  { value: "list", label: "List", icon: "list" },
                ]}
              />
            </header>

            <div className="cr-library__body">
              <div className="cr-library__scroll">
                {list.length === 0 ? (
                  <EmptyState
                    icon="library"
                    title="Nothing in this collection"
                    hint="Change the collection or filter, or search the whole catalogue."
                  />
                ) : layout === "grid" ? (
                  <div className="cr-library__grid">
                    {list.slice(0, 240).map((game) => (
                      <GameCard
                        key={game.id}
                        game={game}
                        locked={lockedIds.has(game.id)}
                        onVerify={() => openApp("settings", { args: { page: "accounts" } })}
                        launched={playtime.has(game.id)}
                        onPlay={() => startGame(game)}
                        onOpen={() => setFocusedId(game.id)}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="cr-library__table">
                    <div className="cr-library__table-head">
                      <span>Game</span>
                      <span>Collection</span>
                      <span>Play time</span>
                      <span>Last played</span>
                      <span />
                    </div>
                    {list.slice(0, 240).map((game) => (
                      <div
                        key={game.id}
                        className="cr-library__table-row"
                        data-focused={game.id === focusedId}
                        onClick={() => setFocusedId(game.id)}
                      >
                        <span className="cr-library__table-game">
                          <span>
                            <strong>{titleOf(game)}</strong>
                            <span className="cr-row__desc">{game.host}</span>
                          </span>
                        </span>
                        <span>{game.collection}</span>
                        <span className="cr-num">
                          {playtime.has(game.id)
                            ? `${Math.max(1, Math.round((playtime.get(game.id) ?? 0) / 60))} min`
                            : "—"}
                        </span>
                        <span className="cr-num">
                          {lastPlayed.has(game.id)
                            ? formatRelative(lastPlayed.get(game.id) as number)
                            : "—"}
                        </span>
                        <Button size="sm" icon="play" onClick={() => startGame(game)}>
                          Play
                        </Button>
                      </div>
                    ))}
                  </div>
                )}

                {list.length > 240 && (
                  <p className="cr-row__desc cr-library__more">
                    Showing the first 240 of {list.length} games. Narrow the search to see more.
                  </p>
                )}
              </div>

              <aside className="cr-library__detail">
                {focused && (
                  <>
                    <h3>{titleOf(focused)}</h3>
                    <div className="cr-library__detail-badges">
                      <Badge>{categoryLabels[focused.category]}</Badge>
                      <Badge>{focused.collection}</Badge>
                      {(profiles[focused.id]?.tags ?? []).map((tag) => (
                        <Badge key={tag} tone="accent">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                    <dl className="cr-library__facts">
                      <div>
                        <dt>Host</dt>
                        <dd>{focused.host}</dd>
                      </div>
                      <div>
                        <dt>Play time</dt>
                        <dd>
                          {playtime.has(focused.id)
                            ? `${Math.round((playtime.get(focused.id) ?? 0) / 60)} min`
                            : "Not played yet"}
                        </dd>
                      </div>
                      <div>
                        <dt>Last played</dt>
                        <dd>
                          {lastPlayed.has(focused.id)
                            ? formatRelative(lastPlayed.get(focused.id) as number)
                            : "—"}
                        </dd>
                      </div>
                      <div>
                        <dt>Sessions</dt>
                        <dd>{sessions.filter((entry) => entry.gameId === focused.id).length}</dd>
                      </div>
                    </dl>
                    <div className="cr-library__detail-actions">
                      <Button variant="primary" icon="play" onClick={() => startGame(focused)}>
                        Play
                      </Button>
                      <Button
                        variant="ghost"
                        icon="external"
                        onClick={() =>
                          window.open(focused.url, "_blank", "noopener,noreferrer")
                        }
                      >
                        Publisher page
                      </Button>
                      <Button
                        variant="ghost"
                        icon="users"
                        onClick={() =>
                          openApp("social", { args: { compose: "gaming" } })
                        }
                      >
                        Discuss
                      </Button>
                    </div>
                    <p className="cr-row__desc">
                      Catalogue entry — bundled with CrystalOS. Launching it opens the publisher's
                      own page inside a sandboxed player.
                    </p>
                  </>
                )}
              </aside>
              </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* ==========================================================================
   A shelf on the home view

   Same card the grid uses, laid out in a row that scrolls sideways, with a
   written empty state instead of an empty box — an empty shelf that says
   nothing looks broken rather than new.
   ========================================================================== */

function HomeShelf({
  title,
  hint,
  empty,
  games: items,
  launched = false,
  onPlay,
  onOpen,
}: {
  title: string;
  hint?: string;
  empty: string;
  games: CrystalOSGame[];
  launched?: boolean;
  onPlay: (game: CrystalOSGame) => void;
  onOpen: (game: CrystalOSGame) => void;
}) {
  return (
    <section className="cr-library__shelf-section">
      <header className="cr-library__shelf-head">
        <h3>{title}</h3>
        {hint && <span className="cr-row__desc">{hint}</span>}
      </header>
      {items.length === 0 ? (
        <p className="cr-library__shelf-empty">{empty}</p>
      ) : (
        <div className="cr-library__shelf">
          {items.map((game) => (
            <GameCard
              key={game.id}
              game={game}
              launched={launched}
              onPlay={() => onPlay(game)}
              onOpen={() => onOpen(game)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export default GameLibrary;
