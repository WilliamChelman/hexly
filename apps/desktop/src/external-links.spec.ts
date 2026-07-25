import { linkDestination, type NavigatingContents, openExternally, routeLinks, type UrlOpener } from './external-links';

/** The loopback origin one launch bound; the port is ephemeral (ADR-0070), so nothing may key on this one. */
const ORIGIN = 'http://127.0.0.1:52341';

/** A `WebContents` stand-in whose two interception points a spec can fire. */
function fakeContents(): NavigatingContents & {
  /** Ask as `window.open` does, returning what Electron would be told to do. */
  requestWindow(url: string): { action: 'deny' };
  /** Click a link in the page, returning whether the window was allowed to navigate. */
  clickLink(url: string): boolean;
} {
  let openHandler: ((details: { url: string }) => { action: 'deny' }) | undefined;
  let navigateListener: ((event: { preventDefault(): void }, url: string) => void) | undefined;
  return {
    setWindowOpenHandler: (handler) => void (openHandler = handler),
    on: (_event, listener) => void (navigateListener = listener),
    requestWindow(url) {
      if (!openHandler) throw new Error('Nothing registered a window-open handler');
      return openHandler({ url });
    },
    clickLink(url) {
      if (!navigateListener) throw new Error('Nothing listened for will-navigate');
      let prevented = false;
      navigateListener({ preventDefault: () => void (prevented = true) }, url);
      return !prevented;
    },
  };
}

function recorder(): UrlOpener & { readonly handedOff: string[] } {
  const handedOff: string[] = [];
  return { handedOff, openExternal: async (url) => void handedOff.push(url) };
}

describe('linkDestination', () => {
  it('keeps our own origin in the window — routes, cross-World Content Links, assets and the live-follow stream', () => {
    for (const url of [
      `${ORIGIN}/worlds`,
      `${ORIGIN}/w/w1/entities/e2`,
      `${ORIGIN}/assets/ab12cd34`,
      `${ORIGIN}/api/entities/e2/stream`,
    ]) {
      expect(linkDestination(url, ORIGIN)).toBe('internal');
    }
  });

  it('hands a web link and a mail address to the platform', () => {
    expect(linkDestination('https://en.wikipedia.org/wiki/Hex_map', ORIGIN)).toBe('external');
    expect(linkDestination('http://example.com/lore', ORIGIN)).toBe('external');
    expect(linkDestination('mailto:gm@example.com', ORIGIN)).toBe('external');
  });

  /** Loopback at another port is another app, and the port is what tells the two apart. */
  it('treats a different port or scheme on the same host as external', () => {
    expect(linkDestination('http://127.0.0.1:4200/worlds', ORIGIN)).toBe('external');
    expect(linkDestination('https://127.0.0.1:52341/worlds', ORIGIN)).toBe('external');
  });

  it('refuses a scheme neither the window nor a browser should follow', () => {
    for (const url of [
      'file:///etc/passwd',
      'javascript:alert(1)',
      'about:blank',
      'data:text/html,<b>x',
      'not a url',
    ]) {
      expect(linkDestination(url, ORIGIN)).toBe('refused');
    }
  });
});

describe('routeLinks', () => {
  describe('a link that opens a window', () => {
    it('hands an external one to the system browser and opens no window', () => {
      const contents = fakeContents();
      const shell = recorder();
      const opened: string[] = [];
      routeLinks(contents, ORIGIN, shell, { openWindow: (url) => void opened.push(url) });

      expect(contents.requestWindow('https://example.com/lore')).toEqual({ action: 'deny' });

      expect(shell.handedOff).toEqual(['https://example.com/lore']);
      expect(opened).toEqual([]);
    });

    /** The SPA's own new-tab affordances (the Palette, the World Graph) go through this path. */
    it('answers one of our own URLs with a second Hexly window, built the way every window is', () => {
      const contents = fakeContents();
      const shell = recorder();
      const opened: string[] = [];
      routeLinks(contents, ORIGIN, shell, { openWindow: (url) => void opened.push(url) });

      // Denied so Electron does not build a window of its own — ours is opened instead.
      expect(contents.requestWindow(`${ORIGIN}/w/w1/entities/e2`)).toEqual({ action: 'deny' });

      expect(opened).toEqual([`${ORIGIN}/w/w1/entities/e2`]);
      expect(shell.handedOff).toEqual([]);
    });

    it('opens nothing at all for a refused scheme', () => {
      const contents = fakeContents();
      const shell = recorder();
      const opened: string[] = [];
      routeLinks(contents, ORIGIN, shell, { openWindow: (url) => void opened.push(url) });

      expect(contents.requestWindow('file:///etc/passwd')).toEqual({ action: 'deny' });

      expect(shell.handedOff).toEqual([]);
      expect(opened).toEqual([]);
    });
  });

  describe('a link that navigates in place', () => {
    it('lets the window follow our own origin: the router is what it is for', () => {
      const contents = fakeContents();
      const shell = recorder();
      routeLinks(contents, ORIGIN, shell, { openWindow: () => undefined });

      expect(contents.clickLink(`${ORIGIN}/w/w1/entities/e2`)).toBe(true);
      expect(shell.handedOff).toEqual([]);
    });

    /** The stranding this exists to prevent: followed in place, the SPA is gone and there is no back button. */
    it('keeps the window where it was and hands the link to the system browser', () => {
      const contents = fakeContents();
      const shell = recorder();
      routeLinks(contents, ORIGIN, shell, { openWindow: () => undefined });

      expect(contents.clickLink('https://example.com/lore')).toBe(false);
      expect(shell.handedOff).toEqual(['https://example.com/lore']);
    });

    it('keeps the window where it was for a refused scheme, and hands it to nobody', () => {
      const contents = fakeContents();
      const shell = recorder();
      routeLinks(contents, ORIGIN, shell, { openWindow: () => undefined });

      expect(contents.clickLink('file:///etc/passwd')).toBe(false);
      expect(shell.handedOff).toEqual([]);
    });
  });
});

describe('openExternally', () => {
  it('reports a platform refusal instead of throwing: the click has no surface to fail on', async () => {
    const refusing: UrlOpener = { openExternal: () => Promise.reject(new Error('no handler for mailto:')) };
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(openExternally(refusing, 'mailto:gm@example.com')).resolves.toBeUndefined();

    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});
