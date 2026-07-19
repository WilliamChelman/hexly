import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { AssetSummary } from '@hexly/domain';
import { AssetsClient } from '@hexly/web-core';
import { provideTranslocoTesting } from '@hexly/web-core/testing';
import { DialogRef } from '@hexly/web-ui';
import { BOARD_TEST_CATALOGS } from '../i18n/test-catalogs';
import { BoardImagePickerComponent, ImagePickerData } from './board-image-picker.component';

const EXISTING: AssetSummary[] = [
  { url: '/assets/w1/one.png', originalFilename: 'one.png', mime: 'image/png', size: 10 },
  { url: '/assets/w1/two.jpg', originalFilename: 'two.jpg', mime: 'image/jpeg', size: 20 },
];

/** A fake AssetsClient the picker drives — records the upload call and returns canned streams. */
class FakeAssetsClient {
  uploaded: File | null = null;
  uploadResult = of<AssetSummary>({
    url: '/assets/w1/new.png',
    originalFilename: 'new.png',
    mime: 'image/png',
    size: 5,
  });
  list = () => of(EXISTING);
  upload = (_worldId: string, file: File) => {
    this.uploaded = file;
    return this.uploadResult;
  };
}

describe('BoardImagePicker', () => {
  let fixture: ComponentFixture<BoardImagePickerComponent>;
  let ref: DialogRef<ImagePickerData, string>;
  let closed: (string | undefined)[];
  let assets: FakeAssetsClient;

  beforeEach(async () => {
    assets = new FakeAssetsClient();
    ref = new DialogRef<ImagePickerData, string>({ worldId: 'w1' });
    closed = [];
    ref.closed.subscribe((r) => closed.push(r));

    await TestBed.configureTestingModule({
      imports: [BoardImagePickerComponent, provideTranslocoTesting(BOARD_TEST_CATALOGS)],
      providers: [
        { provide: DialogRef, useValue: ref },
        { provide: AssetsClient, useValue: assets },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(BoardImagePickerComponent);
    fixture.detectChanges();
  });

  it('uploads a picked file (minting an Asset) and closes with the served URL', () => {
    const input = fixture.nativeElement.querySelector('[data-testid=image-upload-input]') as HTMLInputElement;
    const file = new File(['x'], 'castle.png', { type: 'image/png' });
    // jsdom lets us stand in a FileList via defineProperty on the input.
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));

    expect(assets.uploaded).toBe(file);
    expect(closed).toEqual(['/assets/w1/new.png']);
  });

  it('closes with an existing Asset’s URL when one is picked (reuse, no upload)', () => {
    const tile = fixture.nativeElement.querySelector('[data-testid=image-asset-choice]') as HTMLButtonElement;
    tile.click();

    expect(assets.uploaded).toBeNull();
    expect(closed).toEqual(['/assets/w1/one.png']);
  });

  it('keeps the dialog open with an error hint when an upload fails', () => {
    assets.uploadResult = throwError(() => new Error('boom'));
    const input = fixture.nativeElement.querySelector('[data-testid=image-upload-input]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'x.png')], configurable: true });
    input.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(closed).toEqual([]); // never closed
    expect(fixture.nativeElement.querySelector('[data-testid=image-upload-error]')).not.toBeNull();
  });

  it('cancels without choosing — closes with no result, so nothing is placed', () => {
    const cancel = fixture.nativeElement.querySelector('[data-testid=image-picker-cancel]') as HTMLButtonElement;
    cancel.click();

    expect(closed).toEqual([undefined]);
  });
});
