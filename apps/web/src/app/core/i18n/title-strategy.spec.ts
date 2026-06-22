import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { provideRouter, Router, TitleStrategy } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { provideTranslocoTesting } from './transloco-testing';
import { TranslationTitleStrategy } from './title-strategy';

@Component({ template: '' })
class Blank {}

describe('TranslationTitleStrategy', () => {
  function setup() {
    TestBed.configureTestingModule({
      imports: [provideTranslocoTesting()],
      providers: [
        provideRouter([
          { path: 'login', component: Blank, title: 'auth.tabTitle' },
        ]),
        { provide: TitleStrategy, useClass: TranslationTitleStrategy },
      ],
    });
    // Construct the strategy so it subscribes to language changes.
    TestBed.inject(TitleStrategy);
    return {
      router: TestBed.inject(Router),
      title: TestBed.inject(Title),
      transloco: TestBed.inject(TranslocoService),
    };
  }

  it('resolves a route title key to its translated value', async () => {
    const { router, title } = setup();

    await router.navigateByUrl('/login');

    expect(title.getTitle()).toBe('Hexly — Sign in');
  });

  it('keeps the brand untranslated and tracks a live language switch', async () => {
    const { router, title, transloco } = setup();
    await router.navigateByUrl('/login');

    // No navigation: flipping the language re-resolves the current title.
    transloco.setActiveLang('fr');

    expect(title.getTitle()).toBe('Hexly — Se connecter');
  });
});
