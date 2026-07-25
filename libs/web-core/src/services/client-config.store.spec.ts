import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ClientConfig } from '@hexly/domain';
import { ClientConfigStore } from './client-config.store';

describe('ClientConfigStore', () => {
  let store: ClientConfigStore;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    store = TestBed.inject(ClientConfigStore);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  /** Drives init() against a stubbed GET /api/config; flags default to a server Instance, Collaboration on. */
  async function initWith(config: Partial<ClientConfig> & Pick<ClientConfig, 'plugins' | 'entities'>): Promise<void> {
    const done = store.init();
    const body: ClientConfig = { profile: 'server', collaboration: true, ...config };
    http.expectOne('/api/config').flush(body);
    await done;
  }

  it('fetches GET /api/config and exposes the enabled-Plugin set and default type', async () => {
    await initWith({
      plugins: { content: { enabled: true }, hexmap: { enabled: false }, dnd: { enabled: true } },
      entities: { defaultType: 'core.type.note' },
    });

    expect([...store.enabledPlugins()].sort()).toEqual(['content', 'dnd']);
    expect(store.isPluginEnabled('content')).toBe(true);
    expect(store.isPluginEnabled('hexmap')).toBe(false);
    expect(store.defaultType()).toBe('core.type.note');
  });

  it('starts empty before init resolves, so a read before boot sees no enabled set', () => {
    expect(store.enabledPlugins().size).toBe(0);
    expect(store.defaultType()).toBeUndefined();
  });

  it('degrades to the boot defaults when the fetch fails, rather than throwing', async () => {
    const done = store.init();
    http.expectOne('/api/config').flush('boom', { status: 500, statusText: 'Server Error' });
    await expect(done).resolves.toBeUndefined();

    expect(store.enabledPlugins().size).toBe(0);
    expect(store.defaultType()).toBeUndefined();
  });

  describe('the deployment knobs (ADR-0071)', () => {
    const PLUGINS_AND_TYPE = { plugins: {}, entities: { defaultType: 'core.type.note' } };

    it('reads Collaboration on and the server profile before init resolves', () => {
      expect(store.isCollaborationEnabled()).toBe(true);
      expect(store.isDesktopProfile()).toBe(false);
    });

    it('exposes a predicate per flag once the channel resolves', async () => {
      await initWith({ ...PLUGINS_AND_TYPE, profile: 'desktop', collaboration: false });

      expect(store.isCollaborationEnabled()).toBe(false);
      expect(store.isDesktopProfile()).toBe(true);
    });

    it('reads the two flags independently — a server Instance can have Collaboration off', async () => {
      await initWith({ ...PLUGINS_AND_TYPE, profile: 'server', collaboration: false });

      expect(store.isCollaborationEnabled()).toBe(false);
      expect(store.isDesktopProfile()).toBe(false);
    });

    it('falls open on a payload that omits the flags, rather than reading them as off', async () => {
      const done = store.init();
      // An older server than the SPA asking it: a missing flag must not close a gate.
      http.expectOne('/api/config').flush(PLUGINS_AND_TYPE);
      await done;

      expect(store.isCollaborationEnabled()).toBe(true);
      expect(store.isDesktopProfile()).toBe(false);
    });

    it('falls open on a failed fetch, keeping Collaboration on and the server profile', async () => {
      const done = store.init();
      http.expectOne('/api/config').flush('boom', { status: 500, statusText: 'Server Error' });
      await done;

      expect(store.isCollaborationEnabled()).toBe(true);
      expect(store.isDesktopProfile()).toBe(false);
    });
  });
});
