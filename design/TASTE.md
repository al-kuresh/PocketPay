# Taste: PocketPay

## Read this before writing any UI

1. Open every image in `design/references/`. Look at them. `00-avoid-*` files show what PocketPay
   must NOT look like.
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
- The preview step always shows amount, fee and total before the PIN.

## Colour

- Buttons, links, active tab, focus ring: `primary-dark`. Plain `primary` is for large text
  (balance, headings 24px and up), icons, the header bar and the balance card.
  `primary-light` is never behind small text.
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

- Tap targets at least 44px (`min-h-11 min-w-11`). Inputs and primary buttons `h-12`.
- Bottom nav (Home, History, Profile) is fixed and uses `pb-safe`. That needs
  `viewport-fit=cover` in the `<meta name="viewport">` of `client/index.html`.
- Test on a real phone (Galaxy S24 Ultra), not only the desktop frame.

## Shape and depth

- Radius: `rounded-xl` controls and buttons, `rounded-2xl` cards, `rounded-full` pills and avatars.
- Cards get a border, not a shadow. Only things that float (toast, bottom sheet, menu) get
  `shadow-lg`.
- Motion explains a state change and nothing else: `duration-150` for hover and press,
  `duration-200` for reveals, `ease-out-quint`.

## States (required on every screen, from design.md section 11)

Loading skeleton (`bg-surface-sunken animate-pulse`), empty state, error toast, and disabled money
actions while KYC is pending.

## Banned by default

- Gradients, except the balance card (`primary` to `primary-light`). Mark that line with a
  `design-ok: balance card` comment so the checker skips it.
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
