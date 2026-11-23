# ChurchRide roadmap

Updated 2026-11-23. This replaces the earlier 12-phase Codex roadmap with thin, end-to-end slices.

## Decisions

- **iPhone first.** Expo keeps the code cross-platform, but nothing Android-only gets built yet.
- **Everything on the phone.** SQLite, no accounts, no cloud database. Backup is an exported file.
- **Rules, not AI, for the church's texts.** They're one-rider-per-SMS from a fixed template, so on-device rules read them exactly, for free, offline. AI (Workers AI through our own Worker) is a fallback for unknown formats, and its results always need review.
- **Review before anything reaches the run.** Imports land in the Inbox, and approving is explicit.
- **Regulars.** Riders are matched by phone number. Their exact pickup spot is saved once, by standing at the door and tapping "Save where I am now".
- **Maps.** Apple Maps by default (multi-stop links, iOS 18.4+), Google Maps as an option. Neither reorders stops, so ChurchRide suggests the order and you can adjust it.
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

## Next

1. **Use it on a real Sunday.** Note anything the parser flags wrongly, and send a made-up copy of any new text format.
2. **Silent auto-import + Siri** with `expo-app-intents` (alpha):
   - an "Add assignment" action for the Message automation, so the app doesn't open and it works while the phone is locked
   - "Next stop" and "Picked up" Siri commands while driving
   - needs Swift intent definitions and a development build
3. **Share sheet.** Receive shared texts and screenshots from WhatsApp, Mail and Photos.
4. **Screenshot reading** with a Workers AI vision model in the Worker. Results go to review.
5. **Real drive times** through a routing API in the Worker. River crossings make straight-line estimates optimistic.
6. **Lock-screen Live Activity** during a run ("Next: … · 2 of 5").
7. **Backup restore.** Optional encrypted cloud backup (R2) only if needed. Also move the AI token into the iOS Keychain (`expo-secure-store`).
8. **Reports** (rides per month, km for reimbursement) if the church wants them.
9. **Android, later.** Import by reading notifications (catches SMS, RCS chat and WhatsApp).

## Open questions

- What do drivers update in the Church App? Should ChurchRide open it after each pickup?
- Does the church send change or cancellation texts, and how are they worded? The parser looks for "Cancelled" or "Updated" in the first line, which is a guess until we see one.
- Do the emailed assignments include the real Google Maps link? The SMS only has the words "View Location on Google Maps".
- One assignment came with a Vancouver, BC address for a local pickup. Worth telling the coordinator so the church's system can be fixed.
