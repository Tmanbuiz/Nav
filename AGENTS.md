# AGENTS.md: ChurchRide

Instructions for Codex and other coding agents. Read this first, then `docs/ROADMAP.md`. For anything in `mobile/`, also follow `mobile/AGENTS.md` (Expo rules: check the versioned SDK 58 docs, use `npx expo install`, never hand-edit `ios/` or `android/`).

## What this is

A personal iPhone app for one church driver. The church's system texts each transportation assignment (one rider per SMS, fixed template). ChurchRide reads the texts on the phone, holds every import in a review Inbox, then runs the day: stop order, Maps handoff, rider texts and calls, pickup statuses and return trips. An optional Cloudflare Worker uses Workers AI for texts the rules can't read.

## Layout

- `mobile/src/core/`: pure TypeScript logic, with no React Native or Expo imports, all unit-tested.
  - `parser/assignmentParser.ts`: the SMS rules
  - `importer.ts`: create, change, duplicate and notice decisions
  - `validate.ts`: manual and AI rides
  - `maps.ts`: Apple and Google links, call and text links
  - `route.ts`: ordering and estimates
  - `siri.ts`: the stop list published for Siri
  - `time.ts`, `labels.ts`
- `mobile/src/db/`: SQLite. `schema.ts` (versioned migrations), `settings.ts`, `repo.ts` (all SQL).
- `mobile/src/services/`: workflows that touch device APIs (geocoding and location, approval, AI client, backup). `intents.ts` applies queued Siri and Shortcuts actions; `app-intents.ts` drains the queue and publishes the stop list.
- `mobile/src/app/`: Expo Router screens. `mobile/src/components/`: UI pieces, including `app-intents-bridge.tsx`.
- `mobile/app-intents/`: Swift App Intents (Siri and the Shortcuts action), compiled into the iOS app as an Expo inline module through `expo-app-intents` (alpha).
- `worker/`: Cloudflare Worker (`src/index.ts` routes and auth, `src/extract.ts` Workers AI call and cleanup).

## Commands

```bash
# mobile/
npm test                 # Jest: core logic + storage tests on real SQLite (node:sqlite)
npx tsc --noEmit         # typecheck
npx expo lint            # lint
npx expo start           # run in Expo Go or a dev build

# worker/
npm test                 # Vitest inside the Workers runtime
npx tsc --noEmit
npm run types            # re-run after any wrangler.jsonc change
npx wrangler deploy --dry-run --outdir dist
```

Run the tests, typecheck and lint for every package you touched before calling a task done.

## Rules

1. **The repo is public. Never commit real rider data.** Tests and examples use made-up names, `+1506555xxxx` numbers and "Example Street" addresses.
2. **Never invent rider data.**
   - A missing value becomes `null` with an `error` issue. Anything uncertain gets a `review` issue.
   - Every import goes to the Inbox.
   - Only an explicit approve puts a ride on the run.
3. The SMS parser stays rule-based, offline and deterministic. When the church changes its wording, update `assignmentParser.ts` and add a test with a made-up copy of the new format.
4. `IssueCode` is the contract between parser, importer, validation and UI. Add new codes; don't change what an existing code means.
5. Database changes: append a migration to `MIGRATIONS` in `src/db/schema.ts`. Never edit a shipped migration.
6. All SQL lives in `src/db/repo.ts` and must be covered by `src/db/repo.test.ts`.
7. Keep `src/core/` free of React Native and Expo imports.
8. Worker:
   - no secrets in `wrangler.jsonc` (use `wrangler secret put`)
   - generate the `Env` type with `npm run types`; don't hand-write it
   - logs must never contain rider text or details
9. Build roadmap slices thin and end to end, and test on a real Sunday, before widening.
10. App Intents (`mobile/app-intents/*.swift`) reach JavaScript only through `expo-app-intents`, and the two sides must agree:
    - dispatch names and params (`addAssignmentText` with `text`; `setTripStatus` with `assignmentId`, `leg`, `status`) match `src/services/intents.ts`
    - the `stop` catalog's metadata keys match `src/core/siri.ts` and `ChurchRideStops.swift`
    - delivery is at least once, so each handler records the invocation ID in `processed_invocations` in the same transaction as its change
    - a dispatch is one-way: Swift can say an action was saved, never that JavaScript applied it
    - every App Shortcut phrase includes `\(.applicationName)`
    - CI can't compile Swift. Check Swift changes with an EAS build on a real iPhone.
