import * as m from '@/paraglide/messages.js';
import { getLocale, locales, setLocale } from '@/paraglide/runtime.js';

/** FR / EN: the choice is kept in a cookie and wins over the browser (FR-009). */
export function LocaleSwitch() {
  const current = getLocale();
  return (
    <div className="locale-switch" role="group" aria-label={m.locale_label()}>
      {locales.map((locale) => (
        <button
          key={locale}
          type="button"
          aria-pressed={locale === current}
          onClick={() => setLocale(locale)}
        >
          {locale.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
