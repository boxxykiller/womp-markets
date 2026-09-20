# Deploying womp-markets

Same shape as the main cottoncandygenocide site: GitHub Actions SSHes to the server on every
commit, pulls, rebuilds and restarts the containers.

- **Site:** https://womp.cottoncandygenocide.ca
- **Server:** `155.138.213.76` (a different box from the main site, which is `155.138.201.89` —
  so this instance runs its own Caddy on 80/443 with no port conflict)

## Fastest path: the Bootstrap workflow

If you'd rather not run the server commands by hand, add the secrets below and
run **Actions → Bootstrap server → Run workflow**. It SSHes in and does the whole
one-time setup for you: installs Docker, clones the repo, writes `.env` from the
secrets (generating `SESSION_SECRET` and `POSTGRES_PASSWORD` itself), builds,
starts, and then verifies the site answers over HTTPS from the public internet.

It is safe to re-run — it installs Docker only if missing, clones only if
missing, and **never overwrites an existing `.env`** (doing so would rotate the
database password and lock the app out of its own data).

Secrets it reads, beyond the five deploy secrets:

| Secret | Notes |
|---|---|
| `EVE_CLIENT_ID` / `EVE_CLIENT_SECRET` | from your EVE application |
| `LETSENCRYPT_EMAIL` | for the certificate |
| `ALLOWED_CORPORATION_IDS` | **set this**, or any EVE character can sign in |
| `ALLOWED_ALLIANCE_IDS` | optional |
| `ADMIN_CHARACTER_NAMES` | your character name |
| `MARKET_STRUCTURE_ID` / `MARKET_READER_CHARACTER` | optional — otherwise use the first-run wizard |

The manual equivalent of all of this is below, if you prefer to do it yourself.

## One-time server setup

Everything below runs **on the server**, once. After this, deploys are automatic.

### 1. Docker

```bash
curl -fsSL https://get.docker.com | sh
```

### 2. Deploy key

The GitHub Action authenticates as a normal SSH user. On the server, append the **public** half of
the keypair you're using for deploys:

```bash
mkdir -p ~/.ssh && chmod 700 ~/.ssh
echo 'ssh-ed25519 AAAA... claude-deploy' >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

If you need a fresh pair, generate it **locally** (not on the server, and not in a chat session —
the private key should never pass through anywhere it could be logged):

```bash
ssh-keygen -t ed25519 -C claude-deploy -f ~/.ssh/womp_deploy
```

`~/.ssh/womp_deploy.pub` goes in `authorized_keys` above; `~/.ssh/womp_deploy` (the private key,
including the `-----BEGIN...` and `-----END...` lines) becomes the `DEPLOY_SSH_KEY` secret below.

### 3. Clone the repo

The path you choose here is what goes in `DEPLOY_PATH`.

```bash
git clone https://github.com/boxxykiller/womp-markets.git /opt/womp-markets
cd /opt/womp-markets
git checkout claude/eve-market-tracker-thami0    # or main, once it exists
```

For a private repo, either use a clone URL with a token or add a deploy key to the repository.

### 4. Create `.env`

`.env` is **not** in git — it holds the SSO secret, the database password and the session secret.
It lives only on the server and survives every deploy, because `git reset --hard` doesn't touch
untracked files.

```bash
cp .env.example .env
nano .env
```

Fill in at minimum:

| Variable | Value |
|---|---|
| `SITE_DOMAIN` | `womp.cottoncandygenocide.ca` |
| `LETSENCRYPT_EMAIL` | your email, for the certificate |
| `SESSION_SECRET` | `openssl rand -hex 32` |
| `POSTGRES_PASSWORD` | `openssl rand -hex 24` |
| `DATABASE_URL` | `postgresql://postgres:<that password>@localhost:5432/womp_markets` |
| `EVE_CLIENT_ID` / `EVE_CLIENT_SECRET` | from your EVE application |
| `EVE_REDIRECT_URI` | `https://womp.cottoncandygenocide.ca/EveCallback` |
| `NODE_ENV` | `production` |
| `ENABLE_LOCAL_ADMIN_LOGIN` | `false` |
| `ALLOWED_CORPORATION_IDS` | your corp id — **see the warning below** |
| `ADMIN_CHARACTER_NAMES` | your character name |

> **Leaving both allowlists empty lets any EVE character sign in.** Set
> `ALLOWED_CORPORATION_IDS` (and/or `ALLOWED_ALLIANCE_IDS`) before this is reachable publicly.

`DATABASE_URL` points at `localhost` because Postgres runs inside the same container as the app.

### 5. First start

```bash
docker compose up -d --build
docker compose logs -f app
```

Caddy requests a certificate on first request, so the initial HTTPS load may take a few seconds.

### 6. EVE application

At https://developers.eveonline.com/applications, the callback URL must be **exactly**
`https://womp.cottoncandygenocide.ca/EveCallback`. Required scopes:

```
publicData
esi-markets.structure_markets.v1
esi-universe.read_structures.v1
esi-search.search_structures.v1
```

## GitHub secrets

Repository → Settings → Secrets and variables → Actions. Same names as the main site:

| Secret | Value |
|---|---|
| `DEPLOY_HOST` | `155.138.213.76` |
| `DEPLOY_USER` | the SSH user whose `authorized_keys` you edited |
| `DEPLOY_SSH_KEY` | the **private** key, whole file including header/footer lines |
| `DEPLOY_PORT` | `22` |
| `DEPLOY_PATH` | `/opt/womp-markets` |

## How a deploy runs

`.github/workflows/deploy.yml` fires on every push to `main` or
`claude/eve-market-tracker-thami0`, and does:

```bash
cd $DEPLOY_PATH
git fetch origin <branch>
git reset --hard origin/<branch>
docker compose build
docker compose up -d --remove-orphans
docker image prune -f
```

`.github/workflows/ci.yml` runs lint, tests and build separately on pushes and pull requests. It
does **not** gate the deploy — same as the main site, a deploy goes out whether or not CI is green,
so watch that check if a commit is risky.

## Troubleshooting

**Certificate won't issue.** Caddy needs ports 80 and 443 reachable from the internet and
`SITE_DOMAIN` must match DNS exactly. `docker compose logs caddy`.

**`Host key verification failed` in the Action.** `appleboy/ssh-action` handles this itself; if it
appears, the key in `DEPLOY_SSH_KEY` is malformed — it must be the entire private key file, not a
single line.

**Deploy succeeds but the site is down.** `git reset --hard` doesn't remove untracked files, so a
stale `.env` or an orphaned container is the usual cause: `docker compose logs app`.

**Migrations.** `docker/entrypoint.sh` runs `prisma migrate deploy` on every container start, so a
schema change ships with the commit that adds it. Nothing manual.

**Database backups.** Postgres lives in the `pgdata` Docker volume. Nothing backs it up
automatically — the market history is only as durable as that volume:

```bash
docker compose exec app pg_dump -U postgres womp_markets | gzip > womp-$(date +%F).sql.gz
```
