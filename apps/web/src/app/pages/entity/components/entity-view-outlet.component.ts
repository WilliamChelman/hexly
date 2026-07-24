import {
  ChangeDetectionStrategy,
  Component,
  ComponentRef,
  Injector,
  Type,
  ViewContainerRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { isStructuredDataType } from '@hexly/domain';
import {
  DEFAULT_ENTITY_RENDER_CONTEXT,
  ENTITY_RENDER_CONTEXT,
  EntityRenderContext,
  ViewInstance,
  VIEW_FIELD_KEY,
  viewInstanceKey,
} from '@hexly/web-entity';
import { IconComponent, IconName } from '@hexly/web-ui';
import { EntitySession } from '../services/entity-session';
import { EntityViewStore } from '../services/entity-view-store';
import { ViewRegistry } from '../../../entity-types/view-registry';
import { TypeRegistry } from '../../../entity-types/type-registry';
import { PluginRegistry } from '../../../entity-types/plugin-registry';

// The render-context contract now lives in `web-entity` so a plugin that renders an Embed (the Board) can
// advance and pass it without importing the app (ADR-0048, #270). Re-exported for existing app callers.
export { DEFAULT_ENTITY_RENDER_CONTEXT, type EntityRenderContext } from '@hexly/web-entity';

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
  imports: [IconComponent, TranslocoPipe],
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
    }
    <!-- The chosen View's component (a plugin view / the generic Field view), resolved from the
         ViewRegistry with no type sniffing (ADR-0048) and created *manually* (not *ngComponentOutlet):
         only manual creation exposes the running View's own injector, which the outlet emits so the
         page's Dock can host View-contributed Panels with it (ADR-0067, #294). Empty in the card/dangling
         modes and while a deferred body loads. The anchor stays mounted across modes so a mode flip never
         races the created View's teardown — {@link mountView} owns create/destroy off the resolved mode. -->
    <ng-container #viewHost />
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

  /**
   * The manually-created active View's own injector — emitted so a host can hand it to the page's Dock,
   * which instantiates View-contributed Panels with it (ADR-0067, #294). `null` while no View body is
   * mounted (the card/dangling fallbacks, or a deferred body in flight). The page binds this to the Dock;
   * the Board Embed leaves it unbound, so a transcluded View never feeds a Dock (the Dock is page chrome).
   */
  readonly viewInjectorChange = output<Injector | null>();

  /** The anchor the active View is created into — always mounted, so a mode flip never races its teardown. */
  private readonly viewHost = viewChild('viewHost', { read: ViewContainerRef });

  /** The live created View, torn down (never re-pointed) whenever the component or its injector changes. */
  private viewRef: ComponentRef<unknown> | null = null;

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

    // Manually create the active View so its injector escapes to the Dock (ADR-0067, #294). Reacts to the
    // resolved mode, the component, and the per-instance injector — remounting on any change, matching what
    // `*ngComponentOutlet` did. The card/dangling fallbacks pass no component, so the View body never mounts
    // there (recursion stops, ADR-0062).
    effect(() => {
      const host = this.viewHost();
      const component = this.mode() === 'view' ? this.activeComponent() : undefined;
      const injector = this.viewInjector();
      untracked(() => this.mountView(host, component, injector));
    });
  }

  /**
   * Create (or tear down) the active View in {@link viewHost}, and emit its injector. The previous instance
   * is always destroyed first — never re-pointed — so switching grids rebuilds the component and its
   * VIEW_FIELD_KEY-scoped store rather than re-aiming a live one at another Field (ADR-0050), exactly as
   * `*ngComponentOutlet` recreated on a component/injector change.
   */
  private mountView(
    host: ViewContainerRef | undefined,
    component: Type<unknown> | undefined,
    injector: Injector,
  ): void {
    this.viewRef?.destroy();
    this.viewRef = null;
    if (!host || !component) {
      this.viewInjectorChange.emit(null);
      return;
    }
    this.viewRef = host.createComponent(component, { injector });
    this.viewInjectorChange.emit(this.viewRef.injector);
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
   * carrying the Field the View renders. Keyed on {@link EntityViewStore.activeFieldKey}, which settles, so
   * {@link mountView} doesn't tear a live map down on every re-derived view list.
   *
   * {@link VIEW_FIELD_KEY} is provided **unconditionally** — `null` for a Type's own View (a Note's prose,
   * placed by id, names no Field). It must *shadow* the token, not defer to it: an Embed's Outlet nests
   * inside the enclosing View's injector (a Board's surface View provides `core.field.surface`), so a
   * Field-less View that skipped the provider would let the transcluded editor inherit the *outer* View's
   * key and read the wrong document slot — the empty-body Embed bug. A `null` here lets the editor fall to
   * its canonical Field key (ADR-0051, ADR-0062).
   */
  protected readonly viewInjector = computed(() => {
    const fieldKey = this.viewStore.activeFieldKey() ?? null;
    return Injector.create({
      parent: this.injector,
      providers: [
        // The context this outlet renders at, so a transcluded surface's own Embeds read where they sit
        // and advance it by one level (ADR-0062, #270).
        { provide: ENTITY_RENDER_CONTEXT, useValue: this.renderContext() },
        { provide: VIEW_FIELD_KEY, useValue: fieldKey },
      ],
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
