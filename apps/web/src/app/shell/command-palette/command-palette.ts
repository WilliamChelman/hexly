import { ListKeyManager } from '@angular/cdk/a11y';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  InjectionToken,
  Provider,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { Subscription } from 'rxjs';
import { Command, CommandProvider } from './command';
import { CommandRegistry } from './command-registry';
import { parseQuery } from './parse-query';
import { EntityQuickOpen } from './providers/entity-quick-open';
import { WorldQuickOpen } from './providers/world-quick-open';
import { CreateCommands } from './providers/create-commands';
import { Dialog } from '../../ui/dialog';
import { Input } from '../../ui/input';

/**
 * One rendered result: a Command plus the label key of the Provider that yielded
 * it. `disabled` is unused but satisfies CDK's `ListKeyManagerOption` shape.
 */
interface Row {
  readonly command: Command;
  readonly labelKey: string;
  readonly disabled?: boolean;
}

/**
 * The built-in Command Providers, fed in at bootstrap (ADR-0032) and registered
 * for the app's lifetime by the Palette. A DI seam so tests can supply their own.
 */
export const COMMAND_PROVIDERS = new InjectionToken<readonly CommandProvider[]>(
  'COMMAND_PROVIDERS',
);

/** Register the v1 built-in Providers as the {@link COMMAND_PROVIDERS} set, in listing order. */
export function provideBuiltInCommands(): Provider[] {
  return [
    { provide: COMMAND_PROVIDERS, useExisting: WorldQuickOpen, multi: true },
    { provide: COMMAND_PROVIDERS, useExisting: EntityQuickOpen, multi: true },
    { provide: COMMAND_PROVIDERS, useExisting: CreateCommands, multi: true },
  ];
}

/**
 * The Command Palette (CONTEXT.md, ADR-0032): a Cmd/Ctrl+K overlay, reachable
 * from anywhere, for finding Entities and Worlds and invoking Commands. Mounted
 * once in {@link App}, always rendered — no route gating. Reuses the {@link Dialog}
 * primitive for the modal shell (native `<dialog>`, Escape-to-close). The typed
 * text routes by prefix ({@link parseQuery}); every matching Provider's results
 * merge into stable, provider-ordered rows so a slower server-backed Provider
 * filling in late never reorders one that resolved instantly.
 */
@Component({
  selector: 'app-command-palette',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Dialog, Input, TranslocoPipe],
  host: { '(window:keydown)': 'onGlobalKeydown($event)' },
  template: `
    <app-dialog [open]="open()" (closed)="close()">
      <input
        #input
        appInput
        type="text"
        data-testid="command-input"
        [attr.aria-label]="'commandPalette.title' | transloco"
        [attr.placeholder]="'commandPalette.placeholder' | transloco"
        [value]="text()"
        (input)="onInput($event)"
        (keydown)="onInputKeydown($event)"
      />
      <div
        role="listbox"
        class="max-h-80 overflow-auto"
        [attr.aria-label]="'commandPalette.title' | transloco"
      >
        @for (row of rows(); track $index; let i = $index) {
          <button
            type="button"
            role="option"
            data-testid="command-option"
            class="flex w-full items-center justify-between gap-3 px-3 py-2 rounded-sm border-0 bg-transparent text-left cursor-pointer"
            [class.bg-gold-soft]="i === activeIndex()"
            [class.text-gold]="i === activeIndex()"
            [attr.aria-selected]="i === activeIndex()"
            (click)="select(row)"
          >
            <span class="truncate font-display text-base">{{ row.command.title }}</span>
            <span class="shrink-0 font-mono text-2xs uppercase tracking-wide text-ink-faint">
              {{ row.labelKey | transloco }}
            </span>
          </button>
        } @empty {
          <p class="px-3 py-2 text-sm text-ink-muted">
            {{ 'commandPalette.empty' | transloco }}
          </p>
        }
      </div>
    </app-dialog>
  `,
})
export class CommandPalette {
  private readonly registry = inject(CommandRegistry);
  private readonly builtIns = inject(COMMAND_PROVIDERS, { optional: true }) ?? [];
  // read: ElementRef — the #input element hosts the appInput component, so a bare
  // query would resolve to that instance instead of the native <input> (cf. Dialog).
  private readonly inputEl = viewChild('input', { read: ElementRef });

  protected readonly open = signal(false);
  protected readonly text = signal('');
  protected readonly rows = signal<readonly Row[]>([]);
  /** The highlighted row. Reset to the top on a new query, not on each streamed fill. */
  protected readonly activeIndex = signal(0);

  constructor() {
    // Built-ins register for the app's lifetime — the Palette is mounted once.
    for (const provider of this.builtIns) this.registry.register(provider);

    // Search: while open, subscribe to every Provider matching the typed prefix
    // and merge their results in registration order as they stream in. onCleanup
    // cancels the prior query's subscriptions so late responses can't leak in.
    // The cursor resets here — on a new query — not per streamed fill, so a slower
    // Provider filling in late never jumps the selection.
    effect((onCleanup) => {
      if (!this.open()) {
        this.rows.set([]);
        return;
      }
      const { prefix, query } = parseQuery(this.text());
      const providers = this.registry.providersFor(prefix);
      const slots: Command[][] = providers.map(() => []);
      this.rows.set([]);
      this.activeIndex.set(0);
      const subs: Subscription[] = providers.map((provider, i) =>
        provider.search(query).subscribe((commands) => {
          slots[i] = commands;
          this.rows.set(
            providers.flatMap((p, j) =>
              slots[j].map((command) => ({ command, labelKey: p.labelKey })),
            ),
          );
        }),
      );
      onCleanup(() => subs.forEach((s) => s.unsubscribe()));
    });

    // Focus the search box each time the Palette opens (the input stays in the DOM,
    // so native autofocus can't carry this).
    effect(() => {
      if (this.open()) this.inputEl()?.nativeElement.focus();
    });
  }

  protected onGlobalKeydown(event: KeyboardEvent): void {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      this.toggle();
    }
  }

  private toggle(): void {
    if (!this.open()) this.text.set('');
    this.open.update((o) => !o);
  }

  protected close(): void {
    this.open.set(false);
  }

  protected onInput(event: Event): void {
    this.text.set((event.target as HTMLInputElement).value);
  }

  protected onInputKeydown(event: KeyboardEvent): void {
    const rows = this.rows();
    if (event.key === 'Enter') {
      event.preventDefault();
      const row = rows[this.activeIndex()];
      if (row) this.select(row);
      return;
    }
    if (!rows.length) return;
    // A transient ListKeyManager gives us CDK's wrap / Home-End key handling without
    // a persistent instance to keep in sync with the streaming row set.
    const manager = new ListKeyManager<Row>([...rows]).withWrap();
    manager.setActiveItem(Math.min(this.activeIndex(), rows.length - 1));
    manager.onKeydown(event);
    this.activeIndex.set(Math.max(manager.activeItemIndex ?? 0, 0));
  }

  protected select(row: Row): void {
    row.command.run();
    this.close();
  }
}
