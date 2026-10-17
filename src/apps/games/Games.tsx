import { useEffect, useMemo, useState } from "react";
import { Badge, Button, EmptyState, Segmented, TextInput } from "@/components/ui";
import { Icon } from "@/icons/Icon";
import { useGamesStore } from "@/state/games";
import { useWindowStore } from "@/state/windows";
import type { AppProps } from "@/types";
import { formatRelative } from "@/utils/format";
import {
  categoryCounts,
  featuredGames,
  gameById,
  games,
  gamesPerPage,
  searchGames,
  type CrystalOSGame,
  type GameCategory,
} from "./catalogue";
import { GameCard, GameCover, GameDetail, GamePlayer } from "./parts";

/* ==========================================================================
   CrystalOS Games

   The catalogue, a real player and a real recents list. Nothing on this screen
   is a placeholder: every tile launches something, and play history comes from
   sessions the player actually measured.
   ========================================================================== */

type View = "store" | "favourites" | "recent";

export function Games({ windowId }: AppProps) {
  const [view, setView] = useState<View>("store");
  const [category, setCategory] = useState<GameCategory | "all">("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [playing, setPlaying] = useState<CrystalOSGame | null>(null);
  const [detail, setDetail] = useState<CrystalOSGame | null>(null);

  const favourites = useGamesStore((state) => state.favourites);
  const recents = useGamesStore((state) => state.recents);
  const sessions = useGamesStore((state) => state.sessions);
  const recordSession = useGamesStore((state) => state.recordSession);
  const setWindowTitle = useWindowStore((state) => state.setTitle);

  useEffect(() => {
    setPage(1);
  }, [category, query, view]);

  useEffect(() => {
    setWindowTitle(windowId, playing ? `${playing.title} — CrystalOS Games` : "CrystalOS Games");
  }, [playing, setWindowTitle, windowId]);

  const source = useMemo(() => {
    if (view === "favourites") {
      return favourites.map((id) => gameById.get(id)).filter(Boolean) as CrystalOSGame[];
    }
    if (view === "recent") {
      return recents.map((id) => gameById.get(id)).filter(Boolean) as CrystalOSGame[];
    }
    return searchGames(query, category);
  }, [category, favourites, query, recents, view]);

  const pageCount = Math.max(1, Math.ceil(source.length / gamesPerPage));
  const visible = source.slice((page - 1) * gamesPerPage, page * gamesPerPage);
  const launchCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const session of sessions) {
      counts.set(session.gameId, (counts.get(session.gameId) ?? 0) + 1);
    }
    return counts;
  }, [sessions]);

  const totalMinutes = Math.round(
    sessions.reduce((total, session) => total + session.seconds, 0) / 60,
  );

  return (
    <div className="cr-games">
      {playing ? (
        <GamePlayer
          game={playing}
          onClose={() => setPlaying(null)}
          onSession={(seconds) => recordSession({ gameId: playing.id, at: Date.now(), seconds })}
        />
      ) : (
        <>
          <header className="cr-games__bar">
            <Segmented
              label="Games view"
              value={view}
              onChange={setView}
              options={[
                { value: "store", label: "Catalogue" },
                { value: "favourites", label: `Favourites ${favourites.length || ""}`.trim() },
                { value: "recent", label: "Recent" },
              ]}
            />
            <div className="cr-games__search">
              <TextInput
                icon="search"
                value={query}
                aria-label="Search games"
                placeholder={`Search ${games.length} games`}
                disabled={view !== "store"}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <span className="cr-games__stat">
              {sessions.length > 0 ? `${totalMinutes} min played` : "No sessions yet"}
            </span>
          </header>

          <div className="cr-games__scroll">
            {view === "store" && !query && (
              <>
                <section className="cr-games__hero">
                  <FeaturedHero
                    game={featuredGames[0]}
                    onPlay={setPlaying}
                    onOpen={setDetail}
                    recentAt={sessions.find((entry) => entry.gameId === featuredGames[0]?.id)?.at}
                  />
                  <div className="cr-games__hero-side">
                    {featuredGames.slice(1, 4).map((game) => (
                      <button
                        key={game.id}
                        type="button"
                        className="cr-games__hero-tile"
                        onClick={() => setPlaying(game)}
                      >
                        <GameCover game={game} radius={5} />
                        <span className="cr-games__hero-tile-text">
                          <span>{game.title}</span>
                          <span className="cr-row__desc">{game.host}</span>
                        </span>
                        <Icon name="play" size={14} />
                      </button>
                    ))}
                  </div>
                </section>

                <div className="cr-games__categories">
                  {categoryCounts.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      className="cr-games__category"
                      aria-pressed={category === entry.id}
                      onClick={() => setCategory(entry.id)}
                    >
                      {entry.label}
                      <span>{entry.count}</span>
                    </button>
                  ))}
                </div>
              </>
            )}

            {view === "store" && query && (
              <div className="cr-games__categories">
                {categoryCounts.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    className="cr-games__category"
                    aria-pressed={category === entry.id}
                    onClick={() => setCategory(entry.id)}
                  >
                    {entry.label}
                    <span>{entry.count}</span>
                  </button>
                ))}
              </div>
            )}

            {source.length === 0 ? (
              <EmptyState
                icon="games"
                title={
                  view === "favourites"
                    ? "No favourites yet"
                    : view === "recent"
                      ? "Nothing played yet"
                      : "No games match that search"
                }
                hint={
                  view === "favourites"
                    ? "Star a game from the catalogue to keep it here."
                    : view === "recent"
                      ? "Games you play appear here with the session length measured by the player."
                      : "Try a different term or another category."
                }
              />
            ) : (
              <>
                <div className="cr-games__grid">
                  {visible.map((game) => (
                    <GameCard
                      key={game.id}
                      game={game}
                      launched={Boolean(launchCounts.get(game.id))}
                      onPlay={() => setPlaying(game)}
                      onOpen={() => setDetail(game)}
                    />
                  ))}
                </div>

                {pageCount > 1 && (
                  <nav className="cr-games__pager" aria-label="Catalogue pages">
                    <Button
                      size="sm"
                      icon="chevron-left"
                      disabled={page === 1}
                      onClick={() => setPage((value) => Math.max(1, value - 1))}
                    >
                      Previous
                    </Button>
                    <span className="cr-games__pager-label">
                      Page {page} of {pageCount}
                    </span>
                    <Button
                      size="sm"
                      iconRight="chevron-right"
                      disabled={page === pageCount}
                      onClick={() => setPage((value) => Math.min(pageCount, value + 1))}
                    >
                      Next
                    </Button>
                  </nav>
                )}
              </>
            )}

            {view === "recent" && recents.length > 0 && (
              <section className="cr-games__history">
                <h3>Measured sessions</h3>
                {sessions.slice(0, 8).map((session) => (
                  <div key={`${session.gameId}-${session.at}`} className="cr-games__history-row">
                    <span>{gameById.get(session.gameId)?.title ?? session.gameId}</span>
                    <span className="cr-row__desc">
                      {Math.max(1, Math.round(session.seconds / 60))} min ·{" "}
                      {formatRelative(session.at)}
                    </span>
                  </div>
                ))}
              </section>
            )}
          </div>
        </>
      )}

      {detail && !playing && (
        <div className="cr-games__drawer">
          <GameDetail
            game={detail}
            onClose={() => setDetail(null)}
            onPlay={() => {
              setPlaying(detail);
              setDetail(null);
            }}
          />
        </div>
      )}
    </div>
  );
}

function FeaturedHero({
  game,
  onPlay,
  onOpen,
  recentAt,
}: {
  game: CrystalOSGame | undefined;
  onPlay: (game: CrystalOSGame) => void;
  onOpen: (game: CrystalOSGame) => void;
  recentAt?: number;
}) {
  if (!game) return null;
  return (
    <article className="cr-games__feature">
      <div className="cr-games__feature-art">
        <GameCover game={game} radius={8} />
      </div>
      <div className="cr-games__feature-body">
        <Badge tone="accent">Featured</Badge>
        <h2>{game.title}</h2>
        <p className="cr-row__desc">
          {game.collection} · hosted on {game.host}
          {recentAt ? ` · last played ${formatRelative(recentAt)}` : ""}
        </p>
        <div className="cr-games__feature-actions">
          <Button variant="primary" icon="play" onClick={() => onPlay(game)}>
            Play
          </Button>
          <Button variant="ghost" icon="info" onClick={() => onOpen(game)}>
            Details
          </Button>
        </div>
      </div>
    </article>
  );
}

export default Games;
