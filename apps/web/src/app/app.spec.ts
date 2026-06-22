import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { App } from './app';
import { appRoutes } from './app.routes';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter(appRoutes),
      ],
    }).compileComponents();
  });

  it('boots and renders a router outlet', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('router-outlet')).not.toBeNull();
  });

  it('renders a single app header above the routed outlet', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    // The root shell owns one always-present header (ADR-0015); the bare-outlet
    // root is gone.
    expect(fixture.nativeElement.querySelector('app-header')).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Hexly');
  });

  it('applies a theme to the document on boot', () => {
    TestBed.createComponent(App);
    expect(document.documentElement.dataset['theme']).toMatch(/^(light|dark)$/);
  });
});

describe('App named header outlet', () => {
  @Component({ template: 'PROJECTED HEADER' })
  class FakeHeader {}
  @Component({ template: 'page body' })
  class FakePage {}

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([
          {
            path: 'x',
            children: [
              { path: '', component: FakePage },
              { path: '', outlet: 'header', component: FakeHeader },
            ],
          },
        ]),
      ],
    }).compileComponents();
  });

  it("projects a route's header child into the app header", async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    // A route may declare a header-outlet child; it must render inside the single
    // app header, the way the editor route projects its interactive header.
    await TestBed.inject(Router).navigateByUrl('/x');
    fixture.detectChanges();

    const header = fixture.nativeElement.querySelector('app-header');
    expect(header.textContent).toContain('PROJECTED HEADER');
  });
});
