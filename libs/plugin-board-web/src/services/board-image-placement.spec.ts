import { signal, Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Point } from '@hexly/plugin-board';
import { ENTITY_SESSION } from '@hexly/web-entity';
import { DialogRef, DialogService } from '@hexly/web-ui';
import { BoardStore } from './board-store';
import { BoardImagePlacement } from './board-image-placement';
import { ImagePickerData } from '../components/board-image-picker.component';

/** Records the addImage calls the placement funnels through. */
class FakeStore {
  readonly added: { position: Point; url: string }[] = [];
  addImage(position: Point, url: string): string {
    this.added.push({ position, url });
    return 'img';
  }
}

/** A DialogService whose `open` hands back a controllable ref, so a spec drives the picker's outcome. */
class FakeDialogService {
  opened: { component: Type<unknown>; data: unknown; ref: DialogRef<ImagePickerData, string> }[] = [];
  open<Data, Result>(component: Type<unknown>, data?: Data): DialogRef<Data, Result> {
    const ref = new DialogRef<ImagePickerData, string>(data as ImagePickerData);
    this.opened.push({ component, data, ref });
    return ref as unknown as DialogRef<Data, Result>;
  }
  lastRef(): DialogRef<ImagePickerData, string> {
    return this.opened[this.opened.length - 1].ref;
  }
}

describe('BoardImagePlacement', () => {
  let dialogs: FakeDialogService;
  let store: FakeStore;
  const worldId = signal<string | null>('w1');

  function setup(): BoardImagePlacement {
    dialogs = new FakeDialogService();
    store = new FakeStore();
    TestBed.configureTestingModule({
      providers: [
        BoardImagePlacement,
        { provide: DialogService, useValue: dialogs },
        { provide: BoardStore, useValue: store },
        { provide: ENTITY_SESSION, useValue: { current: () => (worldId() ? { worldId: worldId() } : null) } },
      ],
    });
    return TestBed.inject(BoardImagePlacement);
  }

  it('opens the source chooser for the current World and places an Image at the chosen URL', () => {
    worldId.set('w1');
    const placement = setup();

    placement.place({ x: 12, y: 34 });
    expect(dialogs.opened[0].data).toEqual({ worldId: 'w1' });

    // A choice (upload or pick both close with a URL) lands an Image at the clicked point.
    dialogs.lastRef().close('/assets/w1/pick.png');
    expect(store.added).toEqual([{ position: { x: 12, y: 34 }, url: '/assets/w1/pick.png' }]);
  });

  it('places nothing when the chooser is cancelled', () => {
    worldId.set('w1');
    const placement = setup();

    placement.place({ x: 0, y: 0 });
    dialogs.lastRef().close(); // cancelled → no URL

    expect(store.added).toEqual([]);
  });

  it('is a no-op with no resolved World — nowhere to mint an Asset', () => {
    worldId.set(null);
    const placement = setup();

    placement.place({ x: 0, y: 0 });

    expect(dialogs.opened).toEqual([]);
    expect(store.added).toEqual([]);
  });
});
