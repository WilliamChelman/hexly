import { Injectable, signal } from '@angular/core';
import { IconName } from '@hexly/web-ui';

export interface NavEntry {
  readonly link: string | readonly string[];
  readonly testid: string;
  readonly icon: IconName;
  readonly labelKey: string;
  readonly exact?: boolean;
}

/**
 * The rail's contextual links, owned by the routed scope rather than the rail
 * (ADR-0041): a scope fills the slot on enter and clears it on leave.
 */
@Injectable({ providedIn: 'root' })
export class NavRailStore {
  readonly entries = signal<readonly NavEntry[]>([]);
}
