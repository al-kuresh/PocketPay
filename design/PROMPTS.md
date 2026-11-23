# PocketPay design prompts

Run these in Claude Code from the repo root. Each prompt notes the effort level to set.

## 0. Playwright (once, so Claude can see its own work)

```bash
claude mcp add playwright npx @playwright/mcp@latest
npx playwright install chromium
```

Restart Claude Code, run `/mcp`, and confirm `playwright` is connected. On Linux you may also need
`npx playwright install-deps` (it asks for sudo).

## 1. Check the kit works (effort: high)

```
Run `node design/check-tokens.mjs` and tell me what it reports. Then run
`cd client && npm run lint && npm run build`. Do not fix anything yet. I want to see the list.
```

Expected: the scaffold page in `client/src/App.tsx` is reported for `shadow-sm` and for
`text-success` used as small text. Fix those when you replace that page with real screens.

## 2. Turn a reference into rules (effort: high)

Screenshot a screen you like (phone size) into `design/references/`, then:

```
Read these screenshots. I want the design rules behind them, not a description.

Produce design/references/<name>-DESIGN.md with these sections and nothing else:

## Typography
Sizes you can see (px), line heights (unitless), weights and where each appears.
## Spacing
Base unit, gaps between sections, padding inside cards and buttons, page margins.
## Colour
Roles, not names, with hex. Mark estimates "approx".
## Shape and depth
Radii and which components get them, border widths, shadows as CSS (or "none").
## Layout
Bottom nav, header, action grid, list rows: how each is built.
## Rules
Ten short imperative rules that would let someone rebuild this look without seeing it.
## Do not copy
Three things specific to their brand that would look wrong on PocketPay.

Where you are inferring rather than measuring, write (inferred). Do not fill gaps with
plausible values. Then map what is useful to Tailwind classes and the tokens in
client/src/index.css. Do not change index.css yet. Propose changes first.
```

## 3. Five Home screens, then converge (effort: extra-high)

```
Read design/TASTE.md, docs/design.md section 11, and the references first.

Build five structurally different versions of the Customer Home screen as components in
client/src/dev/variants/ (HomeV1.tsx to HomeV5.tsx), with mock data and a dev-only switcher
(?variant=1 to 5) in App.tsx. No new dependencies. Tokens and Tailwind classes only.

Every version has: balance (tap to reveal), the four actions (Send Money, Cash Out, Payment,
History), five recent transactions, and the bottom nav (Home, History, Profile). They must differ
in STRUCTURE, not colour:
  1  balance card on top, 2x2 action grid, transactions below
  2  big amount on the plain page (no card), actions as a single row of pills
  3  compact header bar with the balance, large 4-up action row under it
  4  action grid first, balance as a slim strip, longer transactions list
  5  balance card that overlaps the header bar, actions inside the card

One primary action per version. Use Playwright to screenshot all five at 390x844 into
design/screenshots/variants/ and show me them. Then stop and wait for me to pick one.
```

After you pick one: ask for four variations of it only (spacing rhythm, amount size, action
styling, transaction row density), same screenshot pass. Then delete `client/src/dev/` before
committing.

## 4. Polish a built screen (effort: high)

```
/design-loop the <screen name> screen
```

## 5. When Claude ignores the system

1. Tokens are not applying: `client/src/index.css` must be imported in `main.tsx` (it is).
2. The rule only exists in an old chat message. It must be in `CLAUDE.md` or `design/TASTE.md`.
3. Make it checkable: "Before you finish, run `node design/check-tokens.mjs`. Fix every finding.
   If no token fits, tell me and stop."
