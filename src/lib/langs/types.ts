import type { StringKey } from "./en";

export interface Lang {
  /** Stable code, also used as the BCP 47 language tag and the storage key. */
  code: string;
  /** English name of the language. */
  label: string;
  /** Name of the language in its own script. */
  native: string;
  /** ISO 3166-1 alpha-2 country code for the flag icon. */
  flag: string;
  /** Writing direction, only set for right-to-left languages. */
  dir?: "rtl";
  /**
   * Translations. Packs may omit keys that were added after they were
   * written. Those fall back to the English string at lookup time.
   */
  dict: Partial<Record<StringKey, string>>;
}
