# ChurchRide roadmap

Updated 2026-11-23. This replaces the earlier 12-phase Codex roadmap with thin, end-to-end slices.

## Decisions

- **iPhone first.** Expo keeps the code cross-platform, but nothing Android-only gets built yet.
- **Everything on the phone.** SQLite, no accounts, no cloud database. Backup is an exported file.
- **Rules, not AI, for the church's texts.** They're one-rider-per-SMS from a fixed template, so on-device rules read them exactly, for free, offline. AI (Workers AI through our own Worker) is a fallback for unknown formats, and its results always need review.
- **Review before anything reaches the run.** Imports land in the Inbox, and approving is explicit.
- **Regulars.** Riders are matched by phone number. Their exact pickup spot is saved once, by standing at the door and tapping "Save where I am now".
- **Maps.** Apple Maps by default (multi-stop links, iOS 18.4+), Google Maps as an option. Neither reorders stops, so ChurchRide suggests the order and you can adjust it.
- **Siri and Shortcuts through `expo-app-intents` (alpha).** Swift intents can't call JavaScript directly, so they queue each action on the phone and the app applies it the next time it runs, exactly once. Siri reads the run from a small stop list the app publishes, so it can answer while the app is closed.
- **Share sheet through `expo-sharing`'s share extension (experimental).** It saves what was shared and opens the app, which imports it. Screenshots are read on the phone with Apple's Vision framework instead of a cloud AI model: it's private, free and works offline. Text from a picture is trusted less: its rides are flagged, and it never overwrites a saved value.
- **Safety checks:**
  - a building instead of a street address
  - an address in another province, or a pickup more than 60 km from the church (held once, until approved again)
  - more riders than seats
  - changed times and cancellations
  - texts addressed to another driver

## Done (v1)

- **Run screen:** seats, suggested order, leave-by and arrival estimates, a route ending at church, call and quick texts, picked up / no-show, manual reordering, return trips after service.
- **Import:**
  - paste one or many texts
  - `churchride://import?text=…` link for a Shortcuts Message automation
  - duplicates skipped, and the newest copy wins
  - changes go back to review
  - cancellations and updates become notices
- **Review Inbox:** flags, edit, approve, approve-all-clean, discard. Rides can also be entered by hand.
- **Riders:** notes, saved pickup spot, ride history.
- **Settings:** church and start addresses (geocoded), seats, Maps app, quick-text wording, Shortcut setup, AI connection test, backup export.
- **Cloudflare Worker:** `/v1/extract` with Workers AI JSON mode, token auth, rate limit, structured logs without rider data.
- **Tests:**
  - parser, importer, validation, maps, routing and time
  - the storage layer on real SQLite
  - the Worker inside the Workers runtime

## Built, waiting for a test on the iPhone (v2)

- **Silent auto-import:** the Shortcuts action "Add Assignment Text" for the Message automation. The app doesn't open, it works while the phone is locked, and texts land in the Inbox for review.
- **Siri while driving:** "Next stop in ChurchRide" and "Picked up in ChurchRide" / "Dropped off in ChurchRide".
- **Tests:** each action applies once even when delivered twice; the stop list Siri reads.
- The Swift hasn't been compiled yet: CI can't, so the first EAS build is the check.

## Built, waiting for a test on the iPhone (v3)

- **Share sheet:** share texts, or up to 10 screenshots, from WhatsApp, Mail, Photos or any app. They're imported into the Inbox for review.
- **Screenshot reading on the phone:** rides from pictures are marked "From a screenshot". A picture that differs from a saved ride becomes a notice saying what differs; it can only fill in details the ride is missing.
- **Tests:** sorting what's shared, a share arriving mid-import, screenshot flags and notices, storage of notice details.
- Needs the first EAS build to register the App Group and compile the Swift text reader.

## Next

1. **Use it on a real Sunday,** with an EAS build on the iPhone:
   - Note anything the parser flags wrongly, and send a made-up copy of any new text format.
   - Check that the Message automation runs while locked, and that Siri hears "ChurchRide" reliably.
   - Share a screenshot of a real assignment text and check how well it's read.
2. **Real drive times** through a routing API in the Worker. River crossings make straight-line estimates optimistic.
3. **Lock-screen Live Activity** during a run ("Next: … · 2 of 5").
4. **Backup restore.** Optional encrypted cloud backup (R2) only if needed. Also move the AI token into the iOS Keychain (`expo-secure-store`).
5. **Reports** (rides per month, km for reimbursement) if the church wants them.
6. **Android, later.** Import by reading notifications (catches SMS, RCS chat and WhatsApp). `expo-sharing` already supports Android share intents when this comes.

## Open questions

- What do drivers update in the Church App? Should ChurchRide open it after each pickup?
- Does the church send change or cancellation texts, and how are they worded? The parser looks for "Cancelled" or "Updated" in the first line, which is a guess until we see one.
- Do the emailed assignments include the real Google Maps link? The SMS only has the words "View Location on Google Maps".
- One assignment came with a Vancouver, BC address for a local pickup. Worth telling the coordinator so the church's system can be fixed.
