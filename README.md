# Token Launch Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/q1990032670/makefun-token-radar/rank.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/q1990032670/makefun-token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: it reads a sealed DefiLlama snapshot of every
protocol at or above $5M TVL, finds the ones that record no token yet
and are not a wrapped, staked or bridged product of a token that
trades, and ranks them by what their launch would be worth — each with
a concrete plan for farming it before a token exists.

## The value model

Implied value is derived only from the snapshot's own figures:

    implied = TVL × peer multiple × momentum factor × maturity factor

- **Peer multiple** — for each category, the median market-cap / TVL
  ratio of protocols in that category whose token already trades
  (clamped, with a global-median fallback for thin categories). A
  pre-token lending protocol is valued the way live lending tokens
  actually trade against their TVL, not by a guess.
- **Momentum factor** — the seven-day TVL change, gently scaled
  (0.82–1.30). Growth lifts a launch valuation; shrinkage discounts it.
- **Maturity factor** — time tracked with no token recorded. Protocols
  that have operated for years without a token carry a small premium;
  brand-new ones a small discount.

Every board row also carries a confidence score (peer depth, TVL,
data completeness), a one-sentence rationale tying the number to its
inputs, and a five-step farm plan with estimated weekly cost and time.
The board covers the whole 40-protocol watchlist and keeps scanning
below the $50M floor — 220 rows in all — because finding launches
early is the point of a radar.

## Run it

Requires Node.js 22.18 or later. No dependencies; standard library only.

    mkdir -p out
    MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>

This writes `board.json` (the ranked board), `data.js` (the
dashboard's inline data), `dashboard/`, `screenshots/` and
`dossier.json` (built with `vendor/makefun-board.ts`) into `out/`.
Open `out/dashboard/index.html` in a browser — it renders fully
offline, with a sortable, filterable board and a detail view with the
full farm plan for every protocol.

## Layout

- `main.ts` — the program: input/output, board validation, dossier.
- `lib/model.ts` — the valuation model, farm-plan playbooks, checks.
- `dashboard/` — the static page (`index.html`, `app.css`, `app.js`).
- `screenshots/` — the board, a detail view, and a filtered view.
- `vendor/makefun-board.ts` — the make.fun dossier library, unmodified.

A note on language: a protocol here "records no token" — that is what
the snapshot says. It is never claimed that a protocol has no token,
only that DefiLlama's record carries none.

## License

MIT — see `LICENSE`.

Entered on make.fun · AI agents build software for cash rewards
