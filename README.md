# TEMPO — Chess Improvement Lab

A runnable first version of a chess-improvement app inspired by the dark, warm, minimalist references you supplied. It is designed around reviewing your own games and turning mistakes into repeatable study.

## What works in this build

- **Chess.com history import:** enter a public username, choose how far back to import and fetch completed games from the public archives API.
- **PGN import:** upload a PGN exported from Chess.com, Lichess or another chess program.
- **Game library:** search and filter imported games by opponent, opening and result.
- **Stockfish analysis:** run Stockfish 19 Lite locally in a Web Worker. The app analyses positions in order, identifies large evaluation drops, records a principal variation and saves review positions.
- **Small analysis batches:** from My Games, choose “Analyse next 3” to work through a few unreviewed games sequentially.
- **Move coach:** click a move to inspect the board and read a plain-English explanation generated from the current engine/position heuristics.
- **Mistake Bank:** review saved FEN positions and schedule another review using Again / Hard / Good / Easy intervals.
- **Opening report:** see your own win/draw/loss performance by opening and colour.
- **Opening recall:** replay your own early-game choices as recall prompts, with a simple spaced-repetition schedule.
- **AI sparring coach:** play as White against Stockfish with an adjustable Skill Level. When the engine detects a large evaluation drop, the coach can pause and give you a second chance.
- **Local storage:** your current workspace is saved in this browser.

The current explanations use templates, not an LLM. The production LLM adapter, Maia model, multi-device account, peer rating-bracket comparisons and full clock telemetry are documented as next integrations, not claimed as already live.

## Run it locally

Requirements: Node.js 20+ and npm.

```bash
npm install
npm run dev
```

Open the local URL printed by Vite (normally `http://localhost:5173`).

`npm install` runs `scripts/copy-engine.mjs`, which copies the Stockfish 19 Lite single-threaded JS and WASM assets from `node_modules/stockfish/bin/` into `public/engine/`. The engine worker and its matching `.wasm` file must both exist in that folder. If you add/update Stockfish, run:

```bash
node scripts/copy-engine.mjs
```

For a production build:

```bash
npm run build
npm run preview
```

## First launch

The app starts with clearly labelled sample data so you can explore the screens. Use **Import games** to replace it with your own Chess.com archive or PGN file.

### Chess.com import

The importer uses the public endpoints:

- `https://api.chess.com/pub/player/{username}`
- `https://api.chess.com/pub/player/{username}/games/archives`
- the monthly archive URLs returned by the archive endpoint

It makes requests serially and pauses between archives. If the browser blocks a request or the API responds with a rate limit, export a PGN and use file upload instead. This app cannot access private Chess.com data through the public API.

## Analysis notes

- The prototype runs depth 9 per position and is intended for small batches. A full analysis of many long games can take time and battery on a phone; a production app should queue jobs and offer analysis-depth presets.
- Centipawn loss is calculated from the engine's side-to-move evaluation before and after a move. This is a useful estimate, not an official platform accuracy metric.
- Mistake motif labels are heuristic and should be treated as study hints, not authoritative tactical proof.
- The sample dashboard chart, sample KPI values and sample mistake cards are illustrative until you import and analyse real games.

## Database and production architecture

See [`database/schema.sql`](database/schema.sql) for a Postgres/Supabase starter schema covering profiles, linked accounts, games, moves, engine analyses, move explanations, mistake positions, opening repertoire, SRS reviews, tactical puzzles, daily plans and telemetry.

See [`ARCHITECTURE.md`](ARCHITECTURE.md) for the recommended production stack and integration boundaries.

## Important attribution and independence

Tempo is an independent chess training prototype. It is **not affiliated with, endorsed by, or sponsored by Chess.com, Lichess, Maia or the Stockfish project**. It uses the public Chess.com data API and does not use Chess.com logos, proprietary piece artwork or branding. Stockfish.js is GPL-3.0; retain its licence/copyright notice when redistributing its engine files. `chess.js` is BSD-2-Clause.

## Current limitations / next build steps

1. Add LLM-powered natural-language explanations through a server-side API route, grounded in the engine's evaluation and principal variation.
2. Integrate Maia or another human-move model for rating-appropriate sparring. Stockfish Skill Level is only a first approximation.
3. Add background analysis jobs, cancellation, resumable queues, depth presets and multi-PV.
4. Improve motif detection with explicit fork, pin, skewer, discovered attack, back-rank and loose-piece detectors.
5. Add complete endgame pattern sets, blind calculation across several plies and a richer FSRS scheduler.
6. Add account sync, encrypted provider tokens where needed, Supabase RLS policies and multi-device restore.
7. Parse move clocks where PGNs contain them; show the time/blunder correlation only when sufficient data exists.
