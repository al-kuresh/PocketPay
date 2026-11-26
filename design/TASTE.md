# Taste: PocketPay (Kantha)

## Read this before writing any UI

1. Open every `design/references/kantha-*.png` (Home, Send Money amount, Confirm with hold to send,
   Sent). They are screenshots of the approved canvas "PocketPay redesign: Kantha direction"
   (https://claude.ai/artifact/WTDEQw9kWPbY6u2rsZjnii) and are the source of truth for the look.
   The other images and `REFERENCES-DESIGN.md` are the older wallet references: use them for flows
   only. Where a reference and this file disagree, this file wins.
2. Tokens live in the `@theme` block of `client/src/index.css`. The spec is `docs/design.md`
   section 11 (palette, screens) and section 6.3 (the money-flow steps).
3. After editing UI, run `node design/check-tokens.mjs` and fix what it reports.

## What PocketPay looks like

- A trustworthy wallet, not a fintech landing page. Calm, clear, fast. Orange and white: orange is
  the brand, white and slate do the work.
- The one signature detail is the **Kantha running stitch** (the hand stitch of a Bengali kantha
  quilt). Everything else stays quiet so the stitch reads as craft, not decoration.
- Designed at 390px wide. On desktop the app sits in a centred phone-width frame (`MobileShell`).
  The admin panel uses a wider layout.
- One primary action per screen: a full-width filled button at the bottom, in the thumb zone.
- The amount is the hero. On any screen that shows money, the money is the biggest thing.
- Borders and whitespace do the work that shadows and decoration usually do.

## The Kantha stitch

- Drawn only by `components/ui/Stitch.tsx` (`shape="rect" | "line" | "circle"`): an SVG stroke with
  round caps and a `7 9` dash. It is decorative (`aria-hidden`); never the only carrier of meaning.
- It appears in exactly four places: the Home pocket around the balance, the hold-to-send button,
  receipt tear lines (Confirm, Sent, the receipt page), and the ring around the tick on the Sent
  screen. Nowhere else: not on cards, dividers, inputs or empty states. A fifth use needs asking
  first.
- Thread colours: `stroke-thread` on orange (the pocket, the Sent ring), `stroke-thread-dark` on
  white or `primary-50`, `stroke-thread-muted` for the tear line on a white card.

## Money display

- Format every amount through ONE helper (`client/src/lib/money.ts`). The API sends poisha as
  strings (`"150050"` = ৳1,500.50), so use BigInt maths, never floats.
- Output looks like `৳1,500.50` with a `৳` prefix. Use lakh grouping (`৳12,34,567.50`) via
  `en-IN` grouping. Do not use `Intl` currency style with `en-BD`: it prints `BDT 1,234,567.50`.
- Hero amounts (balance, keypad amount, Confirm total, Sent amount) use `font-amount`: Anek Bangla
  at its narrow width (80%) with `tabular-nums`. Amounts in lists and rows use `font-display
  tabular-nums`. Every TrxID and phone number gets `tabular-nums` too.
- Money in: `+৳500` in `text-success-dark`. Money out: `−৳500` in `text-danger`. The sign always
  carries the meaning, colour is never the only signal.
- The balance is hidden by default (`৳ ••••`) and revealed on tap.
- Confirm always shows receiver, amount, fee (and note) before the PIN, as one receipt-style card:
  the receiver on top, then the rows, the stitched tear line, and the total as the hero amount.

## Colour

- `primary-dark` carries the app bar, the Home pocket, primary buttons, links, the active tab and
  the focus ring. White text and icons on it are 5.2:1, so small white text is fine there. Plain
  `primary` is for large text (24px and up) and icons on white. `primary-light` is never behind
  small text.
- `<meta name="theme-color">` in `client/index.html` matches `primary-dark`, so the phone's browser
  bar is the same orange as the app bar. Change both together.
- Status as TEXT: `success-dark`, `danger`, `warning-dark`. Base `success` and `warning` are for
  icons, fills and badge backgrounds only (they fail AA as small text).
- Input outlines use `border-strong`. `border` is for dividers and card outlines.
- Secondary text is `text-muted`. On `primary-50` backgrounds use `text` instead (4.5:1 limit).
- Every text/background pair meets WCAG AA (4.5:1 small text, 3:1 large text and UI outlines).
- No default Tailwind palette (`bg-orange-500`, `text-gray-600`), no `bg-[#...]`. `text-white`,
  `bg-white`, `transparent` and `current` are fine.

## Type and space

- Two families, both self-hosted from Fontsource and both covering Latin and Bangla, so English
  and বাংলা share one look:
  - `font-display` (Anek Bangla, variable with a width axis): amounts, the app-bar title, screen
    titles, the keypad keys (`text-xl font-semibold`).
  - `font-sans` (Hind Siliguri, the default): everything else.
- Only amounts get the narrow width (`font-amount`). Titles use `font-display` at normal width with
  no letter spacing. Anek's own word space is narrow (0.17 em vs Hind's 0.24 em), so titles look
  tighter than body text; that is the font, not a bug. Don't add negative tracking or narrow them.
- Sizes: `text-xs`, `text-sm`, `text-base`, `text-lg`, `text-xl`, `text-3xl`; `text-4xl` for the
  Home balance, Confirm's total and the receipt page amount; `text-hero` (64px) for the keypad amount and the Sent amount. At most four sizes on
  one screen. Inputs are always `text-base` or larger so phones do not zoom in.
- At most two font weights on one screen (`font-normal` or `font-medium`, plus `font-semibold`).
- Spacing steps: 1, 2, 3, 4, 6, 8, 12, 16. Page padding is `px-6`. Related items `gap-2` or
  `gap-3`, sections `gap-6` or `gap-8`.
- Body copy is left-aligned. Centre only short headings, the amount and empty-state messages.
- Every user-facing string goes through i18n with the same key in `en.json` and `bn.json` (the
  parity test fails otherwise). Bangla mode shows Bangla digits.

## Touch and phones

- Tap targets at least 44px (`min-h-11 min-w-11`). Inputs `h-12`; full-width buttons `h-14`.
- Bottom nav (Home, History, Profile) is fixed and uses `pb-safe`. That needs
  `viewport-fit=cover` in the `<meta name="viewport">` of `client/index.html`.
- Test on a real phone (Galaxy S24 Ultra) on the LAN URL (plain http), not only the desktop frame.

## App bar and Home pocket

- App bar on every inner page: `h-16`, `bg-primary-dark`, the title `font-display font-semibold
  text-xl text-white`, white icons (back arrow, language toggle). No border: the colour is the edge.
- Home (all three roles): the bar flows into a flat `primary-dark` block with a rounded bottom. The
  balance sits in the stitched pocket (tap to reveal). The white action panel (`rounded-3xl`,
  border) overlaps the block's lower edge.

## Action grid

- Four columns. Each tile: the icon in a `size-12 rounded-2xl bg-primary-50` square, the icon
  `text-primary-dark`, the label underneath (`text-sm text-text`), all centred.
- Pressed state: `active:scale-95` with `transition duration-150 ease-out-quint`. A disabled tile
  does not scale.

## Buttons

- Full-width buttons (primary and secondary): `h-14 rounded-2xl`.
- Primary: `bg-primary-dark text-white`, `bg-primary-darker` on hover, `active:scale-95`. "Next"
  carries a trailing arrow icon (`ArrowRight`).
- Secondary: outlined, `border-primary-dark text-primary-dark` on white, `bg-primary-50` on hover.
- Disabled must look disabled, not just paler orange: `bg-surface-sunken text-text-muted`, no
  hover, no press.
- The money flow's send button is the hold-to-send button (press and hold 1.2 s, keyboard
  Enter/Space held too), not a tap.

## Shape and depth

- Radius: `rounded-xl` inputs and small controls, `rounded-2xl` full-width buttons, keypad keys
  and action-grid squares, `rounded-3xl` cards, the action panel and the Home block's bottom,
  `rounded-full` pills, chips and avatars.
- Cards get a border, not a shadow. Only things that float (toast, bottom sheet, menu) get
  `shadow-lg`.

## Motion

- One signature moment: hold to send → the tick draws → the amount rises. Nothing else performs.
- Everything else is feedback to a touch: `active:scale-95`, `duration-150`, `ease-out-quint`
  (`duration-200` for reveals).
- Screen transitions use React's `<ViewTransition>`; the amount is the shared element from the
  keypad to Confirm only. Sent's amount rises instead (a morph into it would land on an invisible
  amount). Browsers without the View Transitions API just navigate.
- The Home pocket may tilt (at most ±6°) from `DeviceOrientationEvent`, only in a secure context,
  only with reduced motion off, and never with a permission prompt on load. On plain-http LAN it
  stays flat.
- Every animation is off under `prefers-reduced-motion`.

## States (required on every screen, from design.md section 11)

Loading skeleton (`bg-surface-sunken animate-pulse`), empty state, error toast, and disabled money
actions while KYC is pending.

## Banned by default

- Gradients, everywhere (the Home block is flat `primary-dark`).
- The stitch outside its four places, or any other dashed or "craft" decoration.
- Emoji as icons. Use one icon set, `lucide-react` (ask before adding a dependency).
- Marketing-style feature cards (a row of three icon-topped cards). The home action grid
  (Send Money, Cash Out, Payment, History) is the one allowed icon grid.
- Any value that is not in `@theme`.
- bKash's pink, logo, or illustrations. PocketPay has its own name, logo and orange palette.
  Study bKash and others for flows and fees only.

If a screen genuinely needs one of these, say so and ask first.

## When it looks like a template

1. Three or more font weights are in use. Drop to two.
2. Every gap is the same value. Give the amount room, tighten related pairs.
3. Text runs the full width of the screen with no hierarchy. Make the amount large and the
   labels small and muted.
4. The stitch is spreading. Take it back to its four places.
