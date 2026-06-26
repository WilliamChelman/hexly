import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { finalize } from 'rxjs';
import { translateSignal, TranslocoPipe } from '@jsverse/transloco';
import { AuthStore } from './auth.store';
import { Button } from '../ui/button';
import { Field } from '../ui/field';
import { Input } from '../ui/input';
import { Panel } from '../ui/panel';
import { AppShellStore } from '../shell/app-shell.store';

@Component({
  selector: 'app-login',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Panel, Field, Input, Button, TranslocoPipe],
  template: `
    <main class="grid place-items-center min-h-full p-5 bg-surface-sunken">
      <section class="w-full max-w-[22rem] p-6" appPanel raised>
        <h1 class="sr-only">{{ heading() }}</h1>
        <form class="flex flex-col gap-4" (submit)="submit($event)">
          <label appField [label]="'auth.email' | transloco">
            <input
              appInput
              type="email"
              name="email"
              autocomplete="username"
              [value]="email()"
              (input)="email.set(value($event))"
            />
          </label>
          <label appField [label]="'auth.password' | transloco">
            <input
              appInput
              type="password"
              name="password"
              autocomplete="current-password"
              [value]="password()"
              (input)="password.set(value($event))"
            />
          </label>

          @if (error(); as e) {
            <p class="m-0 text-sm text-ember" role="alert">{{ e | transloco }}</p>
          }

          <button
            appButton
            variant="primary"
            type="submit"
            [disabled]="pending()"
          >
            {{ (pending() ? 'auth.signingIn' : 'auth.signIn') | transloco }}
          </button>
        </form>
      </section>
    </main>
  `,
})
export class Login {
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  constructor() {
    const shell = inject(AppShellStore);
    shell.standalone.set(true);
    inject(DestroyRef).onDestroy(() => shell.standalone.set(false));
  }

  protected readonly heading = translateSignal('auth.heading');

  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly pending = signal(false);
  protected readonly error = signal<string | null>(null);

  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected submit(event: Event): void {
    event.preventDefault();
    if (this.pending()) return;

    this.pending.set(true);
    this.error.set(null);
    // Trim client-side so the value we send is clean; the server still owns
    // canonicalization (trim + lowercase), so we deliberately don't lowercase here.
    this.auth
      .login(this.email().trim(), this.password())
      // Always clear pending when the request settles, so a cancelled
      // navigation can't leave the button stuck on "Signing in…".
      .pipe(finalize(() => this.pending.set(false)))
      .subscribe({
        next: () => {
          const returnUrl =
            this.route.snapshot.queryParamMap.get('returnUrl') ?? '/';
          this.router.navigateByUrl(returnUrl);
        },
        error: () => this.error.set('auth.invalidCredentials'),
      });
  }
}
