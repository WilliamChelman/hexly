import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { switchMap } from 'rxjs';
import { TranslocoPipe } from '@jsverse/transloco';
import { Button } from '../../ui/button';
import { Dialog } from '../../ui/dialog';
import { Input } from '../../ui/input';
import { Command, parseCommandQuery } from './command';
import { CommandRegistry, CommandSection } from './command-registry';

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
  imports: [Button, Dialog, Input, TranslocoPipe],
  template: `
    <app-dialog [open]="open()" (closed)="onDialogClosed()">
      <input
        #search
        appInput
        data-testid="command-palette-input"
        [attr.aria-label]="'commandPalette.searchLabel' | transloco"
        [attr.placeholder]="'commandPalette.placeholder' | transloco"
        [value]="text()"
        (input)="onInput($event)"
        (keydown)="onInputKeydown($event)"
      />
      <div class="max-h-80 overflow-auto" data-testid="command-palette-results">
        @for (section of sections(); track section.provider) {
          @if (section.commands.length) {
            <div class="px-2 pt-2 text-2xs uppercase tracking-wide text-ink-faint">
              {{ section.provider.label | transloco }}
            </div>
            @for (command of section.commands; track command.id) {
              <button
                type="button"
                appButton
                variant="ghost"
                size="sm"
                class="w-full justify-start!"
                [active]="command === activeCommand()"
                [attr.data-testid]="'command-palette-option-' + command.id"
                (click)="pick(command)"
              >
                {{ command.label }}
                @if (command.hint) {
                  <span class="text-2xs text-ink-muted">{{ command.hint }}</span>
                }
              </button>
            }
          }
        } @empty {
          <p class="px-2 py-1 text-sm text-ink-muted">
            {{ 'commandPalette.empty' | transloco }}
          </p>
        }
      </div>
    </app-dialog>
  `,
})
export class CommandPalette {
  private readonly registry = inject(CommandRegistry);
  // read: ElementRef — the #search element also hosts appInput, so a bare
  // query would resolve to the Input component instance instead of the
  // native element (see Dialog's #dialog for the same idiom).
  private readonly searchInput = viewChild('search', { read: ElementRef });

  protected readonly open = signal(false);
  protected readonly text = signal('');
  private readonly activeIndex = signal(0);

  private readonly parsed = computed(() => parseCommandQuery(this.text()));

  protected readonly sections = toSignal(
    toObservable(this.parsed).pipe(
      switchMap(({ prefix, query }) => this.registry.search(prefix, query)),
    ),
    { initialValue: [] as readonly CommandSection[] },
  );

  private readonly flatCommands = computed(() =>
    this.sections().flatMap((section: CommandSection) => section.commands),
  );

  protected readonly activeCommand = computed(
    () => this.flatCommands()[this.activeIndex()] ?? null,
  );

  constructor() {
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
    const items = this.flatCommands();
    switch (event.key) {
      case 'ArrowDown':
        if (!items.length) return;
        event.preventDefault();
        this.activeIndex.update((i) => (i + 1) % items.length);
        return;
      case 'ArrowUp':
        if (!items.length) return;
        event.preventDefault();
        this.activeIndex.update((i) => (i - 1 + items.length) % items.length);
        return;
      case 'Enter': {
        const command = this.activeCommand();
        if (command) this.pick(command);
        return;
      }
    }
  }

  protected pick(command: Command): void {
    command.run();
    this.open.set(false);
  }
}
