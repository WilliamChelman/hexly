/**
 * Where a navigation belongs (ADR-0070). `refused` is the third answer a two-way split would miss: a `file:`
 * or `javascript:` URL in authored Content has no business being followed here *or* handed to a browser.
 */
export type LinkDestination = 'internal' | 'external' | 'refused';

/** `mailto:` because a Content link may carry a mail address. */
const HANDED_OFF_SCHEMES = ['http:', 'https:', 'mailto:'];

export function linkDestination(url: string, appOrigin: string): LinkDestination {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'refused';
  }
  // Origin, not host: a `https://127.0.0.1:<port>` look-alike is not us either.
  if (parsed.origin === appOrigin) return 'internal';
  return HANDED_OFF_SCHEMES.includes(parsed.protocol) ? 'external' : 'refused';
}

/** As much of Electron's `shell` as handing a link to the platform needs, so a spec can stand in for it. */
export interface UrlOpener {
  openExternal(url: string): Promise<void>;
}

export interface LinkTargets {
  /** What a `target="_blank"` inside the SPA asks for. */
  openWindow(url: string): void;
}

/** As much of `WebContents` as intercepting the two ways a link leaves the page needs. */
export interface NavigatingContents {
  setWindowOpenHandler(handler: (details: { url: string }) => { action: 'deny' }): void;
  on(event: 'will-navigate', listener: (event: { preventDefault(): void }, url: string) => void): unknown;
}

/**
 * Both paths need intercepting and differ (ADR-0070): `setWindowOpenHandler` sees a `target="_blank"` or
 * `window.open`, `will-navigate` sees a plain click or a `location` assignment. A `window.open` on one of our
 * own URLs gets a second Hexly window rather than Electron's `action: 'allow'`, so it carries our preload,
 * geometry and handlers.
 */
export function routeLinks(
  contents: NavigatingContents,
  appOrigin: string,
  shell: UrlOpener,
  targets: LinkTargets,
): void {
  contents.setWindowOpenHandler(({ url }) => {
    switch (linkDestination(url, appOrigin)) {
      case 'internal':
        targets.openWindow(url);
        break;
      case 'external':
        void openExternally(shell, url);
        break;
    }
    // Always `deny`: Electron's own new window would inherit this one's preferences instead of `openWindow`'s.
    return { action: 'deny' };
  });

  contents.on('will-navigate', (event, url) => {
    const destination = linkDestination(url, appOrigin);
    if (destination === 'internal') return;
    // Prevented either way: an external link is now the browser's problem, and a refused one is nobody's.
    event.preventDefault();
    if (destination === 'external') void openExternally(shell, url);
  });
}

/** A refusal is reported rather than thrown: the click has no surface to fail on. */
export async function openExternally(shell: UrlOpener, url: string): Promise<void> {
  try {
    await shell.openExternal(url);
  } catch (err) {
    console.error(`[hexly] could not open ${url} in the system browser`, err);
  }
}
