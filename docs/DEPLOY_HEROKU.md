# Deploy Veyra to Heroku

Veyra runs on Heroku as one app: one container, one Eco dyno, one Postgres database. The container runs the Next.js web server on Heroku's port and the FastAPI backend inside the same container. Heroku builds it from `Dockerfile` and `heroku.yml`. You do not need Docker on your computer.

Cost: Eco dynos $5/month plus Heroku Postgres Essential-0 about $5/month. Platform credits pay this first.

Use synthetic data only until the items in `docs/SECURITY_REVIEW.md` are closed.

## What gets created

| Piece | What it is |
| --- | --- |
| App | A Heroku app, for example `veyra-demo`. Its address is `https://veyra-demo-xxxx.herokuapp.com`. |
| Dyno | The running container. Eco dynos sleep after 30 minutes without visits and wake on the next visit in a few seconds. |
| Postgres add-on | The database. Heroku sets `DATABASE_URL` for you. |
| Release phase | Before each new version goes live, Heroku runs `alembic upgrade head` to update the database tables. |
| Config vars | Settings such as the secret key, set in the dashboard. |

## Before you start

1. Sign in at https://dashboard.heroku.com.
2. Account settings, Billing: add a credit card. Heroku requires one for paid resources even when credits cover the bill.
3. On the same page, click Subscribe to Eco.

## Option A: one-click deploy (easiest)

1. Open https://www.heroku.com/deploy?template=https://github.com/vishanthashok/Veyra
2. App name: type a name, for example `veyra-demo`. Region: United States.
3. Config vars:
   - `VEYRA_DEMO_PASSWORD`: type a password you will use to sign in. At least 12 characters.
   - Leave the others as filled in. `VEYRA_SECRET_KEY` is generated for you.
4. Click Deploy app. The first build takes 5 to 10 minutes.
5. When it finishes, click Manage App.
6. Load the demo property: top right, More, Run console. Type the command below and click Run.

   ```
   python -m app.demo_seed
   ```

   It ends with `Sign in as demo@veyra.local / <your password>`.
7. Click Open app. Sign in with `demo@veyra.local` and your `VEYRA_DEMO_PASSWORD`.

Turn on automatic deploys so every merge to `main` updates the site:

1. In the app, open the Deploy tab.
2. Deployment method: GitHub. Connect your GitHub account, search for `Veyra`, click Connect.
3. Automatic deploys: choose `main`, check Wait for CI to pass, click Enable Automatic Deploys.

## Option B: command line

Install the Heroku CLI: https://devcenter.heroku.com/articles/heroku-cli. On a Mac with Homebrew:

```bash
brew tap heroku/brew && brew install heroku
```

Then, from the repository folder:

```bash
heroku login
```

```bash
heroku create veyra-demo --stack container
```

```bash
heroku addons:create heroku-postgresql:essential-0 -a veyra-demo
```

```bash
heroku config:set -a veyra-demo VEYRA_ENV=production VEYRA_COOKIE_SECURE=true VEYRA_SECRET_KEY=$(openssl rand -hex 32) VEYRA_DEMO_PASSWORD='choose-a-password'
```

```bash
git push heroku main
```

```bash
heroku ps:type eco -a veyra-demo
```

```bash
heroku run -a veyra-demo python -m app.demo_seed
```

```bash
heroku open -a veyra-demo
```

## Everyday tasks

| Task | Dashboard | CLI |
| --- | --- | --- |
| See logs | More, View logs | `heroku logs --tail -a veyra-demo` |
| Restart | More, Restart all dynos | `heroku restart -a veyra-demo` |
| Change a setting | Settings, Reveal Config Vars | `heroku config:set NAME=value -a veyra-demo` |
| Deploy a new version | Deploy tab, Deploy Branch | `git push heroku main` |
| Check spend | Account settings, Billing | n/a |

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| Application error page right after deploy | Open the logs. `Unsafe production configuration` means `VEYRA_SECRET_KEY` is shorter than 32 characters or `VEYRA_COOKIE_SECURE` is not `true`. |
| Release failed | The database migration failed. The logs show the Alembic error. The previous version stays live. |
| Sign in says invalid email or password | Run the demo seed (step 6). It creates the user. To change the password, set `VEYRA_DEMO_PASSWORD` and run the seed again. |
| First visit takes a few seconds | The Eco dyno was asleep. Use a Basic dyno ($7/month) to keep it awake: Resources tab, change dyno type. |
| `R14 Memory quota exceeded` in logs | The 512 MB Eco dyno is too small for the load. Move to a Basic or Standard-1X dyno. |
| Build fails at `pnpm install` or `uv sync` | A lockfile is out of date. Run `pnpm install` in `frontend/` or `uv lock` in `backend/`, commit and push. |

## How it fits together

- `Dockerfile` builds the Next.js app with the API address set to `http://127.0.0.1:8000`, then copies it and the backend into one Python image.
- `deploy/start.sh` starts the API on 127.0.0.1:8000 and the web server on `$PORT`. If either stops, the dyno exits and Heroku restarts it.
- The browser only talks to Next.js. Next.js forwards `/api/*` to the API, so the session cookie stays first party.
- The API trusts `X-Forwarded-For` only from the local proxy, so the login rate limit sees the visitor IP that the Heroku router appends.
- `backend/app/config.py` reads Heroku's `DATABASE_URL` when `VEYRA_DATABASE_URL` is not set and switches `postgres://` to the psycopg driver.
- `app.json` describes the app for the one-click deploy: container stack, Eco dyno, Postgres add-on and config vars.

## Limits

- One dyno only. The login rate limiter keeps its counters in memory, so more dynos need a shared store first (see `docs/SECURITY_REVIEW.md`).
- Essential-0 Postgres has no point-in-time recovery. Take a manual backup with `heroku pg:backups:capture -a veyra-demo` before changes you care about.
