import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { EditorShell } from './editor-shell';

describe('EditorShell', () => {
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EditorShell],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    }).compileComponents();
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('renders the API health reported in the status bar', async () => {
    const fixture = TestBed.createComponent(EditorShell);
    fixture.detectChanges(); // triggers ngOnInit -> GET /health

    httpMock.expectOne('/health').flush({ status: 'ok', service: 'api' });

    await fixture.whenStable();
    fixture.detectChanges();

    const health = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="health"]',
    );
    expect(health?.textContent).toContain('ok');
    expect(health?.textContent).toContain('api');
  });

  it('arms the painted terrain tool by default', () => {
    const fixture = TestBed.createComponent(EditorShell);
    fixture.detectChanges();
    httpMock.expectOne('/health').flush({ status: 'ok', service: 'api' });

    const active = (fixture.nativeElement as HTMLElement).querySelector(
      'button[appTool].is-active',
    );
    expect(active?.textContent).toContain('Forest');
  });
});
