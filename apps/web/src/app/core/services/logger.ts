import { Injectable } from '@angular/core';

/**
 * The app's one logging seam. A thin wrapper over the console so callers don't reach
 * for it directly and there's a single place to intercept in tests or route to a real
 * transport later. Deliberately minimal: `error` and `warn` are what carry signal; add
 * a level only when something needs it.
 */
@Injectable({ providedIn: 'root' })
export class Logger {
  error(message: string, ...context: unknown[]): void {
    console.error(`[hexly] ${message}`, ...context);
  }

  warn(message: string, ...context: unknown[]): void {
    console.warn(`[hexly] ${message}`, ...context);
  }
}
