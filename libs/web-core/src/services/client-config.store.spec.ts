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

  /** Drive init() to completion against a stubbed GET /api/config response. */
  async function initWith(config: ClientConfig): Promise<void> {
    const done = store.init();
    http.expectOne('/api/config').flush(config);
    await done;
  }

  it('fetches GET /api/config and exposes the enabled-Plugin set and default type', async () => {
    await initWith({
      plugins: { content: { enabled: true }, hexmap: { enabled: false }, dnd: { enabled: true } },
      entities: { defaultType: 'core.note' },
    });

    expect([...store.enabledPlugins()].sort()).toEqual(['content', 'dnd']);
    expect(store.isPluginEnabled('content')).toBe(true);
    expect(store.isPluginEnabled('hexmap')).toBe(false);
    expect(store.defaultType()).toBe('core.note');
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
});
