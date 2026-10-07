import { africa } from "./africa";
import { asia } from "./asia";
import { en } from "./en";
import { westEurope } from "./europe";
import { eurasia } from "./eurasia";
import type { Lang } from "./types";

export type { Lang } from "./types";

// First entry is the fallback before a visitor picks a language.
export const LANGS: Lang[] = [
  { code: "en", label: "English", native: "English", flag: "gb", dict: en },
  ...africa,
  ...westEurope,
  ...eurasia,
  ...asia,
];
