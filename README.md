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
2. A Shortcut sends the texts to ChurchRide automatically. You can also paste them, or share texts and screenshots from another app. The app reads every field on the phone, with no AI and no internet needed: name, phone, number of persons, date, pickup window, one-way or two-way, and address.
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
6. While driving, ask **Siri** for the next stop and tell it when someone is picked up, without touching the phone.

## Try it now with Expo Go (no build needed)

You need Node 22 or later on your computer and the **Expo Go** app on your iPhone.

```bash
cd mobile
npm install
npx expo start
```

Scan the QR code with the iPhone camera. Expo Go is good for checking the screens, paste import, storage and the Maps links. The Shortcut action, the `churchride://` link, Siri and the share sheet only work in your own build (next section).

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

The share sheet adds a small extension to the app (`com.wiantribe.churchride.ShareExtension`) and an App Group (`group.com.wiantribe.churchride`) that it uses to pass shares to the app. On the first build, sign in to your Apple account when EAS asks, so it can register both for you.

## First-time setup in the app

Open **Settings** and fill in:

- **Your name** exactly as the church's texts write it.
- **Church address**, then tap **Find on map**. Routes end at the church.
- **Rider seats** in your car.
- **Start address** (optional). Only used for the leave-by estimate.
- **Maps**: Apple Maps or Google Maps. Apple Maps needs iOS 18.4 or later for routes with several stops.

## Auto-import from Messages (Shortcuts)

This needs your own build of the app, not Expo Go.

1. Save the church's texting number as a contact.
2. In the Shortcuts app, go to **Automation** and tap **+**. Choose **Message**, set Sender to that contact, and pick **Run Immediately**.
3. Add the ChurchRide action **Add Assignment Text** and set Text to the Shortcut Input (the message).

New assignment texts are then saved quietly, without opening the app and even while the phone is locked. They show up in the Inbox, for review, the next time you open ChurchRide. Each text waits in a queue on the phone until then and is imported only once.

The older way still works, but it opens the app for every text: **URL Encode** the Shortcut Input, then **Open URLs** with `churchride://import?text=` followed by the URL Encoded Text.

## Share texts and screenshots

This also needs your own build. In WhatsApp, Mail, Photos or any app with a Share button, tap **Share** and choose **ChurchRide**. You can share up to 10 screenshots at once.

- ChurchRide opens on the import screen and adds what it found to the Inbox, for review.
- Screenshots are read on the phone with Apple's text recognition. Nothing is uploaded, and the pictures aren't kept.
- Text read from a picture can be misread, so those rides are marked **From a screenshot**. Check the name, phone number, time and address against the picture before you approve.
- A screenshot never overwrites details you already have. It can only fill in what a saved ride is missing, for example after an earlier screenshot cut a text off. If it shows different details, you get a notice in the Inbox saying what differs, so you can compare and edit the ride yourself.
- If ChurchRide doesn't open after you share, open it and tap **Add texts** in the Inbox. Whatever you shared is waiting there.

## Siri while driving

This also needs your own build. The phrases work as soon as the app is installed; Siri knows your stops once you've approved rides in the app.

- **"Hey Siri, next stop in ChurchRide"** says who and where is next, the pickup window, and how many stops are left. On a day without rides, it tells you when the next ones are.
- **"Hey Siri, picked up in ChurchRide"** (or **"dropped off in ChurchRide"** after service) marks the current stop done. Siri moves on to the next stop straight away, and the app's list catches up the next time it opens. If you change that stop in the app afterwards, the app's change wins.

## Optional: AI reading on Cloudflare

For texts in a format ChurchRide doesn't know, the app can ask your own Cloudflare Worker, which uses Workers AI. Deploy steps are in [`worker/README.md`](worker/README.md). After deploying, paste the Worker URL and token into **Settings → AI reading**.

## Privacy

- Rider details stay on the phone (SQLite). There are no accounts and no cloud database.
- **This repo is public.** Never commit real rider names, numbers or addresses. The tests use made-up data.
- AI reading only runs when you tap **Read with AI** on a text. That text goes only to your Worker and Workers AI. The Worker logs counts and timings, never the text.
- Shared screenshots are read on the phone and deleted once imported. Only the text read from them is kept, with the ride.
- For Siri, the app keeps a short list of the next run's stops (names, addresses, pickup windows) in the phone's app storage. It's hidden from Spotlight.
- Siri answers while the phone is locked, so it works hands-free, but someone holding your locked phone could also ask it for the next stop. To require Face ID first, add `static let authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication` to `NextStopIntent` and `MarkStopDoneIntent` in `mobile/app-intents/`.
- **Settings → Export backup** writes a file with rider details (but not the AI token). Keep it private.

## Development

```bash
cd mobile && npm test && npx tsc --noEmit && npx expo lint
cd worker && npm test && npx tsc --noEmit
```

GitHub Actions runs the same checks on every pull request. They don't compile the Swift in `mobile/app-intents/` and `mobile/screenshot-text/`; an EAS build does.
