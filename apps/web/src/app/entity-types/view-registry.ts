import { Injectable, Type, inject, signal } from '@angular/core';
import { StructuredDataTypeId } from '@hexly/domain';
import { CORE_VIEW_CONTENT, PLUGIN_VIEWS, ViewDefinition, ViewId } from '@hexly/web-entity';

/**
 * Root registry mapping a {@link ViewId} to the component that renders it, the
 * sibling of {@link TypeRegistry} for Views (ADR-0048, *Views* amendment). The
 * {@link EntityPage} outlets `component(activeView)`, so the residual `isHexmap`
 * branch is gone — the page dispatches on the active View, not the type.
 *
 * Deliberately component-import-free so it stays out of the initial bundle. Its two
 * kinds of registrant reach that end from opposite directions:
 *
 * - The **core views** (which pull in the map plugin / TipTap) register themselves from the
 *   lazily-loaded entity chunk, where naming the class is already free.
 * - A **bundled plugin's** views are seeded here at startup, from `PLUGIN_VIEWS`, and
 *   name their component through a `loadComponent` that keeps the body in its own chunk.
 */
@Injectable({ providedIn: 'root' })
export class ViewRegistry {
  private readonly definitions = signal<readonly ViewDefinition[]>([]);
  /** Deferred components, once fetched. Keyed by View id, and never evicted: a component class is stable. */
  private readonly fetched = signal<ReadonlyMap<ViewId, Type<unknown>>>(new Map());
  private readonly inFlight = new Map<ViewId, Promise<void>>();

  /** Every registered View, in registration order (the bundled plugins' first, then core). */
  readonly all = this.definitions.asReadonly();

  constructor() {
    // The bundled plugins' Views (#192), from whichever `providePluginX()` the app provided. Seeded at
    // startup, unlike the core views: the header must know a View to draw its toggle, and only the
    // *body* of a plugin view is deferred.
    for (const def of inject(PLUGIN_VIEWS, { optional: true }) ?? []) this.register(def);
  }

  register(definition: ViewDefinition): () => void {
    this.definitions.update((list) => [...list, definition]);
    return () => this.definitions.update((list) => list.filter((d) => d !== definition));
  }

  /** The definition registered for `id`, or `undefined` for an unregistered View. */
  get(id: ViewId | null | undefined): ViewDefinition | undefined {
    if (id == null) return undefined;
    return this.definitions().find((d) => d.id === id);
  }

  /**
   * The View that renders a **Structured Field** of data-type `kind` (`core.hex-grid` → the map View),
   * or `undefined` when this build registers none: the plugin that ships the data-type ships the View,
   * so the two are absent together (ADR-0050).
   */
  forDataType(kind: string | null | undefined): ViewDefinition | undefined {
    if (kind == null) return undefined;
    return this.definitions().find((d) => d.dataType === kind);
  }

  /**
   * The **Structured Field** data-types a World Owner may declare a Field of (#201), each with the
   * copy naming it in the World Types editor's picker.
   *
   * Derived from the registered Views, not the data-type set: a data-type with no View is a Field
   * whose value has no editor, so offering it would hand a World Owner a slot they could never fill.
   */
  offerableDataTypes(): { kind: StructuredDataTypeId; labelKey: string }[] {
    return this.definitions().flatMap((d) => (d.dataType ? [{ kind: d.dataType, labelKey: d.dataTypeLabelKey }] : []));
  }

  /**
   * The definition for `id`, falling back to the always-present `core.view.content`
   * for an absent/unregistered View — the base every Entity affords, so the host
   * always resolves to *something* to outlet (mirrors {@link TypeRegistry.resolve}).
   */
  resolve(id: ViewId | null | undefined): ViewDefinition {
    return this.get(id) ?? this.get(CORE_VIEW_CONTENT)!;
  }

  /**
   * The component to outlet for `id` — `undefined` only while a deferred View's chunk is in flight.
   * An eagerly-declared View (every core one) resolves synchronously.
   *
   * Pair it with {@link fetch}: this reads, that requests. Kept apart so the read stays side-effect-free.
   */
  component(id: ViewId | null | undefined): Type<unknown> | undefined {
    const definition = this.resolve(id);
    return definition.component ?? this.fetched().get(definition.id);
  }

  /**
   * Request `id`'s component, if it is deferred and not already here. Idempotent, so it is safe to call
   * on every activation; toggling back to a fetched View is synchronous.
   *
   * Returns when the component is here — the same in-flight promise for concurrent callers, and an
   * already-resolved one for a View whose body is present. The page ignores it and re-renders off
   * {@link component}; a caller that must wait for a deferred View's chunk awaits this.
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
