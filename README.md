# womp-markets

A market browser and stock monitor for a private EVE Online citadel.

It polls the citadel's order book, keeps a permanent history of every order, and puts the numbers
you actually act on — what's running out, how fast it moves, and what it costs at Jita 4-4 — on one
screen.

## Why it works the way it does

ESI publishes **no market history for player-owned structures**. There is no volume endpoint, no
price history, and no confirmation that a trade ever happened — only the live order book as it
stands right now.

So the poller reads the book on a timer and diffs consecutive snapshots. When an order's remaining
volume drops, that's an observed sale. When an order vanishes, it's classified by what else was
true at the time:

| What happened | Recorded as |
|---|---|
| Volume went down, order still there | `fill` — observed |
| Gone, and past `issued + duration` | `expired` — not a trade |
| Gone, still valid, was the best price on its side | `fill_estimated` — inferred |
| Gone, still valid, was not best-priced | `cancelled` |

Inferred volume is kept in separate columns from observed volume and never silently added to it.
If the server misses more than three polls in a row, disappearances during the gap aren't
attributed to sales at all — too much could have happened in between to guess honestly.

This means **the numbers get better the longer it runs**, and a young dataset is labelled as such:
every item's detail view says how many days of history it actually has.

## What it gives you

- **Tracked** — one shared watchlist. Minimum stock per item, local and Jita buy/sell, spread %,
  volume, and days until it hits zero, with an Out / Critical / Low / OK status. Select low items
  and send them to the cart.
- **Browse** — every item listed in the citadel, searchable and filterable by market group.
- **Item detail** — depth ladder, sales with 7- and 30-day moving averages, stock over time, live
  event feed, Jita comparison.
- **Cart** — adjust restock quantities and copy an EVE multibuy list to the clipboard.
- **Reports** — seven interactive pop-outs: restock list, stockout forecast, Jita spread, velocity,
  dead stock, buy/sell balance, and data health. Each filters, charts and exports.
- **Settings** — market sources, SDE build status, Jita price source health.

### Minimums, two ways

Each tracked item can have a flat minimum, a minimum expressed in **days of sales cover**, or both.
Whichever is stricter right now applies. The days-of-cover floor scales with real demand, so fast
movers stay stocked without anyone revising numbers by hand.

### Days-of-cover maths

Sales rates divide by the number of days that **have data**, not by the window length. An item
first seen three days ago has no sales on the other 27 days of a 30-day window; counting those as
zeroes would report it moving ten times slower than it does, and days-of-cover would then claim far
more runway than really exists.

## Static data

Item names and market groups come from [CCP's Static Data Export][sde], ingested into one generic
`SdeRecord(dataset, key, data)` table and joined at read time. Nothing is denormalised onto market
rows, so a new SDE build takes effect immediately with no backfill. The scheduler checks for new
builds every `SDE_CHECK_INTERVAL_HOURS` (default 12) and only downloads when the build number
moves.

[sde]: https://developers.eveonline.com/docs/services/static-data/

## Jita 4-4 prices

Two providers, either can be primary, the other covers its failures:

- **Fuzzwork** (`market.fuzzwork.co.uk/aggregates/`) takes hundreds of type ids per request for
  station 60003760 — a 500-item watchlist costs about three requests.
- **ESI** (`/markets/10000002/orders/`) is one request per item and returns the whole of The Forge,
  filtered down to the 4-4 station.

Each row records which provider answered, and Settings flags it when the fallback is quietly doing
all the work.

## Access

Login is EVE SSO. A character is allowed in if its corporation or alliance appears in
`ALLOWED_CORPORATION_IDS` / `ALLOWED_ALLIANCE_IDS`; anyone else gets a clear "not authorised" page
and is recorded so an admin can find them. Characters named in `ADMIN_CHARACTER_NAMES` get the
admin role on every login.

> **With both allowlists empty, every EVE character can sign in.** That's convenient for a private
> test instance and wide open in production. Settings shows the effective policy so this is never
> silent.

Everyone signed in can read everything and build a cart. Only admins can change the tracked list,
edit market sources or trigger a poll — enforced server-side in the RPC dispatcher, not just hidden
in the UI.

## Getting started

```bash
cp .env.example .env          # fill in EVE SSO credentials and SESSION_SECRET
npm install && npm install --prefix server

docker compose -f docker-compose.dev.yml up -d    # local Postgres
npm run db:migrate
npm run dev                                        # Vite on :5173, API on :8080
```

Set `ENABLE_LOCAL_ADMIN_LOGIN=true` to get into the UI before you've registered an SSO application.
When it isn't exactly `"true"` the route isn't mounted at all, so it 404s rather than 403s.

The citadel itself can come from `MARKET_STRUCTURE_ID` / `MARKET_READER_CHARACTER`, or be added
through the first-run wizard on the Settings page. The reader character needs docking access to the
structure — without it ESI returns 403 and the failure is shown on that page.

### Commands

| Command | What it does |
|---|---|
| `npm run dev` | Vite + API with reload |
| `npm test` | Vitest — unit suite always, integration when `DATABASE_URL_TEST` is set |
| `npm run lint` | ESLint |
| `npm run build` | Production frontend build |
| `npm run db:migrate` | Create and apply a migration |

## Tests

106 tests. The unit suite covers the maths, the multibuy format, Fuzzwork parsing and the
allowlist, and needs no database.

The integration suite drives the poller against scripted order-book snapshots and asserts every
branch of the diff — including that a missed-tick gap attributes no fills, that inferred volume
never lands in the confirmed column, and that the order archive survives a retention sweep that
prunes everything else. It needs `DATABASE_URL_TEST`; without it those tests skip so `npm test`
still works on a bare checkout.

```bash
docker compose -f docker-compose.dev.yml up -d
(cd server && npx prisma db push)
DATABASE_URL_TEST=postgresql://postgres:postgres@localhost:5432/womp_markets_test npm test
```

## Deployment

Live at **https://womp.cottoncandygenocide.ca**.

One image containing Postgres, the API and the built frontend, behind Caddy for automatic TLS:

```bash
cp .env.example .env    # set SITE_DOMAIN, LETSENCRYPT_EMAIL, POSTGRES_PASSWORD, SESSION_SECRET
docker compose up -d --build
```

Every commit to the deployment branch triggers `.github/workflows/deploy.yml`, which SSHes to the
server, pulls and rebuilds — the same setup as the main cottoncandygenocide site. `ci.yml` runs
lint, tests and build alongside it but does not gate the deploy.

Full server setup, the GitHub secrets it needs and troubleshooting are in
[docs/DEPLOY.md](docs/DEPLOY.md).

## Data retention

`retentionDays` (default 180) prunes the event feed, daily stats and stock snapshots.
**`MarketOrderArchive` is never pruned** — it's the permanent record of every order that has passed
through the citadel, and outliving the retention window is the entire point of it.

## Notes

Branding is carried over from [cottoncandygenocide][ccg], which is also where the SDE ingest and the
order-book diff originated. The comments in `sdeIngest.js` describing production hangs are
load-bearing: each workaround there is a response to a real failure, not defensive habit.

[ccg]: https://github.com/boxxykiller/cottoncandygenocide

---

EVE Online and all related assets are the property of [CCP hf][ccp]. This is a third-party tool and
is not affiliated with or endorsed by CCP.

[ccp]: https://www.ccpgames.com/
