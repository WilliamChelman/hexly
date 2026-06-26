import { Injectable, signal } from '@angular/core';

/** Pages set this to hide the nav rail and global chrome (e.g. the login screen). */
@Injectable({ providedIn: 'root' })
export class AppShellStore {
  readonly standalone = signal(false);
}
