# Taste: PocketPay

## Read this before writing any UI

1. Open every image in `design/references/`. Look at them. `00-avoid-*` files show what PocketPay
   must NOT look like. Then read `design/references/REFERENCES-DESIGN.md`: the rules they share and
   what not to copy. Take their layout and feel; keep PocketPay's palette, tokens and name. Where a
   reference and this file disagree, this file wins.
2. Tokens live in the `@theme` block of `client/src/index.css`. The spec is `docs/design.md`
   section 11 (palette, screens) and section 6.3 (every money flow is
   Enter details, Preview, PIN, Receipt).
3. After editing UI, run `node design/check-tokens.mjs` and fix what it reports.

## What PocketPay looks like

- A trustworthy wallet, not a fintech landing page. Calm, clear, fast. Orange is the brand. White
  and slate do the work.
- Designed at 390px wide. On desktop the app sits in a centred phone-width frame (`MobileShell`).
  The admin panel uses a wider layout.
- One primary action per screen: a full-width filled button (`bg-primary-dark text-white`) at the
  bottom, in the thumb zone.
- The brand colour is one solid block at the top of every screen (the app bar); everything under
  it is white.
- The amount is the hero. On any screen that shows money, the money is the biggest thing.
- Borders and whitespace do the work that shadows and decoration usually do.

## Money display

- Format every amount through ONE helper (create `client/src/lib/money.ts` when first needed). The
  API sends poisha as strings (`"150050"` = ৳1,500.50), so use BigInt maths, never floats.
- Output looks like `৳1,500.50` with a `৳` prefix. Use lakh grouping (`৳12,34,567.50`) via
  `en-IN` grouping. Do not use `Intl` currency style with `en-BD`: it prints `BDT 1,234,567.50`.
- Every amount, balance, TrxID and phone number gets `tabular-nums` so digits line up.
- Money in: `+৳500` in `text-success-dark`. Money out: `−৳500` in `text-danger`. The sign always
  carries the meaning, colour is never the only signal.
- The balance is hidden by default (`৳ ••••`) and revealed on tap.
- The preview step always shows amount, fee and total before the PIN, as one receipt-style card:
  the receiver on top, then amount and fee, a dashed divider (`border-dashed border-border`), and
  the total as the hero amount (`text-3xl`).

## Colour

- Buttons, links, active tab, focus ring, the app bar and the home hero: `primary-dark`. White text
  and icons on it are 5.2:1, so small white text is fine there. Plain `primary` is for large text
  (headings 24px and up) and icons on white. `primary-light` is never behind small text.
- `<meta name="theme-color">` in `client/index.html` matches `primary-dark`, so the phone's browser
  bar is the same orange as the app bar. Change both together.
- Status as TEXT: `success-dark`, `danger`, `warning-dark`. Base `success` and `warning` are for
  icons, fills and badge backgrounds only (they fail AA as small text).
- Input outlines use `border-strong`. `border` is for dividers and card outlines.
- Secondary text is `text-muted`. On `primary-50` backgrounds use `text` instead (4.5:1 limit).
- No default Tailwind palette (`bg-orange-500`, `text-gray-600`), no `bg-[#...]`. `text-white`,
  `bg-white`, `transparent` and `current` are fine.

## Type and space

- Sizes: `text-xs`, `text-sm`, `text-base`, `text-lg`, `text-xl`, `text-3xl`. `text-4xl` only for
  the balance amount. At most four sizes on one screen. Inputs are always `text-base` or larger
  so phones do not zoom in.
- At most two font weights on one screen (`font-normal` or `font-medium`, plus `font-semibold`).
- Spacing steps: 1, 2, 3, 4, 6, 8, 12, 16. Page padding is `px-6`. Related items `gap-2` or
  `gap-3`, sections `gap-6` or `gap-8`.
- Body copy is left-aligned. Centre only short headings and empty-state messages.

## Touch and phones

- Tap targets at least 44px (`min-h-11 min-w-11`). Inputs `h-12`; full-width buttons `h-14`.
- Bottom nav (Home, History, Profile) is fixed and uses `pb-safe`. That needs
  `viewport-fit=cover` in the `<meta name="viewport">` of `client/index.html`.
- Test on a real phone (Galaxy S24 Ultra), not only the desktop frame.

## App bar and home hero

- App bar on every page: `bg-primary-dark`, white title, white icons (back arrow, language toggle
  in white). No border: the colour is the edge.
- Home (all three roles): the app bar flows into an orange hero block (`bg-primary-dark`,
  `rounded-b-3xl`) that holds the balance, tap-to-reveal as before. No separate balance card and no
  gradient.

## Action grid

- Four columns. Each tile: the icon in a `size-12 rounded-2xl bg-primary-50` square, the icon
  `text-primary-dark`, the label underneath (`text-sm text-text`), all centred.
- Pressed state: `active:scale-95` with `transition duration-150 ease-out-quint`. A disabled tile
  does not scale.

## Buttons

- Full-width buttons (primary and secondary): `h-14 rounded-2xl`.
- Primary: `bg-primary-dark text-white`; pressed `active:scale-95` and `bg-primary-darker`
  on hover. "Next" carries a trailing arrow icon (`ArrowRight`).
- Disabled must look disabled, not just paler orange: `bg-surface-sunken text-text-muted`, no
  hover, no press.

## Shape and depth

- Radius: `rounded-xl` inputs and small controls, `rounded-2xl` full-width buttons, cards and
  action-grid icon squares, `rounded-3xl` only for the home hero's bottom corners, `rounded-full`
  pills and avatars.
- Cards get a border, not a shadow. Only things that float (toast, bottom sheet, menu) get
  `shadow-lg`.
- Motion explains a state change and nothing else: `duration-150` for hover and press
  (`active:scale-95`), `duration-200` for reveals, `ease-out-quint`.

## States (required on every screen, from design.md section 11)

Loading skeleton (`bg-surface-sunken animate-pulse`), empty state, error toast, and disabled money
actions while KYC is pending.

## Banned by default

- Gradients, everywhere (the home hero is a flat `primary-dark` block).
- Emoji as icons. Use one icon set (ask before adding a dependency).
- Marketing-style feature cards (a row of three icon-topped cards). The home action grid
  (Send Money, Cash Out, Payment, History) is the one allowed icon grid.
- Any value that is not in `@theme`.
- bKash's pink, logo, or illustrations. PocketPay has its own name, logo and orange palette.
  Study bKash and others for flows and fees only.

If a screen genuinely needs one of these, say so and ask first.

## When it looks like a template

1. The references are all the same kind of app. Add something outside the set.
2. Three or more font weights are in use. Drop to two.
3. Every gap is the same value. Give the amount room, tighten related pairs.
4. Text runs the full width of the screen with no hierarchy. Make the amount large and the
   labels small and muted.
