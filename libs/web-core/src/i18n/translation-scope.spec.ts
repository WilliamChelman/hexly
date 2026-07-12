import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TranslocoPipe, TranslocoService, provideTransloco, translateSignal } from '@jsverse/transloco';
import { LocaleService } from './locale.service';
import { provideEagerTranslations } from './translation-scope';
import { TranslocoHttpLoader } from './transloco-http.loader';
import { translocoAppConfig } from './transloco.config';

@Component({
  imports: [TranslocoPipe],
  template: `<span id="pipe">{{ 'entityTags.addLabel' | transloco }}</span
    ><span id="signal">{{ placeholder() }}</span>`,
})
class Host {
  // The app reads some copy as a signal rather than through the pipe.
  protected readonly placeholder = translateSignal('entityTags.addPlaceholder');
}

/**
 * An eager scope must not land in a component's injector as `TRANSLOCO_SCOPE` (ADR-0049):
 * `translateSignal` resolves that token and prefixes the key with it, while the pipe never does — so
 * a registered scope makes an app component asking for `entityTags.addPlaceholder` resolve
 * `dnd.entityTags.addPlaceholder` and render the raw key.
 *
 * Mirrors the real `app.config` — HTTP loader plus an eagerly-registered lib scope — because the
 * testing harness registers catalogs, not scopes, and so cannot catch this.
 */
describe('eager translation scopes', () => {
  it('leaves an app component free of a scope, so its keys are never prefixed with a lib s', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTransloco({ config: translocoAppConfig, loader: TranslocoHttpLoader }),
        provideEagerTranslations({
          scope: 'dnd',
          loader: {
            en: () => Promise.resolve({ monster: { eyebrow: 'Monster' } }),
            fr: () => Promise.resolve({ monster: { eyebrow: 'Monstre' } }),
          },
        }),
      ],
    });
    const http = TestBed.inject(HttpTestingController);

    const ready = TestBed.inject(LocaleService).init();
    http.expectOne('assets/i18n/en.json').flush({
      entityTags: { addLabel: 'Add tag', addPlaceholder: 'Add a tag…' },
    });
    await ready;

    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const text = (id: string) => fixture.nativeElement.querySelector(`#${id}`).textContent;

    // Both readers answer the app's own key, unprefixed.
    expect(text('pipe')).toBe('Add tag');
    expect(text('signal')).toBe('Add a tag…');

    // And the lib's key still resolves, with no provider to inherit: a loaded scope is flattened
    // into the active language's catalog.
    expect(TestBed.inject(TranslocoService).translate('dnd.monster.eyebrow')).toBe('Monster');
  });
});
