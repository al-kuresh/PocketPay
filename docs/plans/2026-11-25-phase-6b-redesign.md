# Phase 6b: Kantha Redesign Implementation Plan

> **For Claude Code:** do the tasks in order. For each task: write the tests first where behaviour changes, run them and show they fail, implement, run them and show they pass, then `npm test`, `npm run lint`, `npm run typecheck`, `npm run build` in `client/` and `node design/check-tokens.mjs`. Stop and let the user review and commit. Don't commit or push.

**Goal:** replace the plain orange-template look with the approved **Kantha** direction, and change the money flow's confirm step to **hold to send**. No server changes.

**Approved design (the source of truth for the look):** the canvas "PocketPay redesign: Kantha direction" — https://claude.ai/artifact/WTDEQw9kWPbY6u2rsZjnii. It holds 4 phone screens (Home, Send Money amount, Confirm with hold-to-send, Sent) and notes on motion, type and the keypad. The user opens it and shares screenshots if Claude Code can't.

**Branch:** `feat/redesign`, from `main` after Phase 6 is merged.

## Global constraints
- **Everything from Phase 6 still holds**: money as BigInt/strings only, the access token in memory, i18n parity for every string, the Idempotency-Key rules, PIN never in state/URL/storage/logs, role/status guards, tokens only (`check-tokens` clean), 44 px tap targets, at most 4 font sizes and 2 weights per screen, WCAG AA contrast.
- **The signature detail is the Kantha running stitch**: an SVG stroke with `stroke-linecap: round` and a dash pattern (about `7 9`). One `Stitch` component draws it (rect, line, circle). It appears in exactly three places: the Home pocket, the hold-to-send button, and receipt tear lines. Nowhere else.
- **Colour:** the approved orange & white. `primary-dark #C2410C` carries the app bar, the pocket and primary buttons (white text 5.2:1). New token `thread #FED7AA` (stitches on orange; on white use `#FDBA74` / `#CBD5E1` as tokens). No gradients anywhere.
- **Type:** **Anek Bangla** (variable, width axis) for amounts and titles, **Hind Siliguri** for body. Both cover Latin and Bengali, so English and বাংলা share one family. Self-host them (Fontsource packages, verified official before installing); replace the Noto Sans Bengali setup. Amounts use the narrow width (about 80%) and `tabular-nums`.
- **Motion:** one signature moment (hold to send → the tick draws → the amount rises). Everything else is feedback to a touch: `active:scale-95`, 150 ms, `ease-out-quint`. Every animation is off under `prefers-reduced-motion`.
- **Screen transitions:** React's `<ViewTransition>` with React Router 8 (needs React/React DOM 19.3+; verify the installed versions and that the component is in the stable build before relying on it; if it isn't, use CSS-only transitions and say so). The amount is a shared element from the keypad screen to the confirm card and the success screen. Browsers without the View Transitions API just navigate.
- **3D tilt** of the Home pocket uses `DeviceOrientationEvent` **only** in a secure context, only when reduced motion is off, at most ±6°, and never asks for a permission prompt on load. On plain-http LAN it stays flat.

## Tasks

### Task 1: Foundation (tokens, fonts, Stitch, app bar, buttons)
**⚙️ high.** Update `design/TASTE.md` first (Kantha rules above; remove the old balance-card rules). Then:
- `index.css` `@theme`: the `thread` token(s), the font families, any missing size (e.g. the 64 px keypad amount) as tokens.
- Fonts: install and wire Anek Bangla + Hind Siliguri; drop `@fontsource/noto-sans-bengali` and its `@font-face` rules.
- `components/ui/Stitch.tsx`: `<Stitch shape="rect"|"line"|"circle" … />`, decorative (`aria-hidden`).
- `AppShell` bar and `Button` restyled to the canvas (bar height 64, title in Anek Bangla; primary `h-14 rounded-2xl`, secondary outlined).
- Tests: Stitch renders `aria-hidden` with round caps; the i18n parity and existing UI tests still pass.

### Task 2: Home (all three roles)
**⚙️ high.** The pocket hero: `primary-dark` block with rounded bottom, the stitched pocket around the balance (tap to reveal, unchanged behaviour), greeting with initials avatar and the language toggle. The action panel overlaps the pocket's lower edge (white, rounded-3xl, border). Recent list with initials chips (tinted by direction), amounts in Anek Bangla. The bottom nav restyled. The tilt (Global constraints) as a small hook `usePocketTilt()` with a test that it does nothing when `isSecureContext` is false or reduced motion is on.

### Task 3: The amount screen and keypad
**⚙️ high.** `AmountKeypad` (1–9, `.`, 0, delete) and quick chips (৳500, ৳1,000, ৳2,000) on the Enter step, with the receiver card above (lookup, masked name, Change). Rules:
- The keypad edits a string; the poisha value still comes **only** from `takaToPoisha` (max 2 decimals, Bangla digits shown in bn mode).
- A physical keyboard still works (desktop), and the phone keyboard never opens for the amount.
- The fee line ("No fee" / "Fee ৳5.00") comes from preview, not guessed on the client.
- Tests: typing via keypad and chips gives the right poisha; 3 decimals refused; delete; bn digits; keyboard input.

### Task 4: Confirm with hold to send (money logic)
**⚙️ extra-high.** Merge Preview and PIN into one **Confirm** screen like the canvas: the receipt-style card (receiver, amount, fee, note, the stitched tear line, total as the hero), the PIN boxes, and `HoldToSendButton`.
- **Hold**: pointer down starts a 1.2 s fill (pointer capture; let go or cancel resets), **Enter/Space held** does the same for keyboard users, `navigator.vibrate(30)` at 100 % when available. Only a completed hold submits. Under reduced motion the fill is instant-stepped but the hold time stays.
- **Idempotency unchanged**: the key is created when Confirm opens, kept across retries and unchanged edits, dropped only when receiver or amount changes; Back and every edit are disabled while the POST is pending. Every Phase 6 idempotency test must still pass (update only how they reach the button).
- Error routing as before (INVALID_PIN stays on Confirm with attempts left and the PIN cleared; NETWORK_ERROR → "Try again" with the same key; limit/balance errors shown on Confirm).
- Tests: a short press doesn't submit; a full hold submits once; releasing early cancels; keyboard hold submits; vibration called when available; all idempotency and error tests.

### Task 5: Sent screen, receipts and transitions
**⚙️ high.** The success screen like the canvas (stitched ring, the tick draws, the amount rises; New balance from `mine.balanceAfter`; Share with the existing fallbacks; Done). The receipt page (`/transactions/:trxId`) uses the same receipt card with the tear line. Add the `<ViewTransition>` shared amount (Global constraints). Tests: reduced motion removes the animations (class or style check); the receipt values.

### Task 6: Every other screen
**⚙️ high.** Login (demo buttons as Anek-titled cards), register steps, KYC banners, History (filters as chips, rows like Home), Profile, Change PIN, the agent and merchant homes, Cash In/Out and Payment (same TransferFlow). Same tokens and components; no new patterns.

### Task 7: Design loop, docs and the PR
**⚙️ high.** `/design-loop` on every screen in English and Bangla on the **LAN URL** (plain http), compared with the canvas. Docs: design.md §11 (the Kantha look, fonts, hold to send, transitions, tilt rules) and §15 (decisions); README screenshot placeholders stay for Phase 11. Run everything (client and server checks, check-tokens). The user tests on the S24 Ultra, then a fresh review, then the PR.

**Done when:** the app matches the canvas on a real phone in both languages, hold to send works by touch and keyboard, all tests pass, and the PR is reviewed and merged.
