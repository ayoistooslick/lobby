import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { LANGS, type Lang } from "./langs";
import { en, type StringKey } from "./langs/en";

const STORAGE_KEY = "lobby.lang";

interface I18nValue {
  lang: Lang;
  chosen: boolean;
  choose: (code: string) => void;
  t: (key: StringKey, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

function storedCode(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(() => {
    const code = storedCode();
    return LANGS.find((entry) => entry.code === code) ?? LANGS[0];
  });
  const [chosen, setChosen] = useState<boolean>(() => storedCode() !== null);

  useEffect(() => {
    document.documentElement.lang = lang.code;
    document.documentElement.dir = lang.dir ?? "ltr";
  }, [lang]);

  const choose = useCallback((code: string) => {
    const found = LANGS.find((entry) => entry.code === code);
    if (!found) return;
    setLang(found);
    setChosen(true);
    try {
      localStorage.setItem(STORAGE_KEY, code);
    } catch {
      // Private browsing: the choice still applies to this session.
    }
  }, []);

  const t = useCallback(
    (key: StringKey, vars?: Record<string, string | number>) => {
      let text: string = lang.dict[key] ?? en[key];
      if (vars) {
        for (const [name, value] of Object.entries(vars)) {
          text = text.split(`{${name}}`).join(String(value));
        }
      }
      return text;
    },
    [lang]
  );

  const value = useMemo(() => ({ lang, chosen, choose, t }), [lang, chosen, choose, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside I18nProvider");
  return ctx;
}
