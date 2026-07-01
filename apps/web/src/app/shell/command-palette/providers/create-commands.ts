import { Injectable, inject } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { Observable, of } from 'rxjs';
import { EntityType } from '@hexly/domain';
import { Command, CommandProvider } from '../command';
import { CreateEntityLauncher } from '../create-entity-launcher';

/** The static create actions, in listing order. */
const CREATE: readonly { id: string; titleKey: string; type: EntityType }[] = [
  { id: 'create-note', titleKey: 'commandPalette.createNote', type: 'note' },
  { id: 'create-map', titleKey: 'commandPalette.createMap', type: 'hexmap' },
];

/**
 * The global Create Commands (ADR-0032): two static actions under the `>` prefix,
 * always listed regardless of active World. Running one opens the create dialog
 * for that type via {@link CreateEntityLauncher} — a separate, more explicit flow
 * from the Inspector's inline create-and-link (issue #77).
 */
@Injectable({ providedIn: 'root' })
export class CreateCommands implements CommandProvider {
  private readonly transloco = inject(TranslocoService);
  private readonly launcher = inject(CreateEntityLauncher);

  readonly prefix = '>';
  readonly labelKey = 'commandPalette.action';

  search(query: string): Observable<Command[]> {
    const q = query.trim().toLowerCase();
    const commands = CREATE.map((c) => ({
      id: c.id,
      title: this.transloco.translate(c.titleKey),
      run: () => this.launcher.open(c.type),
    })).filter((c) => !q || c.title.toLowerCase().includes(q));
    return of(commands);
  }
}
