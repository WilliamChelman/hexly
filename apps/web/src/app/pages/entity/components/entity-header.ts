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
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { Button, ButtonGroup, Eyebrow, PageHeader } from '@hexly/web-ui';
import { EntityActionsMenu } from './entity-actions-menu';
import { EntityShareDialog } from './entity-share-dialog';
import { EntityTypesDialog } from './entity-types-dialog';
import { EntityTags } from './entity-tags';
import { SaveStatus } from './save-status';
import { EntitySession } from '../services/entity-session';
import { TypeRegistry } from '../../../entity-types/type-registry';
import { TypeLabels } from '../../../entity-types/type-definition';
import { ViewRegistry } from '../../../entity-types/view-registry';
import { EntityViewStore } from '../services/entity-view-store';
import { ViewId } from '../../../entity-types/view-definition';

/**
 * The open Entity's page-owned header (ADR-0022), rendered by {@link EntityPage}
 * for every Entity type: an eyebrow tag, editable title, autosave status chip
 * ({@link SaveStatus}, ADR-0026), Tags and Share. App navigation lives in the NavRail.
 *
 * Fully driven by {@link EntitySession.current} — the eyebrow/title labels switch on
 * the primary type, and the view toggle (#75) offers one button per View the Entity's
 * types afford (ADR-0048, *Views* amendment), shown only when there is more than one.
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
    EntityTypesDialog,
    TranslocoPipe,
    EntityTags,
    SaveStatus,
  ],
  template: `
    <app-page-header>
      <div pageHeaderTitle class="flex items-center gap-3 min-w-0 flex-1">
        <div class="flex items-center gap-3 shrink-0">
          <span appEyebrow class="text-gold! tracking-[0.28em] whitespace-nowrap">{{ eyebrow() }}</span>
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
            [attr.aria-label]="titleLabel()"
            [title]="titleHint()"
            (focus)="onFocus()"
            (keydown.enter)="onEnter($event)"
            (keydown.escape)="onEscape($event)"
            (blur)="commit()"
          ></div>
          <app-save-status />
        </div>

        <app-entity-tags class="min-w-0 flex-1" />
      </div>

      @if (viewToggle().length > 1) {
        <!-- View toggle (#75, ADR-0048): one button per View the Entity's types afford
             (a hexmap: Map + Note), flipping the outletted body via the active View. -->
        <div pageHeaderActions appButtonGroup [attr.aria-label]="'editorShell.view.switchLabel' | transloco">
          @for (v of viewToggle(); track v.id) {
            <button
              type="button"
              appButton
              variant="ghost"
              size="sm"
              [active]="activeView() === v.id"
              [attr.aria-pressed]="activeView() === v.id"
              [attr.data-testid]="v.id"
              (click)="selectView(v.id)"
            >
              {{ v.labelKey | transloco }}
            </button>
          }
        </div>
      }

      <!-- The Entity's actions — Edit types, Visibility, Pin, and Share — gathered behind one
           overflow menu. Share and Edit types are this header's dialog surfaces, so the menu emits
           and we open them. -->
      <app-entity-actions-menu pageHeaderActions (share)="ownersOpen.set(true)" (editTypes)="typesOpen.set(true)" />
    </app-page-header>

    <app-entity-share-dialog [open]="ownersOpen()" (closed)="ownersOpen.set(false)" (resigned)="onResigned()" />
    <app-entity-types-dialog [open]="typesOpen()" (closed)="typesOpen.set(false)" />
  `,
})
export class EntityHeader {
  private readonly session = inject(EntitySession);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  /** Owns the active-View choice, shared with the {@link EntityPage} body (#75). */
  private readonly viewStore = inject(EntityViewStore);
  private readonly views = inject(ViewRegistry);
  private readonly types = inject(TypeRegistry);
  private readonly transloco = inject(TranslocoService);

  /**
   * One of the primary type's chrome labels, already resolved — re-derived when the primary type or
   * the language changes. A user-defined type has no transloco copy, so it resolves to its authored
   * name rather than being run through translate (#191).
   */
  private chromeLabel(key: keyof TypeLabels) {
    return computed(() => {
      this.transloco.activeLang(); // reactive dependency: re-resolve on a language switch
      return this.types.chromeLabel(this.session.types()[0], key);
    });
  }

  /** Whether the entity Share dialog (#158) is open — toggled by the actions menu's Share item. */
  protected readonly ownersOpen = signal(false);

  /** Whether the Edit-types dialog (#189) is open — toggled by the actions menu's Edit types item. */
  protected readonly typesOpen = signal(false);

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
  protected readonly editable = computed(() => this.session.current() !== null && this.session.writable());
  /** Tooltip: the in-place rename affordance. */
  protected readonly titleHint = this.chromeLabel('rename');
  /** The active View id, driving which toggle button reads as pressed. */
  protected readonly activeView = this.viewStore.activeView;
  /** The Views the open Entity affords, resolved to their toggle definitions (label + testid). */
  protected readonly viewToggle = computed(() => this.viewStore.views().map((id) => this.views.resolve(id)));
  /** The header eyebrow tag and the title's accessible name, from the live primary type (`types[0]`). */
  protected readonly eyebrow = this.chromeLabel('eyebrow');
  protected readonly titleLabel = this.chromeLabel('titleLabel');
  protected readonly title = computed(() => this.session.current()?.name ?? '');

  private readonly titleEl = viewChild.required<ElementRef<HTMLElement>>('titleEl');

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
   * Switch the active View (#75, ADR-0048). Updates the store for instant feedback,
   * then mirrors the choice to the URL `view` param (`replaceUrl`) so a refresh
   * restores it — the default View (the primary type's first) drops the param, others
   * carry the full View id. Reverts the store if the navigation is cancelled.
   */
  protected selectView(view: ViewId): void {
    const previous = this.viewStore.activeView();
    this.viewStore.setView(view);
    const isDefault = this.viewStore.views()[0] === view;
    this.router
      .navigate([], {
        relativeTo: this.route,
        queryParams: { view: isDefault ? null : view },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      })
      .then((navigated) => {
        if (!navigated) this.viewStore.setView(previous);
      });
  }
}
