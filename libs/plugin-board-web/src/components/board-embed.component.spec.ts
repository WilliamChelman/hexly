import { ChangeDetectionStrategy, Component, effect, input } from '@angular/core';
import { ComponentRef } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { EntityDetail } from '@hexly/domain';
import { EmbedElement, SURFACE_FIELD } from '@hexly/plugin-board';
import { provideTranslocoTesting } from '@hexly/web-core/testing';
import {
  DEFAULT_ENTITY_RENDER_CONTEXT,
  ENTITY_RENDER_CONTEXT,
  ENTITY_VIEW_OUTLET,
  EntityRenderContext,
} from '@hexly/web-entity';
import { BOARD_TEST_CATALOGS } from '../i18n/test-catalogs';
import { FakeEntitySession, provideBoardStoreTesting } from '../testing/entity-session.fake';
import { BoardStore } from '../services/board-store';
import { BoardEmbedComponent } from './board-embed.component';

/** The inputs the Embed passed to the outlet host, captured by the stub the seam is bound to. */
interface CapturedInputs {
  entityId: string | null;
  viewKey: string;
  renderContext: EntityRenderContext;
}
let captured: CapturedInputs | null;

/** A stub Entity View Outlet host: records the inputs the Embed threads across the `ENTITY_VIEW_OUTLET` seam. */
@Component({
  selector: 'app-stub-outlet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span data-testid="stub-outlet">{{ entityId() }}</span>`,
})
class StubOutletComponent {
  readonly entityId = input<string | null>(null);
  readonly viewKey = input('');
  readonly renderContext = input<EntityRenderContext>(DEFAULT_ENTITY_RENDER_CONTEXT);
  constructor() {
    effect(() => {
      captured = { entityId: this.entityId(), viewKey: this.viewKey(), renderContext: this.renderContext() };
    });
  }
}

function embedElement(over: Partial<EmbedElement> = {}): EmbedElement {
  return {
    id: 'em',
    kind: 'embed',
    position: { x: 0, y: 0 },
    size: { width: 360, height: 260 },
    z: 0,
    targetEntityId: 'note-2',
    viewInstance: 'core.view.content',
    ...over,
  };
}

/**
 * A board Entity the fake session opens as `current()` (the ancestor id and world the Embed reads), its
 * surface carrying the Embed element so the store resolves it — arming needs a live element.
 */
function boardDetail(element: EmbedElement): EntityDetail {
  return {
    id: 'board-1',
    worldId: 'w1',
    name: 'A board',
    types: ['core.board'],
    document: { [SURFACE_FIELD.id]: { elements: [element] } },
  } as unknown as EntityDetail;
}

describe('BoardEmbed', () => {
  let fixture: ComponentFixture<BoardEmbedComponent>;
  let ref: ComponentRef<BoardEmbedComponent>;
  let session: FakeEntitySession;
  let store: BoardStore;

  function setup(parentContext?: EntityRenderContext): void {
    captured = null;
    TestBed.configureTestingModule({
      imports: [BoardEmbedComponent, provideTranslocoTesting(BOARD_TEST_CATALOGS)],
      providers: [
        ...provideBoardStoreTesting(),
        { provide: ENTITY_VIEW_OUTLET, useValue: StubOutletComponent },
        provideRouter([]),
        ...(parentContext ? [{ provide: ENTITY_RENDER_CONTEXT, useValue: parentContext }] : []),
      ],
    });
    session = TestBed.inject(FakeEntitySession);
    store = TestBed.inject(BoardStore);
    fixture = TestBed.createComponent(BoardEmbedComponent);
    ref = fixture.componentRef;
  }

  function render(over: Partial<EmbedElement> = {}): void {
    const element = embedElement(over);
    // Seed the surface with this Embed so the store resolves it (arming needs a live element), and set
    // current() so the component reads the Board's id/world.
    session.loadDetail(boardDetail(element));
    ref.setInput('element', element);
    fixture.detectChanges();
  }

  it('threads the target and chosen View across the outlet seam', () => {
    setup();
    render();
    expect(captured?.entityId).toBe('note-2');
    expect(captured?.viewKey).toBe('core.view.content');
  });

  it('advances the render context at the page root: this Board is the sole ancestor, depth 1', () => {
    setup();
    render();
    // The page root provides no context, so the Embed advances the default: this Board's id appended, depth+1.
    expect(captured?.renderContext.ancestorIds).toEqual(['board-1']);
    expect(captured?.renderContext.depth).toBe(1);
    // No client config loaded in the spec → the ADR-0062 default cap of 3.
    expect(captured?.renderContext.maxDepth).toBe(3);
  });

  it('advances an inherited render context by one level (nested transclusion)', () => {
    setup({ ancestorIds: ['root', 'mid'], depth: 2, maxDepth: 5 });
    render();
    expect(captured?.renderContext.ancestorIds).toEqual(['root', 'mid', 'board-1']);
    expect(captured?.renderContext.depth).toBe(3);
  });

  it('is static (pointer-events-none) until armed, then captures the pointer', () => {
    setup();
    render();
    expect((fixture.nativeElement as HTMLElement).classList).toContain('pointer-events-none');

    store.arm('em');
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).classList).not.toContain('pointer-events-none');
  });

  it('opens the target Entity from the open affordance — a real link, so ctrl-click opens a new tab', () => {
    setup();
    render();

    // A routerLink anchor: its resolved href is the target's route, so the browser handles ctrl/cmd-click.
    const link = fixture.nativeElement.querySelector('[data-testid=embed-open-target]') as HTMLAnchorElement;
    const href = link.getAttribute('href');
    expect(href).toContain('w1');
    expect(href).toContain('note-2');
  });
});
