import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { EntitySummary, EntityType } from '@hexly/domain';
import { EntitiesClient, ActiveWorld } from '@hexly/web-core';
import { Button, Field, Icon, EntitySearchPicker } from '@hexly/web-ui';
import { ENTITY_TYPES } from '../lib/entity-types';

/**
 * The **Entity Link** control (CONTEXT.md → Entity Link) for one link-carrying slot: pick an Entity to
 * link, follow it, or remove it. Searches server-side via `list({ q })` and resolves the linked name
 * via `list({ ids: [id] })` (ADR-0025), never holding the whole owner list. A link to a
 * deleted/inaccessible target renders non-navigable rather than a dead link; the id stays in the
 * document.
 *
 * The host owns the link: this component only reads the current value and emits the next one.
 *
 * Create-and-link offers every Type the {@link ENTITY_TYPES} registry knows, except a type declaring a
 * **required** Field: it cannot be minted blind (the write gate), and there is no room mid-pick for the
 * dialog that would collect one.
 */
@Component({
  selector: 'app-entity-link-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, Field, Icon, EntitySearchPicker, RouterLink, TranslocoPipe],
  template: `
    <div appField [label]="'fields.entityLink.linkedEntity' | transloco">
      @let id = entityId();
      @if (id) {
        <div class="flex items-center gap-2">
          @if (linked(); as e) {
            <a
              class="block flex-1 min-w-0 truncate cursor-pointer font-display text-base text-gold no-underline hover:underline"
              data-testid="entity-link-name"
              [routerLink]="['/entities', id]"
            >
              <span aria-hidden="true">→ </span>{{ e.name }}
              <span class="font-mono text-2xs text-ink-muted">({{ e.types[0] }})</span>
            </a>
          } @else if (resolved()) {
            <!-- Target deleted/inaccessible: visible but non-navigable (issue #78). -->
            <span
              class="block flex-1 min-w-0 truncate font-display text-base italic text-ink-muted"
              data-testid="entity-link-dangling"
              [attr.title]="'fields.entityLink.unavailable' | transloco"
            >
              <span aria-hidden="true">→ </span>{{ 'fields.entityLink.unavailable' | transloco }}
            </span>
          } @else {
            <!-- List still loading: neutral placeholder, never a clickable dead link. -->
            <span class="block flex-1 min-w-0 truncate font-display text-base text-ink-muted">
              <span aria-hidden="true">→ </span>…
            </span>
          }
          <button
            type="button"
            appButton
            variant="ghost"
            size="sm"
            icon
            danger
            data-testid="entity-link-remove"
            [attr.aria-label]="'fields.entityLink.remove' | transloco"
            [attr.title]="'fields.entityLink.remove' | transloco"
            (click)="linkChange.emit(null)"
          >
            <app-icon name="close" [size]="16" />
          </button>
        </div>
      } @else {
        <button type="button" appButton variant="ghost" size="sm" data-testid="entity-link-pick" (click)="toggle()">
          {{ 'fields.entityLink.set' | transloco }}
        </button>
      }

      @if (open()) {
        <app-entity-search-picker
          class="mt-2 block"
          testid="entity-link"
          placeholderKey="fields.entityLink.search"
          emptyKey="fields.entityLink.empty"
          [query]="query()"
          (queryChange)="query.set($event)"
          (pick)="pick($event.id)"
        >
          <!-- Create-and-link in the same flow (issue #77): the query names it, empty → that type's
               own untitled default. Projected below the picker's option list; it stays pinned as the
               list scrolls. -->
          <div class="mt-1 flex flex-wrap gap-1 border-t border-line pt-1">
            @for (type of creatable(); track type.id) {
              <button
                type="button"
                appButton
                variant="ghost"
                size="sm"
                class="flex-1"
                [attr.data-testid]="'entity-link-create-' + type.id"
                (click)="create(type.id)"
              >
                + {{ type.name }}
              </button>
            }
          </div>
        </app-entity-search-picker>
      }
    </div>
  `,
})
export class EntityLinkPicker {
  /** The linked Entity's id, as the host holds it — `null` when the slot carries no link. */
  readonly entityId = input<string | null>(null);
  /**
   * *Which slot* the link belongs to, as an opaque handle — the Hex Map passes its selection. When it
   * changes the picker closes and its query clears, so a pick always lands on the slot the picker was
   * opened for: two unlinked Hexes both read `entityId === null`, and only this tells them apart.
   */
  readonly slot = input<unknown>(null);
  /** The link the host should adopt: an Entity id when one is picked or created, `null` on remove. */
  readonly linkChange = output<string | null>();

  private readonly types = inject(ENTITY_TYPES);
  private readonly activeWorld = inject(ActiveWorld);
  private readonly entitiesClient = inject(EntitiesClient);
  private readonly transloco = inject(TranslocoService);
  private readonly destroyRef = inject(DestroyRef);

  /** Entities created via create-and-link, resolved locally so their name shows without a round trip. */
  private readonly created = signal<EntitySummary[]>([]);

  /** The linked Entity's summary, or null when unset or unresolvable (dangling). */
  protected readonly linked = signal<EntitySummary | null>(null);
  /** True once resolving the current link has settled, so the template tells "loading" from "dangling". */
  protected readonly resolved = signal(false);

  protected readonly open = signal(false);
  protected readonly query = signal('');

  /**
   * The Types create-and-link offers, each with the name to print on its button. `activeLang` is read
   * as the reactive dependency, so the names re-resolve on a language switch.
   */
  protected readonly creatable = computed(() => {
    this.transloco.activeLang();
    return (
      this.types
        .all()
        // Offer only Types whose effective Fields are all optional — a required Field a bare create
        // can't satisfy would bounce off the forward-only gate (resolved by id now, ADR-0054).
        .filter((def) => !this.types.resolveFields([def.id]).some((field) => field.required))
        .map((def) => ({ id: def.id, name: this.types.name(def.id) }))
    );
  });

  constructor() {
    // Resolve the linked name on demand (ADR-0025): created entities are known locally,
    // others fetched by id. onCleanup cancels stale responses on link change.
    effect((onCleanup) => {
      const id = this.entityId();
      this.linked.set(null);
      this.resolved.set(false);
      if (!id) {
        this.resolved.set(true);
        return;
      }
      const local = untracked(() => this.created().find((e) => e.id === id));
      if (local) {
        this.linked.set(local);
        this.resolved.set(true);
        return;
      }
      const sub = this.entitiesClient.list({ ids: [id] }).subscribe({
        next: (page) => {
          this.linked.set(page.items[0] ?? null);
          this.resolved.set(true);
        },
        error: () => this.resolved.set(true),
      });
      onCleanup(() => sub.unsubscribe());
    });

    // Close the picker and reset the query whenever the host's slot changes, so a pick() always
    // targets the slot the picker was opened for.
    effect(() => {
      this.slot();
      this.open.set(false);
      this.query.set('');
    });
  }

  protected toggle(): void {
    if (!this.open()) this.query.set('');
    this.open.update((v) => !v);
  }

  protected pick(id: string): void {
    this.linkChange.emit(id);
    this.open.set(false);
  }

  /**
   * Create a World-scoped Entity of `type` and link it in one flow. The typed query names it; an empty
   * one falls back to the type's own untitled label.
   */
  protected create(type: EntityType): void {
    const name = this.query().trim() || this.types.chromeLabel(type, 'untitled');
    this.entitiesClient
      // Scope the create-and-link Entity to the World in the URL (ADR-0028) so it
      // lands in the same World as the Entity being edited, not the owner's oldest.
      .create(name, [type], this.activeWorld.worldId() ?? undefined)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((entity) => {
        // Remember it locally so its name resolves without a server round trip,
        // then link — the resolve effect picks it up from `created`.
        this.created.update((list) => [...list, entity]);
        this.linkChange.emit(entity.id);
        this.open.set(false);
      });
  }
}
