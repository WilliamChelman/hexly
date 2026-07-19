import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AssetSummary } from '@hexly/domain';
import { AssetsClient } from './assets.client';

describe('AssetsClient', () => {
  let client: AssetsClient;
  let http: HttpTestingController;

  const asset: AssetSummary = {
    url: '/assets/w1/abc.png',
    originalFilename: 'map.png',
    mime: 'image/png',
    size: 42,
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    client = TestBed.inject(AssetsClient);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('lists a World’s Assets', () => {
    let listed: AssetSummary[] | undefined;
    client.list('w1').subscribe((a) => (listed = a));

    const req = http.expectOne('/api/worlds/w1/assets');
    expect(req.request.method).toBe('GET');
    req.flush([asset]);

    expect(listed).toEqual([asset]);
  });

  it('uploads a file as multipart form data, letting the browser set the boundary', () => {
    let uploaded: AssetSummary | undefined;
    const file = new File(['bytes'], 'map.png', { type: 'image/png' });
    client.upload('w1', file).subscribe((a) => (uploaded = a));

    const req = http.expectOne('/api/worlds/w1/assets');
    expect(req.request.method).toBe('POST');
    const body = req.request.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get('file')).toBe(file);
    // No explicit Content-Type — Angular/browser adds the multipart boundary itself.
    expect(req.request.headers.has('Content-Type')).toBe(false);
    req.flush(asset);

    expect(uploaded).toEqual(asset);
  });
});
