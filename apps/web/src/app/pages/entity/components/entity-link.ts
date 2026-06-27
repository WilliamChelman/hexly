import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
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
 * The Inspector's Entity Link control (issue #76, CONTEXT.md → Entity Link). For
 * the single selected linkable Map element (a Hex, Feature, or Region — never a
 * Label, which is why the Inspector only mounts this in those branches) it lets a
 * worldbuilder pick another Entity to link to, follow the link to jump to it, and
 * remove it. The picker filters the owner's whole entity list — notes and maps
 * alike (ADR-0023's owner-scoped `list()`, no search endpoint) — so a Feature can
 * point at another `hexmap`. The link itself lives in the document and rides the
 * existing save; this control only reads/writes it through the {@link HexMapStore}.
 * A link whose target is deleted or inaccessible (absent from the owner's list, so
 * unresolvable — ADR-0018) renders **non-navigable**: a muted, unfollowable label
 * rather than a dead `/entities/:id` link, so deleting an Entity never breaks a map
 * that referenced it (issue #78). The id stays in the document untouched.
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
          } @else if (loaded()) {
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
            @for (e of filtered(); track e.id) {
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

  /**
   * The owner's entities, fetched once on mount (owner-scoped, no search endpoint —
   * ADR-0023). Writable so a create-and-link (issue #77) can append the new Entity
   * and have its name resolve immediately, without re-fetching the whole list.
   */
  private readonly entities = signal<EntitySummary[]>([]);

  /** True once the list has arrived, so the template can tell "still loading" from "unresolved/dangling". */
  protected readonly loaded = signal(false);

  protected readonly open = signal(false);
  protected readonly query = signal('');

  constructor() {
    this.entitiesClient.list().subscribe((list) => {
      this.entities.set(list);
      this.loaded.set(true);
    });

    // Close the picker and reset the query whenever the selected element changes so
    // a pick() always targets the element the picker was opened for.
    effect(() => {
      this.store.selection();
      this.open.set(false);
      this.query.set('');
    });
  }

  /** The picker list, filtered by a case-insensitive name match on the query. */
  protected readonly filtered = computed(() => {
    const q = this.query().trim().toLowerCase();
    return this.entities().filter((e) => e.name.toLowerCase().includes(q));
  });

  /**
   * The linked Entity's summary, resolved from the owner list, or null when unset or
   * unresolvable (the target is deleted/inaccessible, so absent from the list). A
   * null with a present id and {@link loaded} true is a dangling link — rendered
   * non-navigable.
   */
  protected readonly linked = computed<EntitySummary | null>(() => {
    const id = this.store.selectedEntityLink();
    if (!id) return null;
    return this.entities().find((e) => e.id === id) ?? null;
  });

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
    this.entitiesClient.create(name, type).subscribe((entity) => {
      this.entities.update((list) => [...list, entity]);
      this.store.linkEntity(entity.id);
      this.open.set(false);
    });
  }

  protected remove(): void {
    this.store.unlinkEntity();
  }
}
