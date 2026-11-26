#!/usr/bin/env node
// Finds values that bypass the design tokens in client/src/index.css (the @theme block).
// Usage, from the repo root:  node design/check-tokens.mjs [dir ...]     (default: client/src)
// Exit code 1 if anything is found, so it can run in CI or a git hook.
//
// Rules checked:
//   arbitrary  Tailwind arbitrary values like p-[13px] or bg-[#fff]
//   palette    default Tailwind palette colours like bg-orange-500 or text-gray-600
//   shadow     shadow-sm/md/xl/2xl (cards use borders; only shadow-lg for floating things)
//   status     text-success / text-warning (fail AA as text; use the -dark colours, or mark
//              design-ok when the class only colours an icon)
//   gradient   gradient utilities (banned everywhere: TASTE.md, the Home block is flat primary-dark)
//   color      raw hex/rgb()/hsl() colours
//   size       raw px / ms values in CSS or in style props
//   emoji      emoji in UI code (use icons)
//
// Escape hatch: a line is skipped when it, or the line above it, contains "design-ok".
// This is a heuristic, not a parser. Fix the real findings and use design-ok for the rest.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, sep } from 'node:path';

const roots = process.argv.slice(2).length ? process.argv.slice(2) : ['client/src'];
const EXT = new Set(['.css', '.html', '.jsx', '.tsx']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'generated']);

const HEX = /#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3,4}\b/g;
const COLOR_FN = /\b(?:rgba?|hsla?|oklch|oklab|lab|lch)\(/g;
const PX = /(?<![\w.-])(\d*\.?\d+)px\b/g;
const MS = /(?<![\w.-])(\d*\.?\d+)ms\b/g;
const ARBITRARY = /[\w:!/.-]*-\[[^\]\s]+\]/g;
const PALETTE =
  /\b(?:bg|text|border|ring|outline|fill|stroke|from|to|via|divide|placeholder|caret|accent|decoration|shadow)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/g;
const SHADOW = /(?<![\w-])shadow-(?:sm|md|xl|2xl|inner)\b/g;
const STATUS_TEXT = /(?<![\w-])text-(?:success|warning)(?![\w-])/g;
const GRADIENT =
  /(?<![\w-])bg-(?:gradient-to-\w+|linear-[\w[\].-]+|radial[\w[\].-]*|conic[\w[\].-]*)/g;
const EMOJI = /\p{Extended_Pictographic}/gu;

// Variant prefixes that use [..] for selectors/conditions, not for values.
const VARIANT_BASES = new Set([
  'data',
  'aria',
  'supports',
  'has',
  'nth',
  'min',
  'max',
  'not',
  'in',
  'group',
  'peer',
  'group-data',
  'group-aria',
  'peer-data',
  'peer-aria',
  'grid-cols',
  'grid-rows',
  'content',
]);
const SKIP_LINE = /@media|@container|@import|@font-face|@source|^\s*(\/\/|\/\*|\*)/;

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (!SKIP_DIRS.has(name)) yield* walk(p);
    } else if (EXT.has(extname(name))) {
      yield p;
    }
  }
}

function arbitraryValues(line) {
  const out = [];
  for (const m of line.matchAll(ARBITRARY)) {
    const token = m[0];
    const base = token.slice(0, token.indexOf('-[')).split(':').pop().replace(/^[!-]/, '');
    if (VARIANT_BASES.has(base)) continue;
    if (/-\[var\(--/.test(token)) continue; // points at a token, fine
    out.push(token);
  }
  return out;
}

const findings = [];
for (const root of roots) {
  if (!existsSync(root)) {
    console.error(`skip: ${root} does not exist`);
    continue;
  }
  for (const file of walk(root)) {
    const isCss = extname(file) === '.css';
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    let depth = 0; // > 0 while inside an @theme { ... } block, where token definitions live
    lines.forEach((line, i) => {
      const inTheme = depth > 0 || /@theme\b/.test(line);
      if (inTheme) {
        depth += (line.match(/{/g) ?? []).length - (line.match(/}/g) ?? []).length;
        if (depth < 0) depth = 0;
      }
      if (inTheme || SKIP_LINE.test(line)) return;
      if (/design-ok/.test(line) || (i > 0 && /design-ok/.test(lines[i - 1]))) return;

      const hit = (rule, items) => {
        if (items.length) {
          findings.push(
            `${file.split(sep).join('/')}:${i + 1}  [${rule}] ${items.join(', ')}   | ${line.trim().slice(0, 70)}`,
          );
        }
      };
      hit('arbitrary', arbitraryValues(line));
      hit(
        'palette',
        [...line.matchAll(PALETTE)].map((m) => m[0]),
      );
      hit(
        'shadow',
        [...line.matchAll(SHADOW)].map((m) => m[0]),
      );
      hit(
        'status',
        [...line.matchAll(STATUS_TEXT)].map((m) => m[0]),
      );
      hit(
        'gradient',
        [...line.matchAll(GRADIENT)].map((m) => m[0]),
      );
      hit('color', [
        ...[...line.matchAll(HEX)].map((m) => m[0]),
        ...[...line.matchAll(COLOR_FN)].map((m) => m[0] + '...)'),
      ]);
      if (isCss || /style\s*=|style:/.test(line)) {
        hit('size', [
          ...[...line.matchAll(PX)].filter((m) => m[1] !== '0' && m[0] !== '1px').map((m) => m[0]),
          ...[...line.matchAll(MS)].filter((m) => m[1] !== '0').map((m) => m[0]),
        ]);
      }
      if (!isCss)
        hit(
          'emoji',
          [...line.matchAll(EMOJI)].map((m) => m[0]),
        );
    });
  }
}

if (findings.length) {
  console.log(findings.join('\n'));
  console.log(`\n${findings.length} line(s) bypass the design tokens.`);
  console.log('Use the nearest token, add one to the @theme block in client/src/index.css with a');
  console.log('comment saying why, or mark a deliberate exception with a design-ok comment.');
  process.exit(1);
}
console.log('No token bypasses found.');
