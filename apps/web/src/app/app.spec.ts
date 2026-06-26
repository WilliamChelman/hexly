import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { App } from './app';
import { provideTranslocoTesting } from './core/i18n/transloco-testing';

@Component({ template: 'page' })
class Blank {}

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App, provideTranslocoTesting()],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([
          { path: 'login', component: Blank },
          { path: 'entities', component: Blank },
          { path: '', pathMatch: 'full', redirectTo: 'entities' },
        ]),
      ],
    }).compileComponents();
  });

  it('boots and renders a router outlet', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('router-outlet')).not.toBeNull();
  });

  it('renders the persistent nav rail beside the outlet, not a shell header', async () => {
    const fixture = TestBed.createComponent(App);
    await TestBed.inject(Router).navigateByUrl('/entities');
    fixture.detectChanges();

    // The shell is the rail alone now (ADR-0022); the single app header is gone.
    expect(fixture.nativeElement.querySelector('app-nav-rail')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('app-header')).toBeNull();
  });

  it('renders the login screen standalone, with no rail', async () => {
    const fixture = TestBed.createComponent(App);
    await TestBed.inject(Router).navigateByUrl('/login');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('app-nav-rail')).toBeNull();
  });

  it('applies a theme to the document on boot', () => {
    TestBed.createComponent(App);
    expect(document.documentElement.dataset['theme']).toMatch(/^(light|dark)$/);
  });
});
