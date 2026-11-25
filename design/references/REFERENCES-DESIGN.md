# Reference rules: the 10 screenshots in this folder

All 10 are screens of one Bangladeshi wallet app (home, "my account", rewards, QR), captured on a
Galaxy S24 Ultra at 1080px wide (412 CSS px, about 2.62 device pixels per CSS px). Values below are
CSS px measured from the screenshots, rounded to the nearest whole px. They are measurements of
pixels, not of the app's code, so anything ±2px is noise. Where I am reading intent rather than
measuring, it says (inferred).

## Typography

- One sans-serif family throughout, Latin and Bangla (inferred: a system or Inter-like face).
- Weights: regular (400) for almost everything; medium (≈500) for section titles, card titles and
  the app-bar title. No bold in the UI chrome; only the marketing banners use heavy weights.
- Sizes seen:
  - ≈13px: badge numbers, small captions under cards.
  - ≈14px: action-grid labels, list subtitles, card subtitles, bottom-nav labels.
  - ≈16px: list-row titles, section titles, "See All / Manage" links, card titles.
  - ≈18–20px: the app-bar title on inner pages.
  - Money in lists (৳8,500.00) is ≈16px, brand colour, same weight as the text around it.
- Line height: ≈1.3–1.4 for single lines, ≈1.4 for wrapped two-line rows (inferred from row heights).
- Labels under icons are one line, centred, and may run to the column edge ("Mobile Recharge").

## Spacing

- Base unit 4px; most gaps are 8, 12, 16 or 24 (inferred from the measured values below).
- Page margin: 16px left and right, on every screen.
- Section rhythm: ≈40px from the end of one section to the next section title; ≈16–20px from a
  section title to its content.
- Action grid: 4 columns across the full content width; row pitch ≈96px; ≈12px from the icon
  well to its label.
- Cards: inner padding ≈16px; ≈12px gap between cards side by side.
- List rows: ≈64–76px tall, 16px icon-to-text gap, the text block left-aligned on one edge.
- The app bar is ≈56px tall; the bottom nav ≈64px plus the safe area.

## Colour

Roles only. Their hex values are listed so they can be avoided (see "Do not copy").

- Brand fill (app bar, header hero, active tab, links, pill buttons, badges): one saturated
  magenta, ≈#E2136E (approx).
- Page and card background: white #FFFFFF.
- Primary text: near-black ≈#1F1F1F (approx). Secondary text: grey ≈#6B6B6B (approx).
- Section titles are a dark grey ≈#4A4A4A (approx), quieter than body text.
- Card outlines and dividers: ≈#E8E8E8 (approx). Icon wells: ≈#F4F4F4 (approx).
- Notification badge: a red circle with a white number.
- Decorative pastel fills on promo tiles (cream, mint, lavender, pink) (approx; promo only).

## Shape and depth

- The header hero ends in a white sheet with **≈24px rounded top corners** that slides over it;
  the content lives on that sheet.
- Cards: ≈12px radius, 1px outline ≈#E8E8E8, plus a very faint shadow
  (`0 1px 2px rgb(0 0 0 / 0.04)`, approx).
- Action-grid icon wells: circles ≈48px across, flat fill, no outline.
- List-row icons: ≈42px circles with a 1px outline.
- Buttons in lists ("Claim"): fully rounded pills, ≈36px tall, brand fill, white 16px text.
- "See More / Close" toggle: white chip, 1px outline, ≈8px radius, brand text and chevron.
- Avatars and round header buttons (search, logo): circles ≈44px, white fill.
- Separators between groups on inner pages: a full-bleed ≈4px light-grey band; within a group, 1px
  hairlines.

## Layout

- **Header (home):** a tall brand-colour hero (≈140px) holding the avatar, the name, a white
  "tap for balance" pill and two round icon buttons. The white content sheet overlaps its bottom
  edge with rounded top corners. The balance is never shown until tapped.
- **App bar (inner pages):** solid brand colour, ≈56px, white back arrow on the left, white
  title centred, an icon on the right. No border; the colour block is the edge.
- **Action grid:** 4 columns, icon well on top, one-line label below, everything centred in its
  column. A "See More" chip expands the grid in place.
- **Sections:** a muted section title on the left, an optional brand-colour text link ("See All",
  "Manage") on the right, on the same baseline; the content below.
- **List rows:** icon circle left, title + muted subtitle stacked, chevron right; hairline
  dividers spanning the content width.
- **Bottom nav:** white, a hairline top border, 4 equal tabs, icon above a label. Active tab:
  filled icon and label in the brand colour; inactive: grey outline icon, grey label.
- **Detail cards (QR):** one large outlined card centred on a white page, with its footer row
  split off by a hairline; secondary actions as round outlined icon buttons at the bottom.

## Rules

1. Put the brand colour in one solid block at the top of every screen; keep everything below it
   white.
2. On the home screen, let the coloured header flow into the content: a coloured block with 24px
   rounded bottom corners (or a white sheet with 24px rounded top corners over it).
3. Keep one page margin everywhere; never let content touch the screen edge except full-bleed
   separators.
4. Lay out money actions as a 4-column grid: a 48px soft icon well, then a one-line 14px label,
   centred.
5. Use regular weight for almost everything; reserve medium for titles. Never more than two
   weights.
6. Give section titles a quiet colour and a brand-colour action link on the same line.
7. Outline cards with a 1px light-grey border; do not stack shadows.
8. Separate sections with about 40px of space, not with lines.
9. Build list rows as icon, two lines of text, chevron, with hairline dividers between rows.
10. Mark the active bottom-nav tab with the brand colour on both icon and label; leave the rest
    grey.

## Do not copy

1. **Their brand colour:** the magenta ≈#E2136E and its pink gradients. PocketPay is orange
   (`primary`, `primary-dark`).
2. **Their logo, name and wordmarks:** the bird/origami logo, "bKash", "My bKash", "bKash Bundle",
   "bKash Forest", "bKash to Bank" and the like.
3. **Their illustrations and mascots:** the hills-and-houses scenery behind the header, the
   multi-colour 3D action icons, the trophy, piggy-pot, game-pad and plant artwork. PocketPay
   uses one line-icon set (lucide) in one colour.
4. **Their marketing surfaces:** promo carousels, "Quick Features" / "My Offers" tiles, partner
   logos (Robi, Grameenphone, NPSB, Bangla QR) and pastel promo cards.
5. **Their feature set as layout:** 16+ services, Scan QR and Inbox tabs with badges. PocketPay's
   grid holds only its own flows plus History, and its nav is Home, History, Profile.

## Mapped to PocketPay (Tailwind + `client/src/index.css`)

| Reference rule | PocketPay class / token |
|---|---|
| Brand app bar, white title and icons | `bg-primary-dark text-white` (white on primary-dark is 5.2:1) |
| Home hero flowing out of the app bar | `bg-primary-dark rounded-b-3xl` block under the bar, balance inside |
| One page margin (theirs 16px) | PocketPay keeps `px-6` (24px, TASTE.md) |
| 48px icon well, line icon | `size-12 rounded-2xl bg-primary-50` + `text-primary-dark` icon (their wells are circles) |
| 14px one-line labels | `text-sm text-text` |
| Outlined cards | `rounded-2xl border border-border` (TASTE: cards are `rounded-2xl`) |
| Pill buttons | not adopted: the primary button becomes `h-14 rounded-2xl` |
| Hairline list dividers | `divide-y divide-border` |
| Active tab in brand colour | already `text-primary-dark` in `BottomNav` |

Proposed token changes: none. `rounded-3xl` (24px) and `h-14` (56px) come from Tailwind's own
scales, which `@theme` does not override, and `design/check-tokens.mjs` only flags arbitrary
values, the default colour palette, shadows other than `shadow-lg`, gradients, raw colours/px and
emoji.
