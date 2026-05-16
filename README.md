# Quick-Talk

Quick Talk is a fast, secure, and simple way to connect. Join a room to chat instantly with friends, or start a voice call with just one click.

## Koyeb deploy

This repo is prepared to deploy on Koyeb as a Docker-based Web Service.

### Koyeb setup

1. Push this repo to GitHub.
2. In Koyeb, create a new App from your GitHub repository.
3. Let Koyeb detect the `Dockerfile`.
4. Configure it as a public Web Service.
5. Expose port `8000` as HTTP.

### Koyeb environment variables

Add these in the Koyeb dashboard:

- `SECRET_KEY`: any long random string
- `DEBUG`: `false`
- `DATABASE_URL`: your hosted Postgres connection string
- `USE_REDIS`: `false`
- `TURN_CREDENTIALS_URL`: optional

Optional overrides:

- `ALLOWED_HOSTS`: leave unset unless you want to force your own list
- `CSRF_TRUSTED_ORIGINS`: leave unset unless you use a custom domain
- `TIME_ZONE`: defaults to `UTC`

Koyeb automatically provides `KOYEB_PUBLIC_DOMAIN`, and Django now uses that to allow the generated `*.koyeb.app` hostname.

### Start behavior

The container startup command will:

- run `migrate`
- run `collectstatic`
- start Daphne on Koyeb's `PORT`

### Database note

Koyeb can run this app, but you still need a Postgres database. If you do not want to pay for Koyeb Postgres, use an external Postgres provider and paste its connection string into `DATABASE_URL`.

### Free-tier note

For the free tier, this app is configured to use the in-memory Channels backend instead of Redis. That is the simplest and most stable setup for a single instance.

## Render deploy

This repo can also deploy on Render using:

- 1 free web service
- 1 free Render Postgres database
- 1 free Render Key Value instance for Django Channels / Redis

Files for that flow:

- `render.yaml`
- `.env.example`

## Local development

Without `DATABASE_URL`, the app falls back to:

- SQLite for the database
- in-memory Channels + cache for local development
