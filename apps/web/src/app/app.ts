import { Component, computed, inject } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter, map, of, switchMap, timer } from 'rxjs';
import { AppShellStore } from './shell/app-shell.store';
import { CommandPalette } from './shell/command-palette/command-palette';
import { CreateEntityDialog } from './shell/command-palette/create-entity-dialog';
import { NavRail } from './shell/nav-rail';
import { Toaster } from './shell/toaster';
import { Icon } from './ui/icon/icon';

/** How long `full` loading must persist before the curtain shows (debounce). */
const FULL_CURTAIN_DELAY_MS = 150;

/** Application root. The only persistent chrome is the {@link NavRail} (ADR-0022). */
@Component({
  selector: 'app-root',
  host: { class: 'flex h-screen' },
  imports: [RouterOutlet, NavRail, Toaster, CommandPalette, CreateEntityDialog, Icon],
  template: `
    @if (navigated() && !shell.standalone()) {
      <app-nav-rail />
    }
    <!--
      Outlet is the scroll container so the docked rail stays put while pages
      scroll. Not a landmark: each page owns its own <main>.
    -->
    <div class="flex-1 min-w-0 overflow-auto">
      <router-outlet />
    </div>

    <!--
      Full curtain: a blocking, text-free wash (e.g. a language switch re-rendering
      the whole UI). Debounced so a cached, instant switch never flashes it.
    -->
    @if (showFull()) {
      <div
        class="fixed inset-0 z-50 grid place-items-center bg-bg-deep"
        data-testid="app-loading"
        role="status"
        aria-busy="true"
      >
        <span
          class="text-gold animate-pulse [filter:drop-shadow(0_0_12px_var(--color-glow))]"
        >
          <app-icon name="logo" [size]="64" />
        </span>
      </div>
    }

    <!--
      Subtle-loading fallback: on standalone pages (e.g. login) the rail is hidden,
      so its pulsing brand mark can't carry the subtle indicator — show a discreet
      corner pulse instead. When the rail is present, it owns this signal.
    -->
    @if (showSubtleFallback()) {
      <div
        class="fixed bottom-4 right-4 z-40 text-gold animate-pulse [filter:drop-shadow(0_0_6px_var(--color-glow))]"
        data-testid="app-loading-subtle"
        role="status"
        aria-busy="true"
      >
        <app-icon name="logo" [size]="22" />
      </div>
    }
    <app-toaster />
    <app-command-palette />
    <app-create-entity-dialog />
  `,
})
export class App {
  protected readonly shell = inject(AppShellStore);

  // Defer the full curtain's appearance by FULL_CURTAIN_DELAY_MS so a quick
  // (cached) language switch never flashes it; drop it the instant loading
  // leaves 'full'. switchMap cancels the pending timer if that happens first.
  protected readonly showFull = toSignal(
    toObservable(this.shell.loading).pipe(
      switchMap((level) =>
        level === 'full'
          ? timer(FULL_CURTAIN_DELAY_MS).pipe(map(() => true))
          : of(false),
      ),
    ),
    { initialValue: false },
  );

  // Standalone pages (e.g. login) hide the rail, so its brand-mark pulse can't
  // carry the subtle signal — fall back to a corner pulse there.
  protected readonly showSubtleFallback = computed(
    () => this.shell.loading() === 'subtle' && this.shell.standalone(),
  );

  // Hold the rail back until the first navigation resolves; by then the landing
  // page's constructor has set `standalone`, so a cold load on /login never
  // flashes the rail.
  protected readonly navigated = toSignal(
    inject(Router).events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map(() => true),
    ),
    { initialValue: false },
  );
}
