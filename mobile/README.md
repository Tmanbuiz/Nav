# ChurchRide (mobile)

The iPhone app. Setup, build and install steps are in the [main README](../README.md). Coding rules are in [`AGENTS.md`](../AGENTS.md) and, for Expo specifics, [`mobile/AGENTS.md`](AGENTS.md).

```bash
npm install
npx expo start     # Expo Go or a dev build
npm test           # core logic + storage tests
npx tsc --noEmit
npx expo lint
```
