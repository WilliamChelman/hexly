import { Injectable } from '@angular/core';
import { Command } from './command';

/**
 * The Commands reachable by id, so a second surface can invoke one without restating its action — the Desktop
 * App's native menu carries nothing but an id over the preload bridge (ADR-0070).
 *
 * Not the {@link CommandRegistry}: that registers Providers, whose Commands are computed per query.
 */
@Injectable({ providedIn: 'root' })
export class CommandDirectory {
  private readonly byId = new Map<string, Command>();

  /** No unregister, unlike {@link CommandRegistry}: a Command a second surface names lives for the app's life. */
  register(command: Command): void {
    this.byId.set(command.id, command);
  }

  /**
   * Runs the Command with this id, answering whether anything held it. A miss is legitimate, not an error: a
   * native menu is built once at launch while availability is conditional (ADR-0071 cut lists).
   */
  invoke(id: string): boolean {
    const command = this.byId.get(id);
    command?.run();
    return !!command;
  }
}
