# sndgames-remastered — ported catalogue

This directory contains a copy of the game catalogue from the original
`sndgames-remastered` project (`C:\Projects\sndgames-remastered`), taken so
Crescent OS can present the same library without depending on that project's
Next.js build.

## What was copied

- `games-data.ts` — the raw catalogue (`title`, embed `url`, `category`) plus
  the category list and the thumbnail helpers that the original project used.

The original project is **unmodified**. Only this file was copied.

## What was not copied

- The original React components, Next.js routing, Tailwind theme, account
  storage and settings modal. Crescent OS has its own shell, theming, account
  system and settings, so duplicating them would have produced two competing
  designs in one product.

## How Crescent uses it

`src/apps/games/catalogue.ts` imports `games` from this file and derives
Crescent-specific metadata: stable ids, display categories, a search index and
featured picks. The Games and Game Library applications render it with Crescent
OS design tokens, so switching the OS theme restyles the whole library.

## Licensing

The copied file is first-party code from a private project and carries no
third-party licence notice. Each entry's `url` points at a third-party game
host (onlinegames.io, famobi, crazygames, gamedistribution, and others). Those
games remain the property of their publishers and are embedded at runtime; no
game assets are redistributed in this repository.
