import { q } from './domain.js';

/**
 * A look at the preview for the agent (D-038): the dev server's page opened in the server's own
 * browser (Chromium through Playwright, on the Pono server template), as a JPEG the chat can show,
 * with the page's answer and the errors its console printed. Nothing leaves the server but that.
 */

export type Device = 'desktop' | 'mobile';

const VIEWPORTS: Record<Device, { width: number; height: number }> = {
  desktop: { width: 1280, height: 800 },
  mobile: { width: 390, height: 844 },
};

/** A path of the site: `/`, `/blog/a?x=1`; nothing that leaves it. */
export const PREVIEW_PATH = /^\/[\w\-./~%?=&+#]*$/;

const SCRIPT = `
import base64, json, sys
cfg = json.loads(sys.argv[1])
try:
    from playwright.sync_api import sync_playwright
except ImportError:
    print("<<<shot>>>no_browser")
    sys.exit(0)
errors = []
status = None
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": cfg["width"], "height": cfg["height"]})
    page.on("console", lambda m: errors.append(m.text[:300]) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)[:300]))
    try:
        answer = page.goto(cfg["url"], wait_until="networkidle", timeout=20000)
        status = answer.status if answer else None
    except Exception as e:
        errors.append(("navigation: " + str(e))[:300])
    page.wait_for_timeout(300)
    data = page.screenshot(type="jpeg", quality=62)
    browser.close()
print("<<<meta>>>" + json.dumps({"status": status, "errors": errors[:10]}))
print("<<<shot>>>" + base64.b64encode(data).decode())
`;

export function shotCommand(input: { port: number; path: string; device: Device }): string {
  const cfg = JSON.stringify({
    url: `http://127.0.0.1:${input.port}${input.path}`,
    ...VIEWPORTS[input.device],
  });
  // The system Python: the server's own venv (~/.venv) comes first in PATH and hides Playwright.
  return `/usr/bin/python3 -c ${q(SCRIPT)} ${q(cfg)}`;
}

export type ShotReading =
  | { ok: true; image: string; status: number | null; errors: string[] }
  | { ok: false; reason: 'no_browser' | 'no_answer' };

export function readShot(stdout: string): ShotReading {
  const shot = stdout.split('<<<shot>>>')[1]?.trim();
  if (shot === 'no_browser') return { ok: false, reason: 'no_browser' };
  if (!shot || !/^[A-Za-z0-9+/=]+$/.test(shot)) return { ok: false, reason: 'no_answer' };
  const metaLine = stdout.split('<<<meta>>>')[1]?.split('\n')[0] ?? '{}';
  let meta: { status?: number | null; errors?: string[] } = {};
  try {
    meta = JSON.parse(metaLine) as typeof meta;
  } catch {
    meta = {};
  }
  return { ok: true, image: shot, status: meta.status ?? null, errors: meta.errors ?? [] };
}
