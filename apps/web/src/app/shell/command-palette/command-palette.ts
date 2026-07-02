import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  InjectionToken,
  Provider,
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
import { Button } from '../../ui/button';
import { Dialog } from '../../ui/dialog';
import { Input } from '../../ui/input';
import { Command, CommandProvider, parseCommandQuery } from './command';
import { CommandRegistry, CommandSection } from './command-registry';
import { EntityQuickOpen } from './providers/entity-quick-open';
import { WorldQuickOpen } from './providers/world-quick-open';
import { CreateCommands } from './providers/create-commands';

/**
 * The built-in Command Providers, supplied at bootstrap (ADR-0032) and registered
 * for the app's lifetime by the Palette when it mounts. A DI seam: a test provides
 * its own set instead of reaching into the root {@link CommandRegistry}.
 */
export const COMMAND_PROVIDERS = new InjectionToken<readonly CommandProvider[]>(
  'COMMAND_PROVIDERS',
);

/** Register the v1 built-in Providers as the {@link COMMAND_PROVIDERS} set, in listing order. */
export function provideBuiltInCommands(): Provider[] {
  return [
    { provide: COMMAND_PROVIDERS, useExisting: EntityQuickOpen, multi: true },
    { provide: COMMAND_PROVIDERS, useExisting: WorldQuickOpen, multi: true },
    { provide: COMMAND_PROVIDERS, useExisting: CreateCommands, multi: true },
  ];
}

/**
 * The Command Palette (CONTEXT.md, ADR-0032): a Cmd/Ctrl+K overlay, reachable
 * from anywhere regardless of route, for finding Entities and Worlds and
 * invoking Commands. Mounted once in {@link App}; it owns no route gating and
 * merges results from every {@link CommandRegistry} Provider bound to the
 * typed prefix into stable, provider-ordered sections.
 */
@Component({
  selector: 'app-command-palette',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, Dialog, Input, TranslocoPipe, RouterLink, NgTemplateOutlet],
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
        <!-- One flat list: each row is tagged inline with its Provider's label on
             the right, rather than grouped under section headings. Rows that carry
             a route render as routerLink anchors so they open in a new tab. -->
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
              <ng-container
                [ngTemplateOutlet]="rowBody"
                [ngTemplateOutletContext]="{ $implicit: row }"
              />
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
              <ng-container
                [ngTemplateOutlet]="rowBody"
                [ngTemplateOutletContext]="{ $implicit: row }"
              />
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
export class CommandPalette {
  private readonly registry = inject(CommandRegistry);
  private readonly router = inject(Router);
  private readonly builtIns =
    inject(COMMAND_PROVIDERS, { optional: true }) ?? [];
  // read: ElementRef — the #search element also hosts appInput, so a bare
  // query would resolve to the Input component instance instead of the
  // native element (see Dialog's #dialog for the same idiom).
  private readonly searchInput = viewChild('search', { read: ElementRef });

  protected readonly open = signal(false);
  protected readonly text = signal('');
  private readonly activeIndex = signal(0);

  // Gate the search on open() as well as the query: Providers return snapshot
  // results (e.g. WorldQuickOpen reads the already-loaded World list), so opening
  // the palette must re-run the search against current state rather than replay a
  // stale result computed at bootstrap before the Worlds had loaded.
  private readonly parsed = computed(() => ({
    open: this.open(),
    ...parseCommandQuery(this.text()),
  }));

  protected readonly sections = toSignal(
    toObservable(this.parsed).pipe(
      switchMap(({ open, prefix, query }) =>
        open
          ? this.registry.search(prefix, query)
          : of<readonly CommandSection[]>([]),
      ),
    ),
    { initialValue: [] as readonly CommandSection[] },
  );

  /** The flat list actually rendered: each Command paired with its Provider's label. */
  protected readonly rows = computed(() =>
    this.sections().flatMap((section: CommandSection) =>
      section.commands.map((command) => ({
        command,
        label: section.provider.label,
      })),
    ),
  );

  // Clamp the highlight to the current rows: an in-flight query can resolve to
  // fewer rows than the stale-while-revalidate seed the user already arrowed
  // into, so a raw activeIndex would point past the list and leave Enter and
  // aria-activedescendant dead until the next keystroke.
  protected readonly activeCommand = computed(() => {
    const rows = this.rows();
    if (!rows.length) return null;
    return rows[Math.min(this.activeIndex(), rows.length - 1)].command;
  });

  // Stable per-option DOM ids so the input's aria-activedescendant can point at
  // the highlighted row — the same listbox idiom as SuggestionMenu's pickers.
  protected optionId(id: string): string {
    return 'command-opt-' + id;
  }

  protected readonly activeItemId = computed(() => {
    const command = this.activeCommand();
    return command ? this.optionId(command.id) : null;
  });

  constructor() {
    // Built-in Providers register once, for the app's lifetime — the Palette is
    // mounted a single time (ADR-0032), so there's nothing to unregister.
    for (const provider of this.builtIns) this.registry.register(provider);

    // A new query invalidates the previous active pick — always land back on
    // the top result rather than an index that now points at something else.
    effect(() => {
      this.text();
      untracked(() => this.activeIndex.set(0));
    });

    // Reset to a blank slate whenever the palette closes — by toggle, Escape
    // (Dialog's native behaviour), or after picking a command — so opening it
    // again never shows a stale query or selection.
    effect(() => {
      if (this.open()) {
        untracked(() => {
          const el = this.searchInput()?.nativeElement as
            | HTMLInputElement
            | undefined;
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

  @HostListener('window:keydown', ['$event'])
  protected onGlobalKeydown(event: KeyboardEvent): void {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      this.open.update((v) => !v);
    }
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
      // Ctrl/Cmd+Enter opens a routable Command in a new tab, mirroring the
      // native modifier-click affordance the anchor rows already give the mouse.
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
    // Delegate arrow navigation (with wrap) to CDK's ListKeyManager instead of
    // hand-rolling index math. We render the highlight ourselves from activeIndex
    // (aria-activedescendant), so a transient manager seeded with the current
    // index is enough: it computes the next index for this one keystroke. No
    // withHomeAndEnd — the manager would preventDefault Home/End and steal them
    // from caret navigation in the search input; those keys fall through instead.
    // getLabel gives it a ListKeyManagerOption (and leaves typeahead available).
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

  /**
   * A plain left-click on a link row: RouterLink navigates, so just close the
   * palette. Modified / middle clicks fall through untouched — the browser opens
   * the anchor in a new tab and the palette stays open.
   */
  protected onLinkClick(event: MouseEvent): void {
    if (
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.button !== 0
    ) {
      return;
    }
    this.close();
  }

  private openInNewTab(route: readonly unknown[]): void {
    const url = this.router.serializeUrl(
      this.router.createUrlTree(route as unknown[]),
    );
    window.open(url, '_blank', 'noopener');
  }

  private close(): void {
    this.open.set(false);
  }
}
