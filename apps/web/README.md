# @pono/web

Pono's console: TanStack Start on `@pono/design`, in French and in English (Paraglide).

- Visible text comes from `messages/{fr,en}.json`; `pnpm check:strings` refuses any hard-coded
  text.
- The language is the explicit choice (cookie `pono_locale`), then the browser, then French.
- The console is dark (`data-theme="console"`), the public page will be light.

```bash
pnpm dev:web   # http://localhost:3000
```
