/**
 * Where a navigation belongs (ADR-0070). `internal` is our own loopback origin, which is everything the SPA
 * needs; `external` is the user's own link, and belongs to the system browser. `refused` is the third answer a
 * two-way split would miss: Content is authored text, and a `file:` or `javascript:` URL in it has no business
 * being followed here *or* handed to a browser.
 */
export type LinkDestination = 'internal' | 'external' | 'refused';

/** The schemes worth handing to the platform: a web link, or a mail address a Content link may carry. */
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

/** What the shell does with a link that is not a navigation of the current window. */
export interface LinkTargets {
  /** Open one of our own URLs in a second window — what a `target="_blank"` inside the SPA asks for. */
  openWindow(url: string): void;
}

/** The two ways a link leaves the current page, as much of `WebContents` as intercepting them needs. */
export interface NavigatingContents {
  setWindowOpenHandler(handler: (details: { url: string }) => { action: 'deny' }): void;
  on(event: 'will-navigate', listener: (event: { preventDefault(): void }, url: string) => void): unknown;
}

/**
 * Route every link leaving `contents` to where it belongs (ADR-0070). Both paths need intercepting and they
 * are genuinely different: `setWindowOpenHandler` sees a `target="_blank"` or `window.open`, `will-navigate`
 * sees a plain click or a `location` assignment in the page. An internal navigation in place is simply
 * allowed through — the SPA's router is what the window is for.
 *
 * A `window.open` on one of our own URLs is answered by a second Hexly window rather than by Electron's
 * `action: 'allow'`, so it is the same window everywhere else opens: our preload, our geometry, and these
 * same handlers on it.
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
    // Always `deny`: Electron's own new window would inherit this one's preferences rather than be built the
    // way `openWindow` builds every other window.
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

/**
 * Hand `url` to the platform's default handler. A refusal is reported rather than thrown: the click has no
 * surface to fail on, and the window it declined to navigate is still exactly where the user left it.
 */
export async function openExternally(shell: UrlOpener, url: string): Promise<void> {
  try {
    await shell.openExternal(url);
  } catch (err) {
    console.error(`[hexly] could not open ${url} in the system browser`, err);
  }
}
