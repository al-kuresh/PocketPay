# PocketPay

Mobile-first wallet (bKash-style). Full spec: `docs/design.md`. Section 11 is the frontend design
(palette, screens, flows), section 6.3 is the money-flow steps.

## Design

Read `design/TASTE.md` before any UI work in `client/`. It is not optional.

- Every visual value comes from the `@theme` block in `client/src/index.css`. Never invent a hex,
  a px value, or an arbitrary Tailwind value (`p-[13px]`, `bg-[#fff]`). Never use the default
  Tailwind palette (`bg-orange-500`, `text-gray-600`).
- After UI edits, run `node design/check-tokens.mjs` from the repo root and fix what it reports,
  then `cd client && npm run lint && npm run build`.
- To polish a screen visually, use `/design-loop`.
