---
name: design-loop
description: Screenshot the running PocketPay web app with Playwright at phone size, score it against design/TASTE.md and design/references, fix the single worst category, repeat. Use when the user asks to polish, audit, or improve how a screen looks.
allowed-tools: Read, Edit, Write, Glob, Grep, Bash(node design/check-tokens.mjs:*), Bash(npm run lint:*), Bash(npm run build:*)
---

# Design loop (PocketPay)

Run on the screen the user names, at most 5 rounds. This loop only changes type, space, colour and
shape in `client/`. Do not add features, screens or copy. Do not touch `server/`, the API, or
the money logic.

## Setup, once

1. Read `design/TASTE.md`, the `@theme` block in `client/src/index.css`, and `docs/design.md`
   section 11.
2. Open every image in `design/references/`. These are the standard. Match their discipline, not
   their brand. `00-avoid-*` files are what to stay away from.
3. Make sure the app is running: `docker compose up -d`, then `cd server && npm run dev`, then
   `cd client && npm run dev` (http://localhost:5173, the home page shows "API status: ok").
   If navigation shows a connection error page, stop and tell the user. Never score an error page.
4. If the screen needs a login, use the seeded demo accounts or the "Try demo" buttons. Never type
   a real NID, real phone number or real PIN.
5. Playwright tools may ask for approval on first use. If they are missing, tell the user to run
   `claude mcp add playwright npx @playwright/mcp@latest` and `npx playwright install chromium`.

## Each round

1. Navigate with Playwright. Before screenshotting, wait for the screen's main heading to be
   visible, then wait 300ms. If the page is blank, read the console output and report the error
   instead of retrying.
2. Screenshot at 390x844 (primary, the design width) and at 1440x900 (checks the centred phone
   frame). Save to `design/screenshots/round-N-phone.png` and `round-N-desktop.png`.
3. Open both screenshots and look at them.
4. Measure before you score. Use Playwright to read computed values: font sizes, weights in use,
   gaps between sections, tap-target heights, radii, shadows, and text/background colours.
5. Score each category out of 5, with one sentence of evidence that cites a measured value. No
   score without evidence.
   - Type: a real hierarchy, or sizes that are all nearly the same?
   - Rhythm: are gaps on the spacing steps, with air where it matters?
   - Restraint: how many colours, weights, radii and shadow levels are in play?
   - Alignment: everything on a shared edge, or close-but-not?
   - Focus: exactly one primary action, in the thumb zone?
   - Touch: every tap target at least 44px; inputs at least 16px text?
   - Money clarity: is the amount the hero, with the ৳ sign, `tabular-nums`, and fee and total
     visible before the PIN?
6. Take the single lowest score. Fix only that. Before editing, say what you are changing and
   which token or Tailwind class you are changing it to.
7. Re-screenshot and re-score. If the score did not move, revert the change and try a different
   fix. Do not stack failed fixes.

## Finish

- Stop when every category is 4 or higher, or after 5 rounds.
- From the repo root run `node design/check-tokens.mjs` and fix every finding. If no token fits,
  say so and stop rather than inventing a value.
- Then `cd client && npm run lint && npm run build` and fix anything they report.
- Print a table of round-by-round scores. Say the scores are your own judgement and rough, and
  point to the screenshots.
