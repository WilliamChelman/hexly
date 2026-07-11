import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { Button, ButtonGroup, Eyebrow, PageHeader } from '@hexly/web-ui';
import { EntityActionsMenu } from './entity-actions-menu';
import { EntityShareDialog } from './entity-share-dialog';
import { EntityTags } from './entity-tags';
import { SaveStatus } from './save-status';
import { EntitySession } from '../services/entity-session';
import { EntityView, HexMapStore } from '@hexly/web-map';
import { TypeRegistry } from '../../../entity-types/type-registry';

/** The view toggle's two segments, in display order; Map (the grid) is the default. */
const VIEWS: readonly { id: EntityView; labelKey: string; testid: string }[] = [
  { id: 'map', labelKey: 'editorShell.view.map', testid: 'view-map' },
  { id: 'note', labelKey: 'editorShell.view.note', testid: 'view-note' },
];

/**
 * The open Entity's page-owned header (ADR-0022), rendered by {@link EntityPage}
 * for every Entity type: an eyebrow tag, editable title, autosave status chip
 * ({@link SaveStatus}, ADR-0026), Tags and Share. App navigation lives in the NavRail.
 *
 * Fully driven by {@link EntitySession.current} — the eyebrow/title labels switch on
 * the Entity's `type`, and the Map/Note view toggle (#75) shows only for a `hexmap`.
 */
@Component({
  selector: 'app-entity-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  imports: [
    Button,
    ButtonGroup,
    Eyebrow,
    PageHeader,
    EntityActionsMenu,
    EntityShareDialog,
    TranslocoPipe,
    EntityTags,
    SaveStatus,
  ],
  template: `
    <app-page-header>
      <div pageHeaderTitle class="flex items-center gap-3 min-w-0 flex-1">
        <div class="flex items-center gap-3 shrink-0">
          <span appEyebrow class="text-gold! tracking-[0.28em] whitespace-nowrap">{{
            labels().eyebrow | transloco
          }}</span>
          <!--
            Text is driven imperatively (effect, never while focused) rather than
            interpolated, so re-renders can't move the caret mid-edit.
          -->
          <div
            #titleEl
            class="font-display text-[22px] font-semibold tracking-[0.01em] text-ink whitespace-nowrap py-1 px-2 -my-1 -mx-2 rounded-sm border border-transparent outline-none hover:border-line hover:bg-surface-sunken focus:bg-surface-sunken focus:border-gold"
            [class.cursor-text]="editable()"
            data-testid="title"
            role="textbox"
            aria-multiline="false"
            spellcheck="false"
            [attr.tabindex]="editable() ? 0 : null"
            [attr.contenteditable]="editable() ? 'plaintext-only' : null"
            [attr.aria-label]="labels().titleLabel | transloco"
            [title]="titleHint() | transloco"
            (focus)="onFocus()"
            (keydown.enter)="onEnter($event)"
            (keydown.escape)="onEscape($event)"
            (blur)="commit()"
          ></div>
          <app-save-status />
        </div>

        <app-entity-tags class="min-w-0 flex-1" />
      </div>

      @if (isHexmap()) {
        <!-- Map/Note view toggle (#75): a hexmap carries both a grid and a Content
             body; this flips the editor surface between them, driven off the store's
             view() so the shell renders whichever is pressed. -->
        <div
          pageHeaderActions
          appButtonGroup
          [attr.aria-label]="'editorShell.view.switchLabel' | transloco"
        >
          @for (v of views; track v.id) {
            <button
              type="button"
              appButton
              variant="ghost"
              size="sm"
              [active]="store.view() === v.id"
              [attr.aria-pressed]="store.view() === v.id"
              [attr.data-testid]="v.testid"
              (click)="selectView(v.id)"
            >
              {{ v.labelKey | transloco }}
            </button>
          }
        </div>
      }

      <!-- The Entity's actions — Visibility, Pin, and Share — gathered behind one overflow
           menu. Share is this header's dialog surface, so the menu emits (share) and we open it. -->
      <app-entity-actions-menu
        pageHeaderActions
        (share)="ownersOpen.set(true)"
      />
    </app-page-header>

    <app-entity-share-dialog
      [open]="ownersOpen()"
      (closed)="ownersOpen.set(false)"
      (resigned)="onResigned()"
    />
  `,
})
export class EntityHeader {
  private readonly session = inject(EntitySession);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  /** Owns the Map/Note surface choice, shared with the {@link EntityPage} body (#75). */
  protected readonly store = inject(HexMapStore);
  private readonly types = inject(TypeRegistry);
  protected readonly views = VIEWS;

  /** Whether the entity Share dialog (#158) is open — toggled by the actions menu's Share item. */
  protected readonly ownersOpen = signal(false);

  /** Resigning can cost reach to this Entity, so drop back to the World Index. */
  protected onResigned(): void {
    this.ownersOpen.set(false);
    this.router.navigate(['/']);
  }

  /**
   * The title is editable when an Entity is open and the caller may write it (ADR-0037) — a
   * read-only member sees it, can't rename it, and gets no visibility toggle (also
   * `@if (editable())`).
   */
  protected readonly editable = computed(
    () => this.session.current() !== null && this.session.writable(),
  );
  /** Tooltip key: the in-place rename affordance. */
  protected readonly titleHint = computed(() => this.labels().rename);
  /** Only a hexmap affords both surfaces, so only it gets the view toggle (#75). */
  protected readonly isHexmap = computed(() =>
    this.types.affordsMap(this.session.current()?.document.type),
  );
  /** Per-type header chrome (eyebrow + title a11y labels), falling back to the note type. */
  protected readonly labels = computed(
    () => this.types.resolve(this.session.current()?.document.type).labels,
  );
  protected readonly title = computed(
    () => this.session.current()?.name ?? '',
  );

  private readonly titleEl =
    viewChild.required<ElementRef<HTMLElement>>('titleEl');

  /**
   * The name at focus time. commit() compares against this, not the live
   * {@link title}, so an unedited blur after a mid-edit server change (e.g. conflict
   * reload) doesn't re-send the stale name. `null` when not editing.
   */
  private editBaseline: string | null = null;

  constructor() {
    // Mirror the open Entity's name into the contenteditable — but never while the
    // user is editing it, or the write would fight the caret.
    effect(() => {
      const name = this.title();
      const el = this.titleEl().nativeElement;
      if (document.activeElement !== el) el.textContent = name;
    });
  }

  protected onFocus(): void {
    this.editBaseline = this.titleEl().nativeElement.textContent ?? '';
  }

  /** Commit on Enter without inserting a newline (blur runs {@link commit}). */
  protected onEnter(event: Event): void {
    event.preventDefault();
    this.titleEl().nativeElement.blur();
  }

  protected onEscape(event: Event): void {
    event.preventDefault();
    // Make the pending blur-commit a no-op against the restored name.
    this.editBaseline = this.title();
    this.titleEl().nativeElement.textContent = this.title();
    this.titleEl().nativeElement.blur();
  }

  /** No-op if blank or unchanged (normalises text back); a rejected rename reverts the optimistic text. */
  protected commit(): void {
    const el = this.titleEl().nativeElement;
    const baseline = this.editBaseline ?? this.title();
    this.editBaseline = null;
    // The title is single-line (aria-multiline=false); collapse any pasted
    // newlines/whitespace so they never reach the stored name.
    const name = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (!name || name === baseline) {
      el.textContent = this.title();
      return;
    }
    this.session.rename(name).subscribe({
      error: () => (el.textContent = this.title()),
    });
  }

  /**
   * Switch the editor surface (#75). Updates the store for instant feedback, then
   * mirrors the choice to the URL `view` param (`replaceUrl`, Map drops the param)
   * so a refresh restores it. Reverts the store if the navigation is cancelled.
   */
  protected selectView(view: EntityView): void {
    const previous = this.store.view();
    this.store.setView(view);
    this.router
      .navigate([], {
        relativeTo: this.route,
        queryParams: { view: view === 'map' ? null : view },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      })
      .then((navigated) => {
        if (!navigated) this.store.setView(previous);
      });
  }
}
