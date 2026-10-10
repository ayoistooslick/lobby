/**
 * Captures the landing page, section by section, in light and dark themes,
 * for the README. It screenshots the *running app* — real Manrope, real
 * tokens, pixel-identical to the site — rather than a hand-made imitation.
 *
 *   node scripts/readme-shots.mjs                 # uses the preview URL
 *   BASE_URL=http://localhost:5173 node scripts/readme-shots.mjs
 *
 * Output: public/readme/{light,dark}/N-name.png (the launch-film section is
 * skipped on purpose — the README shows an autoplay GIF there instead).
 *
 * Details that matter:
 * - The sticky header is hidden so it never smears over scrolled sections.
 * - The hero is captured as a top-of-page viewport clip, not as its element:
 *   the hero element is capped at the 1120px shell while every other section
 *   is full-bleed, and mixing the two widths would break the page illusion
 *   when the README stacks them at one display width.
 * - deviceScaleFactor 1.5 keeps the text crisp at GitHub's ~820px column.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const BASE = (process.env.BASE_URL || "https://3000-igrjf0tbojr60jldmupub.e2b.app").replace(/\/$/, "") + "/";
const OUT = path.join(import.meta.dirname, "..", "public", "readme");
const VIEWPORT = { width: 1280, height: 900 };

// main.landing > section, in page order. null = skip (the film section).
const SECTIONS = ["hero", null, "flow", "features", "see", "display", "places", "band"];

const browser = await chromium.launch();
try {
  for (const scheme of ["light", "dark"]) {
    mkdirSync(path.join(OUT, scheme), { recursive: true });
    // Fresh context per theme: no saved preference, so theme.js follows
    // prefers-color-scheme and we get the page exactly as that audience sees it.
    const context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 1.5,
      colorScheme: scheme,
    });
    const page = await context.newPage();
    await page.goto(BASE, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    const theme = await page.evaluate(() => document.documentElement.dataset.theme);
    if (theme !== scheme) throw new Error(`expected data-theme=${scheme}, page chose ${theme}`);
    await page.addStyleTag({ content: ".site-header { display: none !important; }" });

    const sections = page.locator("main.landing > section");
    const count = await sections.count();
    if (count !== SECTIONS.length) {
      throw new Error(`expected ${SECTIONS.length} landing sections, found ${count}`);
    }
    for (let i = 0; i < count; i += 1) {
      const name = SECTIONS[i];
      if (!name) continue;
      const file = path.join(OUT, scheme, `${i}-${name}.png`);
      if (name === "hero") {
        // Full-bleed clip from the very top through the end of the hero.
        const box = await sections.nth(i).boundingBox();
        if (!box) throw new Error("hero has no bounding box");
        await page.screenshot({
          path: file,
          clip: { x: 0, y: 0, width: VIEWPORT.width, height: Math.ceil(box.y + box.height) },
        });
      } else {
        await sections.nth(i).screenshot({ path: file });
      }
      console.log(`${scheme}: ${path.relative(process.cwd(), file)}`);
    }
    await context.close();
  }
} finally {
  await browser.close();
}
console.log("done");
