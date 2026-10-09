/**
 * Applies scripts/i18n-strings.mjs (+ parts) to the language packs.
 *
 * For each pack dictionary: a key is rewritten only when its current value is
 * still the English source (synced placeholder) or missing entirely, real
 * translations already in the packs are never touched.
 *
 * Usage: node scripts/apply-translations.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { T } from "./i18n-strings.mjs";
import { T2 } from "./i18n-part2.mjs";
import { T3 } from "./i18n-part3.mjs";
import { T4 } from "./i18n-part4.mjs";
import { T5 } from "./i18n-part5.mjs";
import { T6 } from "./i18n-part6.mjs";

const TABLE = { ...T, ...T2, ...T3, ...T4, ...T5, ...T6 };
const PACKS = ["africa", "asia", "europe", "eurasia"];
const base = new URL("../src/lib/langs/", import.meta.url);

// English source of truth.
const enSource = readFileSync(new URL("en.ts", base), "utf8");
const enLiteral = enSource.slice(
  enSource.indexOf("{", enSource.indexOf("export const en")),
  enSource.lastIndexOf("}") + 1
);
const en = new Function(`return ${enLiteral}`)();

const TABLE_KEYS = Object.keys(TABLE);
let replaced = 0;
let filled = 0;
const gaps = [];

for (const pack of PACKS) {
  const file = new URL(`${pack}.ts`, base);
  let src = readFileSync(file, "utf8");
  let packReplaced = 0;

  src = src.replace(/const (\w+): Pack = \{([\s\S]*?)\n\};/g, (all, lang, body) => {
    if (lang === "en") return all;
    let changed = false;
    // Rewrite existing English-identical entries line by line.
    body = body.replace(/^(\s*)"([^"]+)":\s*("(?:[^"\\]|\\.)*")(,?)$/gm, (line, pad, key, value, comma) => {
      const tr = TABLE[key]?.[lang];
      if (!tr) return line;
      let decoded;
      try {
        decoded = JSON.parse(value);
      } catch {
        return line;
      }
      if (decoded !== en[key]) return line; // already translated, leave it
      if (tr === decoded) return line; // translation identical to English
      changed = true;
      packReplaced += 1;
      replaced += 1;
      return `${pad}"${key}": ${JSON.stringify(tr)}${comma}`;
    });

    // Append keys that are missing entirely.
    const present = new Set([...body.matchAll(/^\s*"([^"]+)":/gm)].map((m) => m[1]));
    const additions = [];
    for (const key of TABLE_KEYS) {
      if (present.has(key)) continue;
      const tr = TABLE[key][lang];
      if (!tr || en[key] === undefined) continue;
      additions.push(`  ${JSON.stringify(key)}: ${JSON.stringify(tr)},`);
      filled += 1;
      changed = true;
    }
    if (additions.length) {
      body = `${body}\n  // Added by scripts/apply-translations.mjs.\n${additions.join("\n")}`;
    }
    if (!changed) return all;
    return `const ${lang}: Pack = {${body}\n};`;
  });

  writeFileSync(file, src);
  console.log(`${pack}: ${packReplaced} English placeholders translated`);
}

// Coverage report: used keys that still lack a translation for some language.
const used = new Set(
  [...readFileSync("/tmp/need-keys.txt", "utf8").trim().split("\n")].filter((k) => en[k] !== undefined)
);
for (const key of used) {
  if (!TABLE[key]) gaps.push(`key missing from table: ${key}`);
}
console.log(`\ntable keys: ${TABLE_KEYS.length} · replaced: ${replaced} · appended: ${filled}`);
if (gaps.length) {
  console.log(`\n${gaps.length} gaps:`);
  for (const g of gaps) console.log("  " + g);
}
