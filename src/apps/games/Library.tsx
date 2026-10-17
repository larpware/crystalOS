import { useEffect, useMemo, useState } from "react";
import { Badge, Button, EmptyState, Segmented, TextInput } from "@/components/ui";
import { Icon } from "@/icons/Icon";
import { useGamesStore } from "@/state/games";
import { useWindowStore } from "@/state/windows";
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
import { GameCard, GameCover, GamePlayer } from "./parts";
import { gameDisplayTitle, launchGame } from "./launch";

/* ==========================================================================
   Game Library

   A collection-first view over the same catalogue. "Installed" means the game
   is part of the bundled catalogue and can be launched right now; there is no
   download to fake, so nothing here shows invented progress.
   ========================================================================== */

type Sort = "recent" | "name" | "playtime";
type Filter = "all" | "favourites" | "played" | "never";

export function GameLibrary({ windowId }: AppProps) {
  const [collection, setCollection] = useState<string>("all");
  const [sort, setSort] = useState<Sort>("recent");
  const [filter, setFilter] = useState<Filter>("all");
  const [layout, setLayout] = useState<"grid" | "list">("grid");
  const [query, setQuery] = useState("");
  const [playing, setPlaying] = useState<CrystalOSGame | null>(null);
  const [focusedId, setFocusedId] = useState<string>(featuredGames[0]?.id ?? games[0].id);

  const favourites = useGamesStore((state) => state.favourites);
  const recents = useGamesStore((state) => state.recents);
  const sessions = useGamesStore((state) => state.sessions);
  const recordSession = useGamesStore((state) => state.recordSession);
  const hidden = useGamesStore((state) => state.hidden);
  const clearHistory = useGamesStore((state) => state.clearHistory);
  const profiles = useGamesStore((state) => state.profiles);
  const setWindowTitle = useWindowStore((state) => state.setTitle);

  /** The name a game is shown under: the profile's override, else the catalogue's. */
  const titleOf = (game: CrystalOSGame) => gameDisplayTitle(game, profiles[game.id]?.title ?? "");

  /** Every Play path goes through launchGame, so a profile set to open in a
      Browser tab never ends up in this window's frame. */
  const startGame = (game: CrystalOSGame) => {
    if (launchGame(game) === "embedded") setPlaying(game);
  };

  useEffect(() => {
    setWindowTitle(
      windowId,
      playing ? `${gameDisplayTitle(playing, profiles[playing.id]?.title ?? "")} — Game Library` : "Game Library",
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, profiles, setWindowTitle, windowId]);

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

  return (
    <div className="cr-library">
      {playing ? (
        <GamePlayer
          game={playing}
          onClose={() => setPlaying(null)}
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
              aria-current={collection === "all"}
              onClick={() => setCollection("all")}
            >
              All games <span>{games.length - hidden.length}</span>
            </button>
            {collections.map((name) => (
              <button
                key={name}
                type="button"
                className="cr-library__rail-item"
                aria-current={collection === name}
                onClick={() => setCollection(name)}
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
          </aside>

          <div className="cr-library__main">
            <header className="cr-library__bar">
              <div className="cr-library__search">
                <TextInput
                  icon="search"
                  value={query}
                  aria-label="Search library"
                  placeholder="Search the library"
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
              <Segmented
                label="Filter"
                value={filter}
                onChange={setFilter}
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
                          <GameCover game={game} radius={4} />
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
                    <div className="cr-library__detail-art">
                      <GameCover game={focused} radius={7} />
                    </div>
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
                    </div>
                    <p className="cr-row__desc">
                      Catalogue entry — bundled with CrystalOS. Launching it opens the publisher's
                      own page inside a sandboxed player.
                    </p>
                  </>
                )}
              </aside>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default GameLibrary;
