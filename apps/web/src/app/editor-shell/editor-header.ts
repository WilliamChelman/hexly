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
import { AuthStore } from '../auth/auth.store';
import { ThemeService } from '../core/theme.service';
import { Button } from '../ui/button';
import { Cartouche } from '../ui/cartouche';
import { Chip } from '../ui/chip';
import { Eyebrow } from '../ui/eyebrow';
import { LogoIcon } from '../ui/icon/glyphs/logo';
import { MoonIcon } from '../ui/icon/glyphs/moon';
import { ShareIcon } from '../ui/icon/glyphs/share';
import { SunIcon } from '../ui/icon/glyphs/sun';
import { EditorSession } from './editor-session';

/** The top chrome: brand, map title, and the global actions (theme, share). */
@Component({
  selector: 'app-editor-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    Button,
    Cartouche,
    Chip,
    Eyebrow,
    LogoIcon,
    MoonIcon,
    ShareIcon,
    SunIcon,
  ],
  template: `
    <div class="brand">
      <span class="mark"><app-icon-logo [size]="26" /></span>
      <span class="name" appCartouche>Hexly</span>
    </div>

    <div class="titlebar">
      <span appEyebrow>Hex map</span>
      @if (editing()) {
        <input
          class="title-input"
          data-testid="title-input"
          aria-label="Map title"
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
          title="Rename map"
          [disabled]="!hasMap()"
          (click)="startRename()"
        >
          {{ title() }}
        </button>
      }
      @if (conflict()) {
        <app-chip tone="gold" data-testid="conflict">
          Newer version on server
          <button
            type="button"
            class="conflict-reload"
            data-testid="conflict-reload"
            (click)="reload()"
          >
            Reload
          </button>
        </app-chip>
      } @else {
        <app-chip tone="sea">Editing</app-chip>
      }
    </div>

    <div class="actions">
      <a appButton variant="ghost" size="sm" routerLink="/maps">All maps</a>
      <a appButton variant="ghost" size="sm" routerLink="/styleguide">Design system</a>
      <button
        type="button"
        appButton
        variant="ghost"
        icon
        (click)="themeService.toggle()"
        [attr.aria-label]="
          theme() === 'dark' ? 'Switch to parchment theme' : 'Switch to astral theme'
        "
        [title]="theme() === 'dark' ? 'Parchment (light)' : 'Astral (dark)'"
      >
        @if (theme() === 'dark') {
          <app-icon-sun [size]="20" />
        } @else {
          <app-icon-moon [size]="20" />
        }
      </button>
      <button
        type="button"
        appButton
        variant="ghost"
        size="sm"
        data-testid="save"
        [disabled]="saving() || !hasMap()"
        (click)="save()"
      >
        {{ saving() ? 'Saving…' : 'Save' }}
      </button>
      <button type="button" appButton variant="primary" size="sm">
        <app-icon-share [size]="16" />
        Share
      </button>
      @if (user(); as u) {
        <span class="avatar" [title]="u.displayName">{{ initials() }}</span>
        <span class="who">{{ u.displayName }}</span>
        <button
          type="button"
          appButton
          variant="ghost"
          size="sm"
          data-testid="sign-out"
          (click)="signOut()"
        >
          Sign out
        </button>
      }
    </div>
  `,
  styles: `
    :host {
      display: flex;
      align-items: center;
      gap: var(--space-5);
      padding: 0 var(--space-4);
      background: var(--surface);
      border-bottom: 1px solid var(--line-strong);
      box-shadow: var(--shadow-1);
    }
    .brand {
      display: flex;
      align-items: center;
      gap: var(--space-2);
    }
    .mark {
      display: grid;
      place-items: center;
      color: var(--gold);
    }
    .name {
      font-size: var(--text-lg);
      color: var(--ink-strong);
    }
    .titlebar {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      padding-left: var(--space-5);
      border-left: 1px solid var(--line);
    }
    .title {
      font-family: var(--font-display);
      font-size: var(--text-md);
      color: var(--ink);
      padding: var(--space-1) var(--space-2);
      margin: calc(-1 * var(--space-1)) calc(-1 * var(--space-2));
      background: none;
      border: 1px solid transparent;
      border-radius: var(--radius-sm);
      cursor: text;
    }
    .title:hover {
      border-color: var(--line);
      background: var(--surface-sunken);
    }
    .title-input {
      font-family: var(--font-display);
      font-size: var(--text-md);
      color: var(--ink-strong);
      padding: var(--space-1) var(--space-2);
      margin: calc(-1 * var(--space-1)) calc(-1 * var(--space-2));
      background: var(--surface-sunken);
      border: 1px solid var(--gold);
      border-radius: var(--radius-sm);
      outline: none;
    }
    .actions {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      margin-left: auto;
    }
    .avatar {
      display: grid;
      place-items: center;
      width: 32px;
      height: 32px;
      font-family: var(--font-mono);
      font-size: var(--text-2xs);
      color: var(--on-gold);
      background: linear-gradient(140deg, var(--gold), var(--gold-strong));
      border-radius: var(--radius-full);
      box-shadow: var(--shadow-1);
    }
    .who {
      font-size: var(--text-sm);
      color: var(--ink);
    }
    .conflict-reload {
      margin-left: var(--space-2);
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
  private readonly auth = inject(AuthStore);
  private readonly session = inject(EditorSession);
  protected readonly themeService = inject(ThemeService);
  protected readonly theme = this.themeService.theme;

  /** The signed-in user, shown in the header; `null` until authenticated. */
  protected readonly user = this.auth.currentUser;

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

  /** Read the current value out of an input event. */
  protected inputValue(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

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

  /** The user's initials for the avatar (e.g. "Ada Lovelace" → "AL"). */
  protected readonly initials = computed(() => {
    const name = this.user()?.displayName ?? '';
    return name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('');
  });

  /** End the session and return to the login screen (ADR-0004). */
  protected signOut(): void {
    this.auth.signOut();
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
