import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  viewChild,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { Button } from '../../../ui/button';
import { Chip } from '../../../ui/chip';
import { Eyebrow } from '../../../ui/eyebrow';
import { Icon } from '../../../ui/icon/icon';
import { PageHeader } from '../../../ui/page-header';
import { EntityTags } from './entity-tags';
import { EntitySession } from '../services/entity-session';

/**
 * The hex map editor's page-owned header (ADR-0022): it fills the shared
 * {@link PageHeader} frame with the map's own controls — the editable title, the
 * Editing/Conflict status chip, Tags, and Save/Share — and nothing else. App-level
 * navigation (the former All Maps / Design System buttons) now lives in the
 * {@link NavRail}, not here.
 */
@Component({
  selector: 'app-editor-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  imports: [Button, Chip, Eyebrow, Icon, PageHeader, TranslocoPipe, EntityTags],
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
   * The name shown when the field was focused — the text the user started from.
   * commit() renames only when the field actually changed against *this*, not the
   * live {@link title}: so an unedited blur after the name changed server-side
   * mid-edit (e.g. a conflict reload) restores the new name rather than re-sending
   * the stale one over it. `null` when not editing.
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

  /** Stale-version rejection surfaces as a conflict chip (driven by the session) rather than an error. */
  protected save(): void {
    this.session.save().subscribe();
  }

  protected reload(): void {
    this.session.reload().subscribe();
  }
}
