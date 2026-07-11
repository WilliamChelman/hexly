import { Injectable, signal } from '@angular/core';
import { CORE_VIEW_CONTENT, ViewDefinition, ViewId } from './view-definition';

/**
 * Root registry mapping a {@link ViewId} to the component that renders it, the
 * sibling of {@link TypeRegistry} for Views (ADR-0048, *Views* amendment). The
 * {@link EntityPage} outlets `resolve(activeView).component`, so the residual
 * `isHexmap` branch is gone — the page dispatches on the active View, not the type.
 *
 * Deliberately component-import-free so it stays out of the initial bundle: the
 * core view components (which pull in web-map / TipTap) register themselves from
 * the lazily-loaded entity chunk, the same way a bundled plugin would.
 */
@Injectable({ providedIn: 'root' })
export class ViewRegistry {
  private readonly definitions = signal<readonly ViewDefinition[]>([]);

  /** Every registered View, in registration order (core first). */
  readonly all = this.definitions.asReadonly();

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
   * The definition for `id`, falling back to the always-present `core.view.content`
   * for an absent/unregistered View — the base every Entity affords, so the host
   * always resolves to *something* to outlet (mirrors {@link TypeRegistry.resolve}).
   */
  resolve(id: ViewId | null | undefined): ViewDefinition {
    return this.get(id) ?? this.get(CORE_VIEW_CONTENT)!;
  }
}
