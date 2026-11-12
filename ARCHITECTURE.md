# Tempo — product architecture

## Product principle

Tempo is an improvement product, not a place to accumulate engine scores. Every analysis should end in a teachable explanation, a saved training position, an opening habit, or a deliberate next action.

## Current runnable MVP

- **Frontend:** Vite + vanilla JavaScript modules, responsive CSS, and `chess.js` for move validation, PGN parsing, legal move generation, board state and FEN handling.
- **Game ingestion:** Chess.com Published-Data API (public profile, monthly archive list, monthly games JSON) plus PGN file upload. Archive calls are sequential with a short delay to avoid burst traffic.
- **Engine:** Stockfish 19 Lite, single-threaded WebAssembly in a Web Worker. This avoids requiring cross-origin isolation headers and keeps analysis on the device. The current UI analyses one game or a small batch at depth 9.
- **Persistence:** browser `localStorage` for this prototype. Imported PGNs, results, move reviews, mistakes and SRS dates remain on the current device/browser.
- **Coaching text:** the prototype uses explicit rule-based templates driven by engine score loss, best move and board-state signals. It does **not** call an LLM yet.

## Recommended production stack

| Layer | Recommendation | Why |
|---|---|---|
| Web client | React + TypeScript + Vite (or Next.js if server-rendering is needed) | Typed UI state, component reuse, mobile-ready PWA |
| Chess rules | `chess.js` | PGN, FEN, move validation and legal move generation |
| Board UI | Custom board components or `react-chessboard` | Board themes and interaction can stay independent of a chess-site brand |
| Engine | Stockfish 19+ WASM worker | Private on-device analysis; depth and MultiPV can be tuned per task |
| Human-like sparring | Maia model adapter, with Stockfish Skill Level as a fallback | Maia predicts human moves at rating levels; Skill Level is only an approximation, not the same model |
| Database | Supabase Postgres + Auth + Storage | Per-user game history, analysis, SRS state and synced devices |
| Background analysis | Supabase Edge Functions or a queue worker | Large imports and engine jobs should not block a phone tab |
| Coach LLM | Server-side LLM provider adapter | Converts structured engine evidence into natural language without exposing API keys to the browser |
| Analytics | SQL views/materialized summaries | Opening results, phase ACPL, mistake motifs and clock correlations |

## Key analysis pipeline

1. Import a completed game and preserve its original PGN and provider metadata.
2. Replay the PGN through `chess.js`, storing each pre-move FEN and post-move FEN.
3. Ask Stockfish for evaluations and principal variations at a recorded depth/build.
4. Convert the evaluation into the mover's perspective and calculate centipawn loss. Thresholds are configurable; the prototype currently uses 70 cp for an inaccuracy, 150 cp for a mistake and 300 cp for a blunder.
5. Identify the game phase and run motif detectors. Current motif labels are heuristic; production classifiers should verify pins, forks, hanging pieces, back-rank patterns and missed forcing moves against the board and engine PV.
6. Build a structured coaching packet: played move, best move, evaluation swing, PV, phase, motif and relevant board facts.
7. Ask the LLM to explain only those grounded facts. Require it to avoid inventing threats or claiming a motif that was not detected.
8. Save the position and a review schedule in the Mistake Bank.

## Important metric caveats

- Centipawn loss depends on engine version, search depth, MultiPV, time control and position selection. Keep the engine metadata with every analysis.
- A browser build's evaluation and accuracy are estimates; do not present them as Chess.com's own accuracy score.
- Opening win rate needs sample-size labels and rating-bracket controls before comparisons with peers are meaningful.
- Clock/blunder correlation requires per-move clock values. The public Chess.com archive does not guarantee clock telemetry in every PGN. Support PGNs with `%clk` comments and a Lichess export path; otherwise mark the metric unavailable rather than guessing.
- Stockfish Skill Level can make weaker moves, but it is not a human-trained opponent. A Maia adapter is the right next step for realistic rating-specific move distributions.

## Integrations

- **Chess.com:** public read-only archive import. Do not scrape the website, use private endpoints, or imply affiliation. Keep the app's name, visual identity and interface independent.
- **Lichess:** add a PGN export importer and optional opening explorer / tablebase adapter. Use a user-authorised API token only for endpoints that need it.
- **Stockfish:** included as an external GPL-3.0 engine dependency; keep its licence and copyright notice when distributing its engine files.
- **Maia:** add behind a `MoveAdvisor` interface so it can be swapped or updated without changing the board UI.
- **LLM:** send structured engine evidence from a server route. Never embed a provider API key in browser JavaScript.

## Privacy and fair-play boundary

This app is for completed games and training sessions. Do not display engine assistance over a live rated Chess.com or Lichess game. Keep local-first storage as the default; syncing requires clear consent and account-level access controls.
