import { Injectable } from '@angular/core';
import { Command } from './command';

/**
 * The Commands reachable by id, so a second surface can invoke one without restating its action. The
 * Desktop App's native menu is that surface: a menu click carries an id over the preload bridge and
 * nothing else, and lands on the same Command the Palette lists (ADR-0070).
 *
 * Deliberately not the {@link CommandRegistry}: that registers *Providers*, whose Commands are search
 * results computed per query. Only a Command something else names by id belongs here.
 */
@Injectable({ providedIn: 'root' })
export class CommandDirectory {
  private readonly byId = new Map<string, Command>();

  /**
   * Make `command` reachable by its own id. No unregister, unlike {@link CommandRegistry}: every Command a
   * second surface names lives for the app's lifetime, and a Provider's contextual results are not here.
   */
  register(command: Command): void {
    this.byId.set(command.id, command);
  }

  /**
   * Run the Command with this id, answering whether anything held it. A miss is a legitimate outcome rather
   * than an error: a native menu is built once at launch while a Command's availability is conditional
   * (ADR-0071's cut lists, an unmounted surface), so a menu can name one that is not on offer right now.
   */
  invoke(id: string): boolean {
    const command = this.byId.get(id);
    command?.run();
    return !!command;
  }
}
