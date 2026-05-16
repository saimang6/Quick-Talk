# Quick-Talk

Quick Talk is a fast, secure, and simple way to connect. Join a room to chat instantly with friends, or start a voice call with just one click.

## Render deploy

This repo is now prepared for a Render Blueprint deploy using:

- 1 free web service
- 1 free Render Postgres database
- 1 free Render Key Value instance for Django Channels / Redis

### Files added for deployment

- `render.yaml` provisions the Render services
- `.env.example` shows the environment variables used by Django
- `ChatProject/settings.py` now reads `DATABASE_URL`, `REDIS_URL`, and Render host settings from the environment

### Deploy steps

1. Push this repo to GitHub.
2. In Render, create a new Blueprint and point it at this repo.
3. Let Render create the resources from `render.yaml`.
4. After the first deploy finishes, open the generated `onrender.com` URL.

### Important free-tier limits

- Free web services spin down after inactivity, so the first request can be slow.
- Free Render Postgres is temporary and has free-tier limits.
- Free Render Key Value is in-memory only, so Redis data can be lost on restart.
- Uploaded media files are stored on Render's ephemeral filesystem and can disappear on redeploy unless you move them to object storage later.

### Local development

Without `DATABASE_URL` and `REDIS_URL`, the app falls back to:

- SQLite for the database
- in-memory Channels + cache for local development
