# ChurchRide AI Worker

Reads assignment texts that the app's on-device parser can't, using **Workers AI** (Llama 3.3 70B in JSON mode). No outside AI provider or key is involved.

- `GET /v1/health` returns `{ ok, ai, model }`
- `POST /v1/extract` with `{ "text": "…" }` returns `{ "assignments": [...] }`

Every request needs `Authorization: Bearer <APP_TOKEN>`. Requests are rate-limited to 20 a minute per IP and bodies are capped at 16 KB. Logs record counts and timings only, never the text or rider details. Everything the AI returns is cleaned, and anything not plainly in the text comes back `null`. The app puts the results in review.

## Deploy

Pick one.

**A. From GitHub, in the Cloudflare dashboard.** Every push to `main` redeploys.

1. Go to **Workers & Pages → Create → Import a repository** and pick `Tmanbuiz/Nav`.
2. Set **Root directory** to `worker` and **Deploy command** to `npx wrangler deploy`.
3. Deploy.

**B. From your computer**

```bash
cd worker
npm install
npx wrangler login
npx wrangler deploy
```

## Set the app token

Make a long random token:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Add it as a secret named `APP_TOKEN`, either in the dashboard (**your Worker → Settings → Variables and Secrets → Add → Secret**) or with:

```bash
npx wrangler secret put APP_TOKEN
```

## Connect the app

In ChurchRide, go to **Settings → AI reading**. Enter the Worker URL (shown after deploying, like `https://churchride-ai.<your-subdomain>.workers.dev`) and the token, then tap **Test connection**.

## Notes

- To use a different Workers AI model, change `vars.AI_MODEL` in `wrangler.jsonc`, then run `npm run types`. TypeScript will tell you if the new model takes different inputs.
- Workers AI usage counts against your account's Workers AI allowance. Reading a few texts a week is very light.
- Workers Logs and Traces are on. Open them from the Worker's **Observability** tab in the dashboard.

## Develop

```bash
npm install
npm test          # runs inside the Workers runtime with a stand-in model
npx tsc --noEmit
```
