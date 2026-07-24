import { Injectable, inject } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { Observable, of } from 'rxjs';
import { Command, CommandProvider } from '@hexly/command-palette-web';
import { ToasterService } from '@hexly/web-core';
import { DICE_RNG } from './dice';
import { parse } from './parse';
import { evaluate } from './evaluate';
import { formatRoll } from './format';

/**
 * A rolled result lingers longer than a default toast (4s): it carries the breakdown a GM reads off,
 * not a fire-and-forget status, and it rides above the palette they just dismissed.
 */
export const DICE_TOAST_DURATION_MS = 8000;

/**
 * The `/r ` Command Provider (issue #251): palette rolling. It depends only on the palette's
 * Command contract and web-core's toaster — no edge flows back into either lib. A valid Dice
 * Expression yields one runnable Command labelled with the expression; running it evaluates a fresh
 * Roll and flashes the formatted Result through the toaster. Invalid input yields one inert hint
 * Command, so a rejected query reads as rejected rather than as nothing.
 */
@Injectable({ providedIn: 'root' })
export class DiceCommands implements CommandProvider {
  private readonly toaster = inject(ToasterService);
  private readonly transloco = inject(TranslocoService);
  private readonly rng = inject(DICE_RNG);

  // The trailing space is part of the prefix: `/r 2d6` routes here, `/roll` does not (ADR-0059).
  readonly prefix = '/r ';
  readonly label = 'dice.section';

  search(query: string): Observable<readonly Command[]> {
    const expression = query.trim();
    // Nothing typed yet — offer nothing rather than flash the hint before the user has a chance.
    if (!expression) return of([]);

    const parsed = parse(expression);
    if (parsed.isErr()) {
      return of([
        {
          id: 'dice-hint',
          label: this.transloco.translate('dice.invalid'),
          // Inert: the row exists only to show the query was rejected.
          run: () => undefined,
        },
      ]);
    }

    const ast = parsed.value;
    return of([
      {
        id: 'dice-roll',
        label: this.transloco.translate('dice.roll', { expression }),
        // Re-evaluate on each run, so pressing Enter again produces a fresh Roll (issue #251). The
        // total headlines the toast; the breakdown is its detail. Anchor it to the top, where the
        // palette sat, and let it linger (issue #251 follow-up).
        run: () => {
          const { total, detail } = formatRoll(expression, evaluate(ast, this.rng));
          this.toaster.show(detail, 'info', { title: total, placement: 'top', durationMs: DICE_TOAST_DURATION_MS });
        },
      },
    ]);
  }
}
