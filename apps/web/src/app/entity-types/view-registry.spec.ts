import { TestBed } from '@angular/core/testing';
import { signal, WritableSignal } from '@angular/core';
import { ENABLED_PLUGINS } from '@hexly/web-core';
import { CORE_HEX_GRID, PLUGIN_ID as HEXMAP_PLUGIN_ID } from '@hexly/plugin-hexmap';
import { CORE_RICH_CONTENT, PLUGIN_ID as CONTENT_PLUGIN_ID } from '@hexly/plugin-content';
import { PLUGIN_ID as DND_PLUGIN_ID } from '@hexly/plugin-dnd';
import { CORE_VIEW_CONTENT, providePluginContent } from '@hexly/plugin-content/web';
import { providePluginDnd } from '@hexly/plugin-dnd/web';
import { providePluginHexmap } from '@hexly/plugin-hexmap/web';
import { CORE_VIEW_FIELDS, CORE_VIEW_MAP } from '@hexly/web-entity';
import { ViewRegistry } from './view-registry';

/** A stand-in for the generic Field View the entity chunk registers at runtime, with no owning Plugin. */
class FieldsViewStub {}

/**
 * ADR-0052, Seam 3: a disabled Plugin's Views fall away with its Types, and so do the data-types they
 * render — so the World Types editor cannot offer a Field this Instance cannot draw, and a placed Field
 * of a disabled kind resolves to no View. Reactive against the enabled-set signal.
 */
describe('ViewRegistry filtering by the enabled-Plugin set', () => {
  let registry: ViewRegistry;
  let enabled: WritableSignal<ReadonlySet<string>>;

  beforeEach(() => {
    // The whole build's Views composed; the signal decides which are live. Content + dnd on, hexmap off.
    enabled = signal<ReadonlySet<string>>(new Set([CONTENT_PLUGIN_ID, DND_PLUGIN_ID]));
    TestBed.configureTestingModule({
      providers: [
        providePluginContent(),
        providePluginHexmap(),
        providePluginDnd(),
        { provide: ENABLED_PLUGINS, useValue: enabled },
      ],
    });
    registry = TestBed.inject(ViewRegistry);
    // The app-owned generic Field View registers from the entity chunk, not a Plugin — do it by hand.
    registry.register({ id: CORE_VIEW_FIELDS, labelKey: 'x', component: FieldsViewStub });
  });

  it('drops a disabled Plugin’s View from `all`, `get`, and `forDataType`', () => {
    // hexmap off: its map View is unregistered-in-effect, its grid data-type unresolvable.
    expect(registry.all().map((d) => d.id)).not.toContain(CORE_VIEW_MAP);
    expect(registry.get(CORE_VIEW_MAP)).toBeUndefined();
    expect(registry.forDataType(CORE_HEX_GRID)).toBeUndefined();
    // The content View is enabled, so its data-type still resolves.
    expect(registry.forDataType(CORE_RICH_CONTENT)?.id).toBe(CORE_VIEW_CONTENT);
  });

  it('offers only enabled data-types to the World Types editor', () => {
    // Prose is offerable (content on); the grid is not (hexmap off) — no Field the Instance can't render.
    const kinds = registry.offerableDataTypes().map((o) => o.kind);
    expect(kinds).toContain(CORE_RICH_CONTENT);
    expect(kinds).not.toContain(CORE_HEX_GRID);
  });

  it('falls back to the generic Field View when a disabled View id is resolved', () => {
    // `resolve` never returns undefined — a disabled Plugin's View id lands on the app-owned floor.
    expect(registry.resolve(CORE_VIEW_MAP).id).toBe(CORE_VIEW_FIELDS);
    expect(registry.component(CORE_VIEW_MAP)).toBe(FieldsViewStub);
  });

  it('recomputes reactively when the enabled set changes', () => {
    expect(registry.forDataType(CORE_HEX_GRID)).toBeUndefined();
    enabled.set(new Set([CONTENT_PLUGIN_ID, HEXMAP_PLUGIN_ID, DND_PLUGIN_ID]));
    expect(registry.forDataType(CORE_HEX_GRID)?.id).toBe(CORE_VIEW_MAP);
    expect(registry.offerableDataTypes().map((o) => o.kind)).toContain(CORE_HEX_GRID);
  });
});
