import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { EntitySummary, EntityType } from '@hexly/domain';
import { EntitiesClient } from '../../../core/services/entities.client';
import { Button } from '../../../ui/button';
import { Field } from '../../../ui/field';
import { Icon } from '../../../ui/icon/icon';
import { Input } from '../../../ui/input';
import { HexMapStore } from '../services/hexmap-store';

/**
 * The Inspector's Entity Link control (issue #76, CONTEXT.md → Entity Link) for the
 * single selected linkable Map element (a Hex, Feature, or Region — never a Label):
 * pick an Entity to link, follow it, or remove it. The picker searches server-side
 * via `list({ q })` and resolves the linked name via `list({ ids: [id] })` (ADR-0025),
 * never holding the whole owner list. A link to a deleted/inaccessible target renders
 * non-navigable rather than a dead link (issue #78); the id stays in the document.
 */
@Component({
  selector: 'app-entity-link',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, Field, Icon, Input, RouterLink, TranslocoPipe],
  template: `
    <div appField [label]="'editorShell.inspector.linkedEntity' | transloco">
      @let id = store.selectedEntityLink();
      @if (id) {
        <div class="flex items-center gap-2">
          @if (linked(); as e) {
            <a
              class="block flex-1 min-w-0 truncate cursor-pointer font-display text-base text-gold no-underline hover:underline"
              data-testid="entity-link-name"
              [routerLink]="['/entities', id]"
            >
              <span aria-hidden="true">→ </span>{{ e.name }}
              <span class="font-mono text-2xs text-ink-muted">({{ e.type }})</span>
            </a>
          } @else if (resolved()) {
            <!-- Target deleted/inaccessible: visible but non-navigable (issue #78). -->
            <span
              class="block flex-1 min-w-0 truncate font-display text-base italic text-ink-muted"
              data-testid="entity-link-dangling"
              [attr.title]="'editorShell.inspector.linkUnavailable' | transloco"
            >
              <span aria-hidden="true">→ </span
              >{{ 'editorShell.inspector.linkUnavailable' | transloco }}
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
            [attr.aria-label]="'editorShell.inspector.removeLink' | transloco"
            [attr.title]="'editorShell.inspector.removeLink' | transloco"
            (click)="remove()"
          >
            <app-icon name="close" [size]="16" />
          </button>
        </div>
      } @else {
        <button
          type="button"
          appButton
          variant="ghost"
          size="sm"
          data-testid="entity-link-pick"
          (click)="toggle()"
        >
          {{ 'editorShell.inspector.pickLink' | transloco }}
        </button>
      }

      @if (open()) {
        <div
          class="mt-2 rounded-md border border-line bg-surface p-1 shadow-2"
          data-testid="entity-link-menu"
        >
          <input
            appInput
            class="mb-1"
            data-testid="entity-link-search"
            [attr.placeholder]="'editorShell.inspector.searchLink' | transloco"
            [value]="query()"
            (input)="onQuery($event)"
          />
          <!-- Only the option list scrolls; the search box and create row stay pinned
               so create-and-link is always reachable without scrolling past the list. -->
          <div class="max-h-56 overflow-auto">
            @for (e of options(); track e.id) {
              <button
                type="button"
                appButton
                variant="ghost"
                size="sm"
                class="w-full justify-start!"
                [attr.data-testid]="'entity-link-option-' + e.id"
                (click)="pick(e.id)"
              >
                {{ e.name }}
              </button>
            } @empty {
              <p class="px-2 py-1 text-sm text-ink-muted">
                {{ 'editorShell.inspector.linkEmpty' | transloco }}
              </p>
            }
          </div>

          <!-- Create-and-link a brand-new Entity in the same flow (issue #77). The
               typed query names it; an empty query falls back to a default title. -->
          <div class="mt-1 flex gap-1 border-t border-line pt-1">
            <button
              type="button"
              appButton
              variant="ghost"
              size="sm"
              class="flex-1"
              data-testid="entity-link-create-note"
              (click)="create('note')"
            >
              + {{ 'editorShell.inspector.newNote' | transloco }}
            </button>
            <button
              type="button"
              appButton
              variant="ghost"
              size="sm"
              class="flex-1"
              data-testid="entity-link-create-map"
              (click)="create('hexmap')"
            >
              + {{ 'editorShell.inspector.newMap' | transloco }}
            </button>
          </div>
        </div>
      }
    </div>
  `,
})
export class EntityLink {
  protected readonly store = inject(HexMapStore);
  private readonly entitiesClient = inject(EntitiesClient);
  private readonly transloco = inject(TranslocoService);
  private readonly destroyRef = inject(DestroyRef);

  /** The picker's options for the current query — a server-side search (ADR-0025). */
  protected readonly options = signal<EntitySummary[]>([]);

  /**
   * Entities created via create-and-link (issue #77), resolved locally so their
   * name shows at once without a server round trip. The display-resolve still
   * goes to the server for everything else.
   */
  private readonly created = signal<EntitySummary[]>([]);

  /** The linked Entity's summary, or null when unset or unresolvable (dangling). */
  protected readonly linked = signal<EntitySummary | null>(null);
  /** True once resolving the current link has settled, so the template tells "loading" from "dangling". */
  protected readonly resolved = signal(false);

  protected readonly open = signal(false);
  protected readonly query = signal('');

  constructor() {
    // Resolve the linked name on demand (ADR-0025): a freshly-created Entity is
    // known locally; anything else is fetched by id, never by pulling the whole
    // list. onCleanup cancels an in-flight fetch when the link changes or the
    // control is destroyed, so a stale response can't overwrite a newer link.
    effect((onCleanup) => {
      const id = this.store.selectedEntityLink();
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

    // Search server-side as the query changes while the picker is open (ADR-0025).
    // onCleanup cancels the prior search, so responses can't land out of order.
    // ponytail: no debounce — small lists, fine until import.
    effect((onCleanup) => {
      if (!this.open()) return;
      const q = this.query().trim();
      this.options.set([]);
      const sub = this.entitiesClient.list({ q }).subscribe({
        next: (page) => this.options.set(page.items),
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        error: () => {},
      });
      onCleanup(() => sub.unsubscribe());
    });

    // Close the picker and reset the query whenever the selected element changes so
    // a pick() always targets the element the picker was opened for.
    effect(() => {
      this.store.selection();
      this.open.set(false);
      this.query.set('');
    });
  }

  protected toggle(): void {
    if (!this.open()) this.query.set('');
    this.open.update((v) => !v);
  }

  protected onQuery(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  protected pick(id: string): void {
    this.store.linkEntity(id);
    this.open.set(false);
  }

  /**
   * Create a new owner-scoped Entity of `type` and link the selected element to it
   * in one flow (issue #77). The typed query names it; an empty query falls back to
   * a default title. The created Entity is appended locally so its name resolves at
   * once, and the link rides the existing document save like any other.
   */
  protected create(type: EntityType): void {
    const name =
      this.query().trim() ||
      this.transloco.translate(type === 'hexmap' ? 'domain.untitledMap' : 'domain.untitledNote');
    this.entitiesClient
      .create(name, type)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((entity) => {
        // Remember it locally so its name resolves without a server round trip,
        // then link — the resolve effect picks it up from `created`.
        this.created.update((list) => [...list, entity]);
        this.store.linkEntity(entity.id);
        this.open.set(false);
      });
  }

  protected remove(): void {
    this.store.unlinkEntity();
  }
}
