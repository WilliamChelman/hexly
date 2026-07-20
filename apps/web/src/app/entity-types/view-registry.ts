import { Injectable, Type, computed, inject, signal } from '@angular/core';
import { StructuredDataTypeId } from '@hexly/domain';
import { CORE_VIEW_FIELDS, PLUGIN_VIEWS, ViewDefinition, ViewId } from '@hexly/web-entity';
import { PluginRegistry } from './plugin-registry';

/**
 * Root registry mapping a {@link ViewId} to the component that renders it, the sibling of
 * {@link TypeRegistry} for Views (ADR-0048, *Views* amendment).
 *
 * Must stay component-import-free, so it stays out of the initial bundle: core views register
 * themselves from the lazily-loaded entity chunk, and a bundled plugin's views are seeded from
 * `PLUGIN_VIEWS` with a `loadComponent` that keeps the body in its own chunk.
 */
@Injectable({ providedIn: 'root' })
export class ViewRegistry {
  private readonly definitions = signal<readonly ViewDefinition[]>([]);
  /** Deferred components, once fetched. Keyed by View id, and never evicted: a component class is stable. */
  private readonly fetched = signal<ReadonlyMap<ViewId, Type<unknown>>>(new Map());
  private readonly inFlight = new Map<ViewId, Promise<void>>();

  /** Owns the enablement predicate (`isViewActive`) the reactive outputs filter through (ADR-0052, Seam 3). */
  private readonly plugins = inject(PluginRegistry);

  /** Every *enabled* View, in registration order (the bundled plugins' first, then core). */
  readonly all = computed(() => this.definitions().filter((def) => this.plugins.isViewActive(def.id)));

  constructor() {
    // Seeded at startup, unlike the core views: the header must know a View to draw its toggle, and
    // only the *body* of a plugin view is deferred.
    for (const def of inject(PLUGIN_VIEWS, { optional: true }) ?? []) this.register(def);
  }

  register(definition: ViewDefinition): () => void {
    this.definitions.update((list) => [...list, definition]);
    return () => this.definitions.update((list) => list.filter((d) => d !== definition));
  }

  /**
   * The definition registered for `id`, or `undefined` for an unregistered **or disabled** View — so a
   * disabled Plugin's View reads as absent, and {@link resolve} falls to the generic Field View.
   */
  get(id: ViewId | null | undefined): ViewDefinition | undefined {
    if (id == null) return undefined;
    const def = this.definitions().find((d) => d.id === id);
    return def && this.plugins.isViewActive(def.id) ? def : undefined;
  }

  /**
   * The View that renders a Field of the **Structured Data Type** `kind` (`core.datatype.hex-grid` → the map View),
   * or `undefined` when this build registers none — or ships it from a **disabled** Plugin. So even an
   * enabled Type's placed Field of a disabled kind degrades to a plain value (ADR-0050, ADR-0052).
   */
  forDataType(kind: string | null | undefined): ViewDefinition | undefined {
    if (kind == null) return undefined;
    return this.definitions().find((d) => d.dataType === kind && this.plugins.isViewActive(d.id));
  }

  /**
   * The **Structured Data Types** a World Owner may declare a Field of, named for the picker.
   * Derived from the *enabled* Views: a disabled Plugin's data-type is not offerable — a World Owner
   * cannot declare a Field this Instance cannot render (ADR-0052).
   */
  offerableDataTypes(): { kind: StructuredDataTypeId; labelKey: string }[] {
    return this.all().flatMap((d) => (d.dataType ? [{ kind: d.dataType, labelKey: d.dataTypeLabelKey }] : []));
  }

  /**
   * The definition for `id`, falling back to the always-present generic `core.view.fields` for an
   * absent/unregistered View (ADR-0051; mirrors {@link TypeRegistry.resolve}). The content View is a
   * plugin's now, so the app-owned fallback is the one View genuinely always present.
   */
  resolve(id: ViewId | null | undefined): ViewDefinition {
    return this.get(id) ?? this.get(CORE_VIEW_FIELDS)!;
  }

  /**
   * The component to outlet for `id` — `undefined` only while a deferred View's chunk is in flight.
   * An eagerly-declared View (every core one) resolves synchronously.
   *
   * Side-effect-free: pair it with {@link fetch}, which requests the chunk.
   */
  component(id: ViewId | null | undefined): Type<unknown> | undefined {
    const definition = this.resolve(id);
    return definition.component ?? this.fetched().get(definition.id);
  }

  /**
   * Request `id`'s component, if it is deferred and not already here. Idempotent, so it is safe to
   * call on every activation.
   *
   * Resolves when the component is here — the same in-flight promise for concurrent callers, and an
   * already-resolved one for a View whose body is present.
   */
  fetch(id: ViewId | null | undefined): Promise<void> {
    const definition = this.resolve(id);
    const { id: viewId, loadComponent } = definition;
    if (!loadComponent || this.fetched().has(viewId)) return Promise.resolve();
    const inFlight = this.inFlight.get(viewId);
    if (inFlight) return inFlight;

    const done = loadComponent()
      .then((component) => {
        this.fetched.update((map) => new Map(map).set(viewId, component));
      })
      .finally(() => this.inFlight.delete(viewId));
    this.inFlight.set(viewId, done);
    return done;
  }
}
