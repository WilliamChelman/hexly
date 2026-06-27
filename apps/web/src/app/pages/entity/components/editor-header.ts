import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  viewChild,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { Button } from '../../../ui/button';
import { ButtonGroup } from '../../../ui/button-group';
import { Chip } from '../../../ui/chip';
import { Eyebrow } from '../../../ui/eyebrow';
import { Icon } from '../../../ui/icon/icon';
import { PageHeader } from '../../../ui/page-header';
import { EntityTags } from './entity-tags';
import { EntitySession } from '../services/entity-session';
import { EntityView, HexMapStore } from '../services/hexmap-store';

/** The view toggle's two segments, in display order; Map (the grid) is the default. */
const VIEWS: readonly { id: EntityView; labelKey: string; testid: string }[] = [
  { id: 'map', labelKey: 'editorShell.view.map', testid: 'view-map' },
  { id: 'note', labelKey: 'editorShell.view.note', testid: 'view-note' },
];

/**
 * The hex map editor's page-owned header (ADR-0022): fills the shared
 * {@link PageHeader} with the map's own controls — editable title, Editing/Conflict
 * chip, Tags, view toggle, Save/Share. App navigation lives in the NavRail, not here.
 */
@Component({
  selector: 'app-editor-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  imports: [
    Button,
    ButtonGroup,
    Chip,
    Eyebrow,
    Icon,
    PageHeader,
    TranslocoPipe,
    EntityTags,
  ],
  template: `
    <app-page-header>
      <div pageHeaderTitle class="flex items-center gap-3 min-w-0 flex-1">
        <div class="flex items-center gap-3 shrink-0">
          <span appEyebrow class="text-gold! tracking-[0.28em] whitespace-nowrap">{{
            'editorShell.hexMap' | transloco
          }}</span>
          <!--
            Text is driven imperatively (effect, never while focused) rather than
            interpolated, so re-renders can't move the caret mid-edit.
          -->
          <div
            #titleEl
            class="font-display text-[22px] font-semibold tracking-[0.01em] text-ink whitespace-nowrap py-1 px-2 -my-1 -mx-2 rounded-sm border border-transparent outline-none hover:border-line hover:bg-surface-sunken focus:bg-surface-sunken focus:border-gold"
            [class.cursor-text]="hasMap()"
            data-testid="title"
            role="textbox"
            aria-multiline="false"
            spellcheck="false"
            [attr.tabindex]="hasMap() ? 0 : null"
            [attr.contenteditable]="hasMap() ? 'plaintext-only' : null"
            [attr.aria-label]="'editorShell.mapTitleLabel' | transloco"
            [title]="'editorShell.renameMap' | transloco"
            (focus)="onFocus()"
            (keydown.enter)="onEnter($event)"
            (keydown.escape)="onEscape($event)"
            (blur)="commit()"
          ></div>
          @if (conflict()) {
            <app-chip tone="gold" data-testid="conflict">
              {{ 'editorShell.save.conflict' | transloco }}
              <button
                type="button"
                class="ml-2 p-0 underline bg-transparent border-0 cursor-pointer"
                data-testid="conflict-reload"
                (click)="reload()"
              >
                {{ 'editorShell.reload' | transloco }}
              </button>
            </app-chip>
          } @else {
            <app-chip tone="gold">{{ 'editorShell.editing' | transloco }}</app-chip>
          }
        </div>

        <app-entity-tags class="min-w-0 flex-1" />
      </div>

      @if (hasMap()) {
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

      <button
        type="button"
        pageHeaderActions
        appButton
        variant="ghost"
        size="sm"
        data-testid="save"
        [disabled]="saving() || !hasMap()"
        (click)="save()"
      >
        {{ (saving() ? 'editorShell.saving' : 'common.save') | transloco }}
      </button>
      <button type="button" pageHeaderActions appButton variant="primary" size="sm">
        <app-icon name="share" [size]="16" />
        {{ 'editorShell.share' | transloco }}
      </button>
    </app-page-header>
  `,
})
export class EditorHeader {
  private readonly session = inject(EntitySession);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  /** Owns the Map/Note surface choice, shared with the {@link EditorShell} (#75). */
  protected readonly store = inject(HexMapStore);
  protected readonly views = VIEWS;

  /** Whether a map is open — gates Save and rename so neither can run with none. */
  protected readonly hasMap = computed(() => this.session.current() !== null);
  protected readonly title = computed(
    () => this.session.current()?.name ?? 'Untitled map',
  );
  protected readonly saving = this.session.saving;
  /** The server's current map when a save was rejected as stale, else `null`. */
  protected readonly conflict = this.session.conflict;

  private readonly titleEl =
    viewChild.required<ElementRef<HTMLElement>>('titleEl');

  /**
   * The name at focus time. commit() compares against this, not the live
   * {@link title}, so an unedited blur after a mid-edit server change (e.g. conflict
   * reload) doesn't re-send the stale name. `null` when not editing.
   */
  private editBaseline: string | null = null;

  constructor() {
    // Mirror the open map's name into the contenteditable — but never while the
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

  /** Stale-version rejection surfaces as a conflict chip (driven by the session) rather than an error. */
  protected save(): void {
    this.session.save().subscribe();
  }

  protected reload(): void {
    this.session.reload().subscribe();
  }
}
