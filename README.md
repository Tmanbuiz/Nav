# ChurchRide

A personal iPhone app for church transportation runs. It turns the church's assignment texts into a checked pickup list, opens the route in Apple Maps or Google Maps, and gives you one-tap texts and calls to each rider.

| Folder | What it is |
| --- | --- |
| [`mobile/`](mobile) | The iPhone app (Expo SDK 58, React Native, TypeScript). Everything is stored on the phone. |
| [`worker/`](worker) | Optional Cloudflare Worker that reads texts the app can't, using Workers AI. |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | What's built, what's next, and the decisions behind it. |
| [`AGENTS.md`](AGENTS.md) | Rules for Codex and other coding agents working in this repo. |

## How it works

1. The church's system texts you each assignment (one text per rider).
2. You paste the texts into ChurchRide, or a Shortcut sends them automatically. The app reads every field on the phone, with no AI and no internet needed: name, phone, number of persons, date, pickup window, one-way or two-way, and address.
3. Everything lands in the **Inbox** first. Anything odd is flagged before it can reach your run:
   - a building name instead of a street address
   - an address in another province, or far from the church
   - a date that has passed, or a text addressed to another driver
   - a changed pickup time, or a cancellation
4. **Approve** a ride and it joins that day's run. The rider is saved under **Riders** with notes and, once you've been there, their exact pickup spot.
5. **Today** shows:
   - seats used against your car's seats
   - a suggested stop order, with leave-by and arrival estimates
   - **Start route**: every pickup in order, ending at church, in Maps
   - per stop: **Call**, **On my way**, **I'm outside**, **Picked up** and **No-show**
   - the trips home after service

## Try it now with Expo Go (no build needed)

You need Node 22 or later on your computer and the **Expo Go** app on your iPhone.

```bash
cd mobile
npm install
npx expo start
```

Scan the QR code with the iPhone camera. Expo Go is good for checking the screens, paste import, storage and the Maps links. The `churchride://` link the Shortcut uses only works in your own build (next section).

## Put it on your iPhone (EAS + TestFlight)

Your Apple Developer membership is enough: Expo builds in the cloud, so you don't need a Mac.

```bash
cd mobile
npx eas-cli@latest login
npx eas-cli@latest init                       # links the project to your Expo account
npx eas-cli@latest build -p ios --profile production
npx eas-cli@latest submit -p ios --latest     # sends the build to TestFlight
```

Then install ChurchRide from the TestFlight app. The bundle ID is `com.wiantribe.churchride`. Change it in `mobile/app.json` before the first build if you want a different one.

## First-time setup in the app

Open **Settings** and fill in:

- **Your name** exactly as the church's texts write it.
- **Church address**, then tap **Find on map**. Routes end at the church.
- **Rider seats** in your car.
- **Start address** (optional). Only used for the leave-by estimate.
- **Maps**: Apple Maps or Google Maps. Apple Maps needs iOS 18.4 or later for routes with several stops.

## Auto-import from Messages (Shortcuts)

1. Save the church's texting number as a contact.
2. In the Shortcuts app, go to **Automation** and tap **+**. Choose **Message**, set Sender to that contact, and pick **Run Immediately**.
3. Add the action **URL Encode** and set it to the Shortcut Input (the message).
4. Add **Open URLs** with `churchride://import?text=` followed by the URL Encoded Text.

New assignment texts then open ChurchRide and land in the Inbox. If the phone is locked, the import finishes when you unlock it. A silent version that doesn't open the app (App Intents) is next on the roadmap.

## Optional: AI reading on Cloudflare

For texts in a format ChurchRide doesn't know, the app can ask your own Cloudflare Worker, which uses Workers AI. Deploy steps are in [`worker/README.md`](worker/README.md). After deploying, paste the Worker URL and token into **Settings → AI reading**.

## Privacy

- Rider details stay on the phone (SQLite). There are no accounts and no cloud database.
- **This repo is public.** Never commit real rider names, numbers or addresses. The tests use made-up data.
- AI reading only runs when you tap **Read with AI** on a text. That text goes only to your Worker and Workers AI. The Worker logs counts and timings, never the text.
- **Settings → Export backup** writes a file with rider details (but not the AI token). Keep it private.

## Development

```bash
cd mobile && npm test && npx tsc --noEmit && npx expo lint
cd worker && npm test && npx tsc --noEmit
```

GitHub Actions runs the same checks on every pull request.
