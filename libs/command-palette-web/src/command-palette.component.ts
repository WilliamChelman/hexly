import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  InjectionToken,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ListKeyManager } from '@angular/cdk/a11y';
import { NgTemplateOutlet } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { of, switchMap } from 'rxjs';
import { TranslocoPipe } from '@jsverse/transloco';
import { ShortcutService } from '@hexly/web-core';
import { ButtonComponent, DialogComponent, InputComponent } from '@hexly/web-ui';
import { Command, CommandProvider, parseCommandQuery } from './command';
import { CommandRegistry, CommandSection } from './command-registry';

/**
 * The Providers a host registers into the Palette on mount (ADR-0032). The concrete Providers live
 * with their domain, not here; the host binds them to this token — order is the palette's section order.
 */
export const COMMAND_PROVIDERS = new InjectionToken<readonly CommandProvider[]>('COMMAND_PROVIDERS');

/**
 * The Command Palette: a Cmd/Ctrl+K overlay, mounted once in {@link App},
 * merging results from every Provider bound to the typed prefix into stable,
 * provider-ordered sections.
 */
@Component({
  selector: 'app-command-palette',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonComponent, DialogComponent, InputComponent, TranslocoPipe, RouterLink, NgTemplateOutlet],
  template: `
    <app-dialog [open]="open()" align="top" (closed)="onDialogClosed()">
      <input
        #search
        appInput
        role="combobox"
        aria-controls="command-palette-listbox"
        aria-autocomplete="list"
        data-testid="command-palette-input"
        [attr.aria-expanded]="open()"
        [attr.aria-activedescendant]="activeItemId()"
        [attr.aria-label]="'commandPalette.searchLabel' | transloco"
        [attr.placeholder]="'commandPalette.placeholder' | transloco"
        [value]="text()"
        (input)="onInput($event)"
        (keydown)="onInputKeydown($event)"
      />
      <div
        id="command-palette-listbox"
        role="listbox"
        class="max-h-80 overflow-auto"
        data-testid="command-palette-results"
        [attr.aria-label]="'commandPalette.searchLabel' | transloco"
      >
        <!-- One flat list, each row tagged with its Provider's label; rows with a
             route render as routerLink anchors so they can open in a new tab. -->
        @for (row of rows(); track row.command.id) {
          @if (row.command.route; as route) {
            <a
              role="option"
              appButton
              variant="ghost"
              size="sm"
              class="w-full justify-between! gap-3"
              [id]="optionId(row.command.id)"
              [active]="row.command === activeCommand()"
              [attr.aria-selected]="row.command === activeCommand()"
              [attr.data-testid]="'command-palette-option-' + row.command.id"
              [routerLink]="route"
              (click)="onLinkClick($event)"
            >
              <ng-container [ngTemplateOutlet]="rowBody" [ngTemplateOutletContext]="{ $implicit: row }" />
            </a>
          } @else {
            <button
              type="button"
              role="option"
              appButton
              variant="ghost"
              size="sm"
              class="w-full justify-between! gap-3"
              [id]="optionId(row.command.id)"
              [active]="row.command === activeCommand()"
              [attr.aria-selected]="row.command === activeCommand()"
              [attr.data-testid]="'command-palette-option-' + row.command.id"
              (click)="pick(row.command)"
            >
              <ng-container [ngTemplateOutlet]="rowBody" [ngTemplateOutletContext]="{ $implicit: row }" />
            </button>
          }
        } @empty {
          <p class="px-2 py-1 text-sm text-ink-muted">
            {{ 'commandPalette.empty' | transloco }}
          </p>
        }
      </div>
    </app-dialog>

    <ng-template #rowBody let-row>
      <span class="flex min-w-0 items-center gap-2">
        <span class="truncate">{{ row.command.label }}</span>
        @if (row.command.hint) {
          <span class="text-2xs text-ink-muted">{{ row.command.hint }}</span>
        }
      </span>
      <span class="shrink-0 text-2xs uppercase tracking-wide text-ink-faint">
        {{ row.label | transloco }}
      </span>
    </ng-template>
  `,
})
export class CommandPaletteComponent {
  private readonly registry = inject(CommandRegistry);
  private readonly router = inject(Router);
  private readonly shortcuts = inject(ShortcutService);
  private readonly builtIns = inject(COMMAND_PROVIDERS, { optional: true }) ?? [];
  // read: ElementRef — #search also hosts appInput, so a bare query would
  // resolve to the Input component instead of the native element.
  private readonly searchInput = viewChild('search', { read: ElementRef });

  protected readonly open = signal(false);
  protected readonly text = signal('');
  private readonly activeIndex = signal(0);

  // Gate the search on open() as well as the query: Providers return snapshot
  // results, so opening must re-run the search against current state rather
  // than replay a stale bootstrap-time result.
  private readonly parsed = computed(() => ({
    open: this.open(),
    ...parseCommandQuery(this.text(), this.registry.prefixes()),
  }));

  protected readonly sections = toSignal(
    toObservable(this.parsed).pipe(
      switchMap(({ open, prefix, query }) =>
        open ? this.registry.search(prefix, query) : of<readonly CommandSection[]>([]),
      ),
    ),
    { initialValue: [] as readonly CommandSection[] },
  );

  protected readonly rows = computed(() =>
    this.sections().flatMap((section: CommandSection) =>
      section.commands.map((command) => ({
        command,
        label: section.provider.label,
      })),
    ),
  );

  // Clamp the highlight to the current rows: a query can resolve to fewer rows
  // than the user already arrowed into, and a raw activeIndex past the list
  // would leave Enter and aria-activedescendant dead.
  protected readonly activeCommand = computed(() => {
    const rows = this.rows();
    if (!rows.length) return null;
    return rows[Math.min(this.activeIndex(), rows.length - 1)].command;
  });

  // Stable per-option DOM ids for the input's aria-activedescendant.
  protected optionId(id: string): string {
    return 'command-opt-' + id;
  }

  protected readonly activeItemId = computed(() => {
    const command = this.activeCommand();
    return command ? this.optionId(command.id) : null;
  });

  constructor() {
    // The Palette mounts once for the app's lifetime, so there's nothing to unregister.
    for (const provider of this.builtIns) this.registry.register(provider);

    // Both ⌘K and Ctrl+K, on every platform (not `mod`) — the palette's historic
    // contract. `inEditable` keeps it reachable mid-typing. Global layer, so any
    // held modal scope (including the palette's own dialog) suppresses it.
    this.shortcuts.register({
      layer: 'global',
      keys: ['ctrl+k', 'meta+k'],
      inEditable: true,
      handler: () => this.open.update((v) => !v),
    });
    // The palette's dialog holds the modal scope while open (ADR-0063, amendment),
    // which silences the global registration above — this modal-layer twin, gated
    // on the palette being open, keeps the chord a toggle both ways. It never
    // opens the palette over someone else's modal: `when` requires open().
    this.shortcuts.register({
      layer: 'modal',
      keys: ['ctrl+k', 'meta+k'],
      inEditable: true,
      when: () => this.open(),
      handler: () => this.open.set(false),
    });

    // A new query invalidates the previous pick — land back on the top result.
    effect(() => {
      this.text();
      untracked(() => this.activeIndex.set(0));
    });

    // Reset on close (toggle, Escape, or pick) so reopening never shows a
    // stale query or selection.
    effect(() => {
      if (this.open()) {
        untracked(() => {
          const el = this.searchInput()?.nativeElement as HTMLInputElement | undefined;
          el?.focus();
        });
      } else {
        untracked(() => {
          this.text.set('');
          this.activeIndex.set(0);
        });
      }
    });
  }

  protected onDialogClosed(): void {
    this.open.set(false);
  }

  protected onInput(event: Event): void {
    this.text.set((event.target as HTMLInputElement).value);
  }

  protected onInputKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      const command = this.activeCommand();
      if (!command) return;
      // Ctrl/Cmd+Enter opens a routable Command in a new tab, mirroring modifier-click.
      if ((event.metaKey || event.ctrlKey) && command.route) {
        this.openInNewTab(command.route);
        this.close();
      } else {
        this.pick(command);
      }
      return;
    }
    const items = this.rows();
    if (!items.length) return;
    // A transient ListKeyManager seeded with the current index computes the next
    // index (with wrap) for this one keystroke. No withHomeAndEnd — it would
    // preventDefault Home/End and steal caret navigation in the search input.
    const options = items.map((row) => ({ getLabel: () => row.command.label }));
    const manager = new ListKeyManager(options).withWrap();
    manager.setActiveItem(Math.min(this.activeIndex(), items.length - 1));
    manager.onKeydown(event);
    if (manager.activeItemIndex != null) {
      this.activeIndex.set(manager.activeItemIndex);
    }
  }

  protected pick(command: Command): void {
    command.run();
    this.close();
  }

  /** Plain left-click: RouterLink navigates, so just close. Modified/middle
   * clicks fall through — the browser opens a new tab and the palette stays open. */
  protected onLinkClick(event: MouseEvent): void {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.button !== 0) {
      return;
    }
    this.close();
  }

  private openInNewTab(route: readonly string[]): void {
    const url = this.router.serializeUrl(this.router.createUrlTree([...route]));
    window.open(url, '_blank', 'noopener');
  }

  private close(): void {
    this.open.set(false);
  }
}
