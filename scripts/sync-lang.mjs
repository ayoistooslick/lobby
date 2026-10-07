/**
 * Keeps every language pack complete and type-checked.
 *
 * Each pack is a list of `Record<StringKey, string>` dictionaries, and `t()`
 * already falls back to English when a phrase is missing. This script adds any
 * key that a dictionary does not have yet, filled with the English wording, so
 * a new screen shows readable text immediately and can be translated later
 * without breaking the build.
 *
 * Usage: node scripts/sync-lang.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";

const base = new URL("../src/lib/langs/", import.meta.url);
const packs = ["africa", "asia", "europe", "eurasia"];

const enSource = readFileSync(new URL("en.ts", base), "utf8");
const enLiteral = enSource.slice(enSource.indexOf("{", enSource.indexOf("export const en")), enSource.lastIndexOf("}") + 1);
const en = new Function(`return ${enLiteral}`)();

let added = 0;
for (const pack of packs) {
  const file = new URL(`${pack}.ts`, base);
  let src = readFileSync(file, "utf8");
  let packAdded = 0;

  // Every dictionary in a pack is written as `const xx: Pack = {` ... `};`.
  const pattern = /(const \w+: Pack = \{)([\s\S]*?)(\n\};)/g;
  src = src.replace(pattern, (_all, open, body, close) => {
    const present = new Set([...body.matchAll(/^\s*"([^"]+)":/gm)].map((m) => m[1]));
    const missing = Object.keys(en).filter((key) => !present.has(key));
    if (!missing.length) return `${open}${body}${close}`;
    packAdded += missing.length;
    const block = missing.map((key) => `  "${key}": ${JSON.stringify(en[key])},`).join("\n");
    return `${open}${body}\n  // Added by scripts/sync-lang.mjs: English until translated.\n${block}${close}`;
  });

  writeFileSync(file, src);
  added += packAdded;
  console.log(`${pack}: ${packAdded} keys added`);
}
console.log(`total added: ${added} (en.ts has ${Object.keys(en).length} keys)`);