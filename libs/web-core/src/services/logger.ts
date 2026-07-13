import { Injectable } from '@angular/core';

/** The app's one logging seam: a thin wrapper over the console. */
@Injectable({ providedIn: 'root' })
export class Logger {
  error(message: string, ...context: unknown[]): void {
    console.error(`[hexly] ${message}`, ...context);
  }

  warn(message: string, ...context: unknown[]): void {
    console.warn(`[hexly] ${message}`, ...context);
  }
}
