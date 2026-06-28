import {
  ChangeDetectionStrategy,
  Component,
  booleanAttribute,
  input,
  output,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { Button } from '../../ui/button';
import { Panel } from '../../ui/panel';
import { Autofocus } from '../../ui/autofocus';

/**
 * One World on the World Index (ADR-0028): its name (or an inline rename field),
 * an owned/member tag, and — for an Owner only — rename and delete affordances.
 * It owns no state: `renaming` is driven by the Index (one card edits at a time)
 * and every action is an event the Index handles, keeping the World list and its
 * round trips in one place.
 */
@Component({
  selector: 'app-world-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, Panel, Autofocus, TranslocoPipe],
  template: `
    <section class="flex items-center gap-2 py-3 px-4" appPanel>
      @if (renaming()) {
        <input
          type="text"
          appAutofocus
          class="flex-1 font-display text-md text-ink-strong bg-surface-sunken border border-gold rounded-sm py-1 px-2 outline-none"
          [value]="name()"
          [attr.data-testid]="'rename-world-input-' + id()"
          [attr.aria-label]="'worldIndex.renameLabel' | transloco"
          (keydown.enter)="renameSubmit.emit($any($event.target).value)"
          (keydown.escape)="renameCancel.emit()"
        />
      } @else {
        <button
          type="button"
          class="flex flex-1 flex-col gap-1 p-0 text-left bg-transparent border-0 cursor-pointer"
          [attr.data-testid]="'world-' + id()"
          (click)="enter.emit()"
        >
          <span class="font-display text-md text-ink-strong">{{ name() }}</span>
        </button>
      }
      @if (owned()) {
        <span
          class="text-2xs uppercase tracking-wider text-gold"
          [attr.data-testid]="'owned-' + id()"
          >{{ 'worldIndex.owned' | transloco }}</span
        >
        <button
          type="button"
          appButton
          variant="ghost"
          size="sm"
          [attr.data-testid]="'rename-world-' + id()"
          (click)="renameStart.emit()"
        >
          {{ 'worldIndex.rename' | transloco }}
        </button>
        <button
          type="button"
          appButton
          variant="ghost"
          size="sm"
          danger
          [attr.data-testid]="'delete-world-' + id()"
          (click)="delete.emit()"
        >
          {{ 'common.delete' | transloco }}
        </button>
      } @else {
        <span
          class="text-2xs uppercase tracking-wider text-ink-muted"
          [attr.data-testid]="'member-' + id()"
          >{{ 'worldIndex.member' | transloco }}</span
        >
      }
    </section>
  `,
})
export class WorldCard {
  readonly id = input.required<string>();
  readonly name = input.required<string>();
  /** Caller is this World's Owner — gates rename/delete. */
  readonly owned = input(false, { transform: booleanAttribute });
  /** This card is in inline-rename mode (driven by the Index). */
  readonly renaming = input(false, { transform: booleanAttribute });

  /** Activate the World — enter its Entity browser. */
  readonly enter = output<void>();
  /** Owner pressed Rename — open the inline field. */
  readonly renameStart = output<void>();
  /** Owner committed the inline rename with this new name. */
  readonly renameSubmit = output<string>();
  /** Owner abandoned the inline rename (Escape). */
  readonly renameCancel = output<void>();
  /** Owner pressed Delete — the Index opens the type-to-confirm flow. */
  readonly delete = output<void>();
}
