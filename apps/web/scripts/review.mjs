/**
 * Visual + accessibility review of the running app (default http://127.0.0.1:8080).
 * Uses the system Chrome via playwright-core; screenshots → .impeccable/review/,
 * axe results → .impeccable/review/axe.json, keyboard walk → .impeccable/review/keyboard.txt
 *
 *   node apps/web/scripts/review.mjs [baseUrl]
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const out = resolve(root, '.impeccable/review');
mkdirSync(out, { recursive: true });
const BASE = process.argv[2] ?? 'http://127.0.0.1:8080';
const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const profile = process.env.REVIEW_PROFILE ?? resolve(root, '.localdb/chrome-profile');

const ctx = await chromium.launchPersistentContext(profile, {
  executablePath: CHROME,
  headless: true,
  viewport: { width: 1440, height: 900 },
  bypassCSP: true, // only so axe can be injected; the app itself ships a strict CSP
  args: ['--disable-gpu', '--no-first-run', '--disable-dev-shm-usage'],
});
await ctx.clearCookies();
const page = ctx.pages()[0] ?? (await ctx.newPage());
const log = [];
page.on('console', (m) => m.type() === 'error' && log.push(`console: ${m.text()}`));
page.on('pageerror', (e) => log.push(`pageerror: ${e.message}`));

const axeResults = {};
async function axe(name) {
  await page.addScriptTag({ content: axeSource });
  const r = await page.evaluate(async () => {
    // @ts-ignore
    const res = await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa', 'best-practice'] });
    return res.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length, sample: v.nodes.slice(0, 3).map((n) => n.target.join(' ')) }));
  });
  axeResults[name] = r;
}
const shot = (name, full = false) => page.screenshot({ path: resolve(out, `${name}.png`), fullPage: full });
const settle = () => page.waitForTimeout(700);

// ── desktop ────────────────────────────────────────────────────────────────
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await settle();
await shot('login-desktop');
await axe('login');

await page.getByRole('button', { name: 'Lead a team with one seat left' }).click();
await page.waitForURL(/\/h\//);
await page.waitForSelector('article');
await settle();
await shot('desktop');
await shot('desktop-full', true);
await axe('board');

// keyboard walk: first 18 tab stops on the board
const stops = [];
await page.keyboard.press('Tab');
for (let i = 0; i < 18; i++) {
  stops.push(
    await page.evaluate(() => {
      const el = document.activeElement;
      if (!el) return '(none)';
      const name = el.getAttribute('aria-label') || el.textContent?.trim().replace(/\s+/g, ' ').slice(0, 60) || el.tagName;
      const r = el.getBoundingClientRect();
      const ring = getComputedStyle(el).outlineStyle !== 'none' || getComputedStyle(el).boxShadow !== 'none';
      return `${el.tagName.toLowerCase()} "${name}" ${ring ? 'focus-visible' : 'NO RING'} @${Math.round(r.x)},${Math.round(r.y)}`;
    }),
  );
  await page.keyboard.press('Tab');
}
await shot('board-keyboard-focus');

await page.getByRole('link', { name: /My team/ }).first().click();
await page.waitForSelector('h1');
await settle();
await shot('team-desktop');
await shot('team-desktop-full', true);
await axe('team');

await page.getByRole('link', { name: /For you/ }).first().click();
await settle();
await page.waitForTimeout(800);
await shot('foryou-desktop');
await axe('for-you');

await page.getByRole('link', { name: /Race arena/ }).first().click();
await settle();
await page.getByRole('button', { name: 'Start the race' }).click();
await page.waitForSelector('text=invariant check found', { timeout: 20000 });
await page.waitForTimeout(600);
await shot('arena-desktop');
await axe('arena');

// ── mobile (solo persona, fresh session) ──────────────────────────────────
await ctx.clearCookies();
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await settle();
await shot('login-mobile');
await page.getByRole('button', { name: 'Join as a solo hacker' }).click();
await page.waitForURL(/\/h\//);
await page.waitForSelector('article');
await settle();
await shot('mobile');
await shot('mobile-full', true);
await axe('board-mobile');
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

await page.getByRole('link', { name: 'Team' }).last().click();
await settle();
await shot('team-mobile', true);

await page.goto(`${BASE}/h/hack4hack-2026?view=people`, { waitUntil: 'networkidle' });
await settle();
await shot('people-mobile');

writeFileSync(resolve(out, 'axe.json'), JSON.stringify(axeResults, null, 2));
writeFileSync(resolve(out, 'keyboard.txt'), stops.join('\n'));
const summary = Object.entries(axeResults).map(([k, v]) => `${k}: ${v.length ? v.map((x) => `${x.id}(${x.impact},${x.nodes})`).join(' ') : 'no violations'}`);
console.log(['AXE', ...summary, '', `horizontal overflow at 390px: ${overflow}px`, '', 'KEYBOARD', ...stops, '', 'ERRORS', ...(log.length ? log : ['none'])].join('\n'));
await ctx.close();
