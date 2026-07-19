import {
  ChangeDetectionStrategy,
  Component,
  Injector,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { NgComponentOutlet } from '@angular/common';
import { TranslocoPipe } from '@jsverse/transloco';
import { isStructuredDataType } from '@hexly/domain';
import { ViewInstance, VIEW_FIELD_KEY, viewInstanceKey } from '@hexly/web-entity';
import { IconComponent, IconName } from '@hexly/web-ui';
import { EntitySession } from '../services/entity-session';
import { EntityViewStore } from '../services/entity-view-store';
import { ViewRegistry } from '../../../entity-types/view-registry';
import { TypeRegistry } from '../../../entity-types/type-registry';
import { PluginRegistry } from '../../../entity-types/plugin-registry';

/**
 * The render context an {@link EntityViewOutletComponent} carries down the transclusion chain
 * (ADR-0062): the ancestor Entity-id chain that bounds cycles, plus the current nesting depth and
 * the configurable cap past which an Embed degrades to a card preview.
 */
export interface EntityRenderContext {
  /** The Entity-id chain from the root to this outlet's parent — a target already in it is a cycle. */
  readonly ancestorIds: readonly string[];
  /** This outlet's nesting depth; the root page renders at 0. */
  readonly depth: number;
  /** The nesting cap: at or past it, the outlet degrades to the card preview (ADR-0062, default 3). */
  readonly maxDepth: number;
}

/** The top-of-page context: no ancestors, depth 0, and the ADR-0062 default cap — so the page never degrades. */
export const DEFAULT_ENTITY_RENDER_CONTEXT: EntityRenderContext = { ancestorIds: [], depth: 0, maxDepth: 3 };

/** What the outlet resolves to render: the chosen View, the card fallback, or the dangling placeholder. */
type OutletMode = 'view' | 'card' | 'dangling';

/**
 * The reusable **Entity View Outlet** (Seam C, #264): hosts one Entity's chosen View, read-only and
 * chrome-free — the View body only, no header toggle, no save orchestration, no editing affordance of
 * its own. The open-Entity page mounts it for its body, and (later) the Board Embed mounts it for
 * transclusion, off **one** implementation.
 *
 * It reads the Entity from the ambient {@link EntitySession} and the active View from the ambient
 * {@link EntityViewStore}. Given an {@link entityId} it drives the fetch itself (the Embed case);
 * left null, it renders whatever the session already holds (the page case, where the route drives the
 * load). An optional {@link viewInstance} pins the View (defaulting, when absent, to the store's
 * default — the target's primary type's first View).
 *
 * It degrades deterministically (ADR-0062):
 * - the **card preview** (name + type icon + snippet) on a cycle (`target ∈ ancestorIds`), at or past
 *   `maxDepth`, or when the chosen View can no longer render (its Field removed, its Plugin disabled);
 * - the **dangling placeholder** when the target is unreadable (private without a grant) or deleted —
 *   never leaking a `private` Entity's substance.
 */
@Component({
  selector: 'app-entity-view-outlet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  imports: [NgComponentOutlet, IconComponent, TranslocoPipe],
  template: `
    @switch (mode()) {
      @case ('dangling') {
        <!-- Unreadable or deleted: a non-navigable placeholder, never the target's substance (ADR-0062). -->
        <div
          data-testid="entity-view-dangling"
          class="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center px-6 bg-surface-sunken"
          role="status"
        >
          <p class="text-ink-muted">{{ 'editorShell.unavailable.title' | transloco }}</p>
        </div>
      }
      @case ('card') {
        <!-- The fallback rendering, not a separate concept (ADR-0062): a compact card of the target. -->
        <div
          data-testid="entity-view-card"
          class="absolute inset-0 flex items-center justify-center p-4 bg-surface-sunken"
        >
          <div class="flex items-center gap-3 min-w-0 max-w-full rounded-md border border-line bg-surface px-4 py-3">
            <span class="shrink-0 size-10 rounded-full flex items-center justify-center bg-surface-sunken">
              <app-icon [name]="cardIcon()" [size]="18" />
            </span>
            <div class="min-w-0">
              <p class="font-display text-md text-ink-strong truncate" data-testid="entity-view-card-name">
                {{ cardName() }}
              </p>
              @if (cardSnippet(); as snippet) {
                <p class="text-xs text-ink-muted line-clamp-2">{{ snippet }}</p>
              }
            </div>
          </div>
        </div>
      }
      @default {
        <!-- The chosen View's component (a plugin view / the generic Field view), resolved from the
             ViewRegistry with no type sniffing (ADR-0048). The injector carries the Field key when the
             View renders a Field of a Structured Data Type, so two grids get one store each (ADR-0050). -->
        @if (activeComponent(); as component) {
          <ng-container *ngComponentOutlet="component; injector: viewInjector()" />
        }
      }
    }
  `,
})
export class EntityViewOutletComponent {
  private readonly session = inject(EntitySession);
  private readonly viewStore = inject(EntityViewStore);
  private readonly views = inject(ViewRegistry);
  private readonly types = inject(TypeRegistry);
  private readonly plugins = inject(PluginRegistry);
  private readonly injector = inject(Injector);

  /**
   * The target to render. Left null, the outlet renders whatever the ambient session already holds
   * (the page, where the route drives the load); set, it drives the fetch itself (the Embed).
   */
  readonly entityId = input<string | null>(null);

  /** The View to pin — the Embed's per-Embed pick. Absent falls to the store's default (the target's default View). */
  readonly viewInstance = input<ViewInstance | null>(null);

  /** The transclusion bounds — cycle chain, depth, and the cap (ADR-0062). Defaults to the top-of-page context. */
  readonly renderContext = input<EntityRenderContext>(DEFAULT_ENTITY_RENDER_CONTEXT);

  /** Set when this outlet's own fetch found the target unreadable or deleted (403/404) — the dangling case. */
  private readonly _dangling = signal(false);

  constructor() {
    // Drive the fetch when we own the target (the Embed case). Left null, the ambient session is driven
    // elsewhere (the page's route watch), so the outlet renders what it already holds.
    effect(() => {
      const id = this.entityId();
      if (!id) return;
      untracked(() => this.load(id));
    });

    // A pinned View flows into the shared store; an unafforded pick falls back there to the default,
    // and is separately caught by chosenUnrenderable() to degrade to the card.
    effect(() => {
      const chosen = this.viewInstance();
      if (chosen) untracked(() => this.viewStore.setView(viewInstanceKey(chosen)));
    });

    // Fetch a deferred View's body once it is the active one (moved off the page with the view-hosting).
    effect(() => this.views.fetch(this.viewStore.activeView().viewId));
  }

  private load(id: string): void {
    this._dangling.set(false);
    // The existing entity-detail data path (ADR-0044): a fetch that 403s/404s is an unreadable or
    // deleted target — the dangling case, never surfaced as content.
    this.session.open(id).subscribe({ error: () => this._dangling.set(true) });
  }

  /** The Entity this outlet resolves against — its own target when set, else whatever the session holds. */
  private readonly targetId = computed(() => this.entityId() ?? this.session.current()?.id ?? null);

  /**
   * A pinned View the target no longer affords — its Field removed or its Plugin disabled, so it drops
   * out of the afforded set (ADR-0052). Only a pinned pick can fail this way; the page's toggle only
   * ever offers afforded Views, so it never degrades here.
   */
  private readonly chosenUnrenderable = computed(() => {
    const chosen = this.viewInstance();
    if (!chosen) return false;
    const key = viewInstanceKey(chosen);
    return !this.viewStore.views().some((view) => viewInstanceKey(view) === key);
  });

  /** Which rendering the outlet resolves to (ADR-0062): the dangling placeholder wins, then the card, then the View. */
  protected readonly mode = computed<OutletMode>(() => {
    if (this._dangling()) return 'dangling';
    const ctx = this.renderContext();
    const target = this.targetId();
    const cycle = target !== null && ctx.ancestorIds.includes(target);
    const tooDeep = ctx.depth >= ctx.maxDepth;
    return cycle || tooDeep || this.chosenUnrenderable() ? 'card' : 'view';
  });

  /** The component to outlet for the active View — absent only while a deferred body is in flight. */
  protected readonly activeComponent = computed(() => this.views.component(this.viewStore.activeView().viewId));

  /**
   * The injector the active View's component is created in — this outlet's own, plus {@link VIEW_FIELD_KEY}
   * when the View renders a Field of a Structured Data Type. Keyed on {@link EntityViewStore.activeFieldKey},
   * which settles, so `NgComponentOutlet` doesn't tear a live map down on every re-derived view list.
   */
  protected readonly viewInjector = computed(() => {
    const fieldKey = this.viewStore.activeFieldKey();
    return Injector.create({
      parent: this.injector,
      providers: fieldKey ? [{ provide: VIEW_FIELD_KEY, useValue: fieldKey }] : [],
    });
  });

  /** The card fallback's Entity name — read off the loaded detail (ADR-0062). */
  protected readonly cardName = computed(() => this.session.current()?.name ?? '');

  /** The card fallback's type icon — the primary type's registered glyph, resolved with no sniffing. */
  protected readonly cardIcon = computed<IconName>(() => this.types.resolve(this.session.current()?.types?.[0]).icon);

  /**
   * The card fallback's snippet — the target's structured Field text, derived through the domain's
   * `extractText` seam (ADR-0019) and truncated. Empty when the target carries no extractable text.
   */
  protected readonly cardSnippet = computed(() => {
    const detail = this.session.current();
    if (!detail) return '';
    const doc = this.session.doc();
    const text = this.types
      .effectiveFields(detail.types, this.session.fields())
      .map((field) =>
        isStructuredDataType(field.dataType)
          ? (this.plugins.structuredDataTypes.get(field.dataType.kind)?.extractText?.(doc[field.id]) ?? '')
          : '',
      )
      .find((part) => part.trim().length > 0);
    return text ? text.trim().slice(0, 140) : '';
  });
}
