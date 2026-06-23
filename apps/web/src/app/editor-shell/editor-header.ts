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
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { Button } from '../ui/button';
import { Chip } from '../ui/chip';
import { Eyebrow } from '../ui/eyebrow';
import { ShareIcon } from '../ui/icon/glyphs/share';
import { inputValue } from './dom';
import { EditorSession } from './editor-session';

/**
 * The editor's interactive header content, projected into the single
 * {@link AppHeader}'s named `header` outlet (ADR-0015): the editable map title,
 * the Editing/conflict chip, and the map-scoped actions (Save, Share, and the
 * navigation back to the library / styleguide). The global chrome — brand, theme
 * toggle, user identity + Sign out — lives in {@link AppHeader}, not here.
 */
@Component({
  selector: 'app-editor-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Pure-layout shell containers use inline utilities (ADR-0020): no
  // var-indirection, no state — nothing a scoped rule would protect. The
  // stateful/indirection-driven bits (.title, .title-input) stay scoped below.
  host: { class: 'flex flex-1 items-center gap-5' },
  imports: [RouterLink, Button, Chip, Eyebrow, ShareIcon, TranslocoPipe],
  template: `
    <div class="flex items-center gap-3 pl-5 border-l border-line">
      <span appEyebrow>{{ 'editorShell.hexMap' | transloco }}</span>
      @if (editing()) {
        <input
          class="title-input"
          data-testid="title-input"
          [attr.aria-label]="'editorShell.mapTitleLabel' | transloco"
          [value]="draft()"
          (input)="draft.set(inputValue($event))"
          (keydown.enter)="commitRename()"
          (keydown.escape)="cancelRename()"
          (blur)="commitRename()"
          #titleInput
        />
      } @else {
        <button
          type="button"
          class="title"
          data-testid="title"
          [title]="'editorShell.renameMap' | transloco"
          [disabled]="!hasMap()"
          (click)="startRename()"
        >
          {{ title() }}
        </button>
      }
      @if (conflict()) {
        <app-chip tone="gold" data-testid="conflict">
          {{ 'editorShell.save.conflict' | transloco }}
          <button
            type="button"
            class="conflict-reload"
            data-testid="conflict-reload"
            (click)="reload()"
          >
            {{ 'editorShell.reload' | transloco }}
          </button>
        </app-chip>
      } @else {
        <app-chip tone="sea">{{ 'editorShell.editing' | transloco }}</app-chip>
      }
    </div>

    <div class="flex items-center gap-2 ml-auto">
      <a appButton variant="ghost" size="sm" routerLink="/maps">{{
        'editorShell.allMaps' | transloco
      }}</a>
      <a appButton variant="ghost" size="sm" routerLink="/styleguide">{{
        'editorShell.designSystem' | transloco
      }}</a>
      <button
        type="button"
        appButton
        variant="ghost"
        size="sm"
        data-testid="save"
        [disabled]="saving() || !hasMap()"
        (click)="save()"
      >
        {{ (saving() ? 'editorShell.saving' : 'common.save') | transloco }}
      </button>
      <button type="button" appButton variant="primary" size="sm">
        <app-icon-share [size]="16" />
        {{ 'editorShell.share' | transloco }}
      </button>
    </div>
  `,
  styles: `
    .title {
      font-family: var(--font-display);
      font-size: var(--text-md);
      color: var(--color-ink);
      padding: var(--spacing-1) var(--spacing-2);
      margin: calc(-1 * var(--spacing-1)) calc(-1 * var(--spacing-2));
      background: none;
      border: 1px solid transparent;
      border-radius: var(--radius-sm);
      cursor: text;
    }
    .title:hover {
      border-color: var(--color-line);
      background: var(--color-surface-sunken);
    }
    .title-input {
      font-family: var(--font-display);
      font-size: var(--text-md);
      color: var(--color-ink-strong);
      padding: var(--spacing-1) var(--spacing-2);
      margin: calc(-1 * var(--spacing-1)) calc(-1 * var(--spacing-2));
      background: var(--color-surface-sunken);
      border: 1px solid var(--color-gold);
      border-radius: var(--radius-sm);
      outline: none;
    }
    .conflict-reload {
      margin-left: var(--spacing-2);
      padding: 0;
      font: inherit;
      color: inherit;
      text-decoration: underline;
      background: none;
      border: none;
      cursor: pointer;
    }
  `,
})
export class EditorHeader {
  private readonly session = inject(EditorSession);

  /** Whether a map is open — gates Save and rename so neither can run with none. */
  protected readonly hasMap = computed(() => this.session.current() !== null);
  /** The open map's title, or a placeholder before one is opened. */
  protected readonly title = computed(
    () => this.session.current()?.title ?? 'Untitled map',
  );
  /** Whether a save is in flight — disables the Save button. */
  protected readonly saving = this.session.saving;
  /** The server's current map when a save was rejected as stale, else `null`. */
  protected readonly conflict = this.session.conflict;

  /** Whether the title is being edited inline. */
  protected readonly editing = signal(false);
  /** The working title while editing, committed on Enter/blur. */
  protected readonly draft = signal('');
  private readonly titleInput =
    viewChild<ElementRef<HTMLInputElement>>('titleInput');

  constructor() {
    // Focus (and select) the rename field as soon as it appears, so the user can
    // type straight away.
    effect(() => {
      const input = this.titleInput();
      if (input) input.nativeElement.select();
    });
  }

  /** Read the current value out of an input event (template-visible alias). */
  protected readonly inputValue = inputValue;

  /** Enter inline edit, seeded with the current title. */
  protected startRename(): void {
    this.draft.set(this.title());
    this.editing.set(true);
  }

  /**
   * Commit the edited title. A no-op (unchanged or blank) just closes the editor
   * without a request. Guarded against a double fire when Enter is followed by
   * the input's blur.
   */
  protected commitRename(): void {
    if (!this.editing()) return;
    this.editing.set(false);
    const name = this.draft().trim();
    if (!name || name === this.title()) return;
    this.session.rename(name).subscribe();
  }

  /** Abandon the edit, leaving the title unchanged. */
  protected cancelRename(): void {
    this.editing.set(false);
  }

  /** Persist the current map. A stale-version rejection surfaces as a conflict
   * chip (driven by the session) rather than an error. */
  protected save(): void {
    this.session.save().subscribe();
  }

  /** Resolve a surfaced conflict by re-pulling the server's current map. */
  protected reload(): void {
    this.session.reload().subscribe();
  }
}
