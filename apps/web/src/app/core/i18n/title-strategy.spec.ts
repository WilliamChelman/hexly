import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { provideRouter, Router, TitleStrategy } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { provideTranslocoTesting } from './transloco-testing';
import { TitleService } from './title.service';
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
          {
            // The editor route derives its tab title from the open map's name.
            path: 'entities/:id',
            component: Blank,
            title: 'editorShell.tabTitle',
            data: { documentTitleKey: 'editorShell.tabTitleNamed' },
          },
        ]),
        { provide: TitleStrategy, useClass: TranslationTitleStrategy },
      ],
    });
    // Construct the strategy so it (and the TitleService) subscribe to changes.
    TestBed.inject(TitleStrategy);
    return {
      router: TestBed.inject(Router),
      title: TestBed.inject(Title),
      transloco: TestBed.inject(TranslocoService),
      titles: TestBed.inject(TitleService),
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

  it('composes the pushed document name with the brand on a document-titled route', async () => {
    const { router, title, titles } = setup();
    await router.navigateByUrl('/entities/42');

    titles.setDocumentName('The Reach of Aldermoor');

    expect(title.getTitle()).toBe('The Reach of Aldermoor — Hexly');
  });

  it('falls back to the bare brand until the document name is pushed', async () => {
    const { router, title } = setup();

    await router.navigateByUrl('/entities/42');

    expect(title.getTitle()).toBe('Hexly');
  });

  it('tracks a live document rename with no navigation', async () => {
    const { router, title, titles } = setup();
    await router.navigateByUrl('/entities/42');
    titles.setDocumentName('The Reach of Aldermoor');

    titles.setDocumentName('The Whisperwood');

    expect(title.getTitle()).toBe('The Whisperwood — Hexly');
  });

  it('leaves the document name and brand untranslated across a language switch', async () => {
    const { router, title, transloco, titles } = setup();
    await router.navigateByUrl('/entities/42');
    titles.setDocumentName('The Reach of Aldermoor');

    transloco.setActiveLang('fr');

    // The map name is content and "Hexly" is the brand — neither is translated.
    expect(title.getTitle()).toBe('The Reach of Aldermoor — Hexly');
  });

  it('falls back to the route key once the document name is cleared', async () => {
    const { router, title, titles } = setup();
    await router.navigateByUrl('/entities/42');
    titles.setDocumentName('The Reach of Aldermoor');

    // The editor clears the name when it leaves, so the bare brand shows again.
    titles.setDocumentName(null);

    expect(title.getTitle()).toBe('Hexly');
  });
});
