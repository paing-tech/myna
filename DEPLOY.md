# Deploying to Google Cloud Run

The app needs ffmpeg and yt-dlp, so it deploys as a container (see `Dockerfile`),
not as a serverless Next.js app.

## One-time setup

1. Install the Google Cloud CLI: `brew install --cask google-cloud-sdk`
2. Sign in and pick the project:
   ```bash
   gcloud auth login
   gcloud config set project YOUR_PROJECT_ID
   ```
3. Turn on the services the deploy needs:
   ```bash
   gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com
   ```
4. Store the Gemini key as a secret, so it never sits in a command or a file:
   ```bash
   printf "YOUR_GEMINI_KEY" | gcloud secrets create gemini-api-key --data-file=-
   ```

## Deploy (run again for every update)

```bash
gcloud run deploy myna \
  --source . \
  --region asia-southeast1 \
  --allow-unauthenticated \
  --memory 2Gi \
  --cpu 1 \
  --timeout 900 \
  --max-instances 1 \
  --set-secrets GEMINI_API_KEY=gemini-api-key:latest
```

Why these settings:

- `asia-southeast1` (Singapore) is the closest region to Myanmar.
- `2Gi` memory: uploads and extracted audio live in RAM on Cloud Run, because
  its filesystem is in-memory. The 100 MB upload cap is sized against this.
- `timeout 900` gives a long upload plus transcription room to finish.
- `max-instances 1` keeps link playback working: the audio kept for the player
  lives on the instance that downloaded it.
- The first request after an idle spell takes a few seconds to start.

## Updating yt-dlp

Sites change often. Redeploying rebuilds the image and pulls the newest
yt-dlp release, so redeploy when links start failing.

## Costs

At a handful of users this sits inside the free allowance. Billing must be
enabled, so keep an eye on it for the first week — the app has no login and
no rate limit, so anyone with the URL can spend your Gemini credits.
