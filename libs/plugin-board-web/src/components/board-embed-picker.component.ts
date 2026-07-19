import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { TranslocoPipe } from '@jsverse/transloco';
import { EntitySummary } from '@hexly/domain';
import { ENTITY_VIEW_CHOICES, EntitySearchPickerComponent } from '@hexly/web-entity';
import { ButtonComponent, DialogComponent, DialogRef } from '@hexly/web-ui';
import { keyedViewChoices, KeyedViewChoice } from '../utils/embed-view-choices';

/** What the picker is launched with: the World whose Entities it searches. */
export interface EmbedPickerData {
  readonly worldId: string;
}

/** What the Embed picker resolves to: the target Entity and the chosen View's instance key (`''` = default). */
export interface EmbedChoice {
  readonly targetEntityId: string;
  readonly viewInstance: string;
}

/**
 * The **Embed** target chooser (ADR-0062, #270): the dialog the Embed Tool opens to pick *which Entity*
 * an Embed transcludes and *which of its Views* it renders, before the element lands. Two steps in one
 * dialog — search-pick a target (via the shared {@link EntitySearchPickerComponent}), then pick a View
 * from the target's afforded set (resolved across the `ENTITY_VIEW_CHOICES` seam, since a plugin cannot
 * reach the app's registries). Confirming {@link DialogRef.close closes} with the {@link EmbedChoice};
 * cancelling closes with `undefined`, and no element is placed.
 *
 * The View list is best-effort: an unreadable target or an app that binds no resolver yields no choices,
 * so the Embed falls to the target's default View — the Outlet still degrades correctly per viewer.
 */
@Component({
  selector: 'app-board-embed-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DialogComponent, ButtonComponent, EntitySearchPickerComponent, TranslocoPipe],
  template: `
    <app-dialog open align="top" [heading]="'board.embedPicker.title' | transloco" (closed)="cancel()">
      <div class="flex flex-col gap-4">
        <!-- Step 1: pick the target Entity. -->
        <div class="flex flex-col gap-2">
          <span class="text-sm text-ink-strong">{{ 'board.embedPicker.target' | transloco }}</span>
          <app-entity-search-picker
            testid="embed-target"
            placeholderKey="board.embedPicker.searchPlaceholder"
            emptyKey="board.embedPicker.noMatches"
            [query]="query()"
            [worldId]="ref.data.worldId"
            (queryChange)="query.set($event)"
            (pick)="onPick($event)"
          />
        </div>

        <!-- Step 2: pick which View the Embed renders (once a target is chosen). -->
        @if (target(); as target) {
          <div class="flex flex-col gap-2" data-testid="embed-view-step">
            <span class="text-sm text-ink-strong">
              {{ 'board.embedPicker.chosenTarget' | transloco }} <strong>{{ target.name }}</strong>
            </span>
            <span class="text-sm text-ink-muted">{{ 'board.embedPicker.view' | transloco }}</span>
            <div class="flex flex-col gap-1" role="radiogroup" [attr.aria-label]="'board.embedPicker.view' | transloco">
              <label class="view-choice">
                <input
                  type="radio"
                  name="embed-view"
                  data-testid="embed-view-default"
                  [checked]="viewKey() === ''"
                  (change)="viewKey.set('')"
                />
                {{ 'board.embedPicker.defaultView' | transloco }}
              </label>
              @for (choice of choices(); track choice.key) {
                <label class="view-choice">
                  <input
                    type="radio"
                    name="embed-view"
                    [attr.data-testid]="'embed-view-' + choice.key"
                    [checked]="viewKey() === choice.key"
                    (change)="viewKey.set(choice.key)"
                  />
                  {{ choice.label }}
                </label>
              }
            </div>
          </div>
        }
      </div>

      <div dialogFooter class="flex gap-2">
        <button appButton type="button" data-testid="embed-picker-cancel" (click)="cancel()">
          {{ 'board.embedPicker.cancel' | transloco }}
        </button>
        <button
          appButton
          variant="primary"
          type="button"
          data-testid="embed-picker-confirm"
          [disabled]="!target()"
          (click)="confirm()"
        >
          {{ 'board.embedPicker.confirm' | transloco }}
        </button>
      </div>
    </app-dialog>
  `,
  styles: `
    @reference '#app-styles.css';

    .view-choice {
      @apply flex items-center gap-2 text-sm text-ink cursor-pointer rounded-md px-2 py-1 hover:bg-surface-sunken;
    }
  `,
})
export class BoardEmbedPickerComponent {
  protected readonly ref = inject<DialogRef<EmbedPickerData, EmbedChoice>>(DialogRef);
  private readonly viewChoices = inject(ENTITY_VIEW_CHOICES, { optional: true });

  /** The search box query, owned here (the shared picker is presentation-only). */
  protected readonly query = signal('');
  /** The chosen target Entity, once picked — gates the View step and the confirm button. */
  protected readonly target = signal<EntitySummary | null>(null);
  /** The chosen View's instance key; `''` is the target's default View. */
  protected readonly viewKey = signal('');
  /** The target's afforded Views (beyond its default), resolved across the seam. */
  protected readonly choices = signal<readonly KeyedViewChoice[]>([]);

  /** The in-flight View-choices request, cancelled on a re-pick and on teardown (ADR-0062). */
  private choicesSub: Subscription | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.choicesSub?.unsubscribe());
  }

  /** Adopt the picked target and load its View choices; the View resets to the target's default. */
  protected onPick(entity: EntitySummary): void {
    this.target.set(entity);
    this.viewKey.set('');
    this.choices.set([]);
    // Cancel a prior in-flight request so a rapid re-pick can't paint the earlier target's Views.
    this.choicesSub?.unsubscribe();
    this.choicesSub = keyedViewChoices(this.viewChoices, entity.id).subscribe((choices) => this.choices.set(choices));
  }

  /** Close with the chosen target and View — what the Embed Tool places an element from. */
  protected confirm(): void {
    const target = this.target();
    if (target) this.ref.close({ targetEntityId: target.id, viewInstance: this.viewKey() });
  }

  /** Dismiss without choosing; the Embed Tool places nothing. */
  protected cancel(): void {
    this.ref.close();
  }
}
