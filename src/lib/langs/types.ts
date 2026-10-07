import type { StringKey } from "./en";

export interface Lang {
  /** Stable code, also used as the BCP 47 language tag and the storage key. */
  code: string;
  /** English name of the language. */
  label: string;
  /** Name of the language in its own script. */
  native: string;
  /** Country flag shown in the header. */
  flag: string;
  /** Writing direction, only set for right-to-left languages. */
  dir?: "rtl";
  /**
   * Translations. Packs may omit keys that were added after they were
   * written; those fall back to the English string at lookup time.
   */
  dict: Partial<Record<StringKey, string>>;
}
