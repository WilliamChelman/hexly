import { ApplicationRef, ComponentRef, EnvironmentInjector, Injector, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Editor } from '@tiptap/core';
import { EntitySummary } from '@hexly/domain';
import { provideTranslocoTesting } from '@hexly/web-core/testing';
import { CONTENT_EDITOR_TEST_CATALOGS } from '../i18n/test-catalogs';
import { CONTENT_EXTENSIONS } from '../extensions/content-extensions';
import { EntityNameResolver, EntityResolution } from '../services/entity-name-resolver';
import { EntityLinkRepair, EntityLinkViewComponent, createEntityLinkNodeView } from './entity-link-view.component';

/** A resolver stub that reports a fixed live name for every id (no HTTP). */
class StubResolver {
  constructor(private readonly resolution: EntityResolution) {}
  resolve(): EntityResolution {
    return this.resolution;
  }
}

/** The popover takes the keyboard a microtask after the render that portals it (see the component). */
const flushMicrotasks = () => new Promise((resolve) => queueMicrotask(resolve as () => void));

const found = (name: string): EntityResolution => ({
  status: 'found',
  entity: { name } as EntitySummary,
});

describe('EntityLinkView', () => {
  function mount(inputs: {
    entityId: string;
    label: string;
    display?: string | null;
    heading?: string | null;
    descriptor?: string | null;
    repair?: EntityLinkRepair;
  }) {
    const fixture = TestBed.createComponent(EntityLinkViewComponent);
    const ref = fixture.componentRef as ComponentRef<EntityLinkViewComponent>;
    ref.setInput('entityId', inputs.entityId);
    ref.setInput('label', inputs.label);
    if ('display' in inputs) ref.setInput('display', inputs.display ?? null);
    if ('heading' in inputs) ref.setInput('heading', inputs.heading ?? null);
    if ('descriptor' in inputs) ref.setInput('descriptor', inputs.descriptor ?? null);
    if (inputs.repair) ref.setInput('repair', inputs.repair);
    fixture.detectChanges();
    return fixture;
  }

  /** A repair whose two standings are open, recording what the popover asks of the document. */
  function repairStub() {
    return {
      writable: signal(true),
      creatable: signal(true),
      retarget: vi.fn<(entity: EntitySummary) => void>(),
      promote: vi.fn<(name: string) => void>(),
    } satisfies EntityLinkRepair;
  }

  function configure(resolution: EntityResolution) {
    TestBed.configureTestingModule({
      imports: [EntityLinkViewComponent, provideTranslocoTesting(CONTENT_EDITOR_TEST_CATALOGS)],
      providers: [{ provide: EntityNameResolver, useValue: new StubResolver(resolution) }, provideRouter([])],
    });
  }

  it('renders the live target name when no display override is set', () => {
    configure(found('Avalon'));
    const fixture = mount({ entityId: 'e1', label: 'stale' });

    const link = fixture.nativeElement.querySelector('[data-testid=entity-link]');
    expect(link.textContent).toContain('Avalon');
    expect(link.textContent).not.toContain('stale');
  });

  it('renders the static display text in place of the live name (ADR-0033)', () => {
    configure(found('Avalon'));
    const fixture = mount({
      entityId: 'e1',
      label: 'Avalon',
      display: 'the White City',
    });

    const link = fixture.nativeElement.querySelector('[data-testid=entity-link]');
    expect(link.textContent).toContain('the White City');
    // The live name is deliberately overridden — narrative prose keeps its phrasing.
    expect(link.textContent).not.toContain('Avalon');
  });

  it('carries the heading as a router fragment so navigation can anchor to it', () => {
    configure(found('Avalon'));
    const fixture = mount({
      entityId: 'e1',
      label: 'Avalon',
      heading: 'History',
    });

    const anchor = fixture.nativeElement.querySelector('[data-testid=entity-link]');
    // routerLink renders the fragment into the href as `#History`.
    expect(anchor.getAttribute('href')).toContain('#History');
  });

  describe('a link with no id — an Unresolved Link (ADR-0073)', () => {
    it('reads as unresolved rather than dangling, without consulting the resolver', () => {
      // The stub would answer *any* id with a live name; an Unresolved Link must never ask.
      configure(found('Avalon'));
      const fixture = mount({ entityId: '', label: 'Zorblax' });

      const link = fixture.nativeElement.querySelector('[data-testid=entity-link]');
      expect(link.hasAttribute('data-unresolved')).toBe(true);
      expect(link.hasAttribute('data-dangling')).toBe(false);
      expect(link.textContent).toContain('Zorblax');
      // Non-navigable, exactly as a dangling link is.
      expect(link.tagName).toBe('SPAN');
    });

    it('stays distinct from a dangling link, whose target went away', () => {
      configure({ status: 'missing' });
      const fixture = mount({ entityId: 'e1', label: 'Avalon' });

      const link = fixture.nativeElement.querySelector('[data-testid=entity-link]');
      expect(link.hasAttribute('data-dangling')).toBe(true);
      expect(link.hasAttribute('data-unresolved')).toBe(false);
      expect(link.tagName).toBe('SPAN');
    });

    it('keeps the `[[Target|display]]` override', () => {
      configure(found('Avalon'));
      const fixture = mount({ entityId: '', label: 'Zorblax', display: 'the old wyrm' });

      const link = fixture.nativeElement.querySelector('[data-testid=entity-link]');
      expect(link.textContent).toContain('the old wyrm');
      expect(link.textContent).not.toContain('Zorblax');
    });

    it('moves the keyboard into the popover it portals away, and again into the picker', async () => {
      // The popover is appended to the end of <body>, so Tab from the pill would skip straight past it.
      configure(found('Avalon'));
      const fixture = mount({ entityId: '', label: 'Zorblax', repair: repairStub() });

      (fixture.nativeElement.querySelector('[data-testid=entity-link]') as HTMLElement).click();
      fixture.detectChanges();
      await flushMicrotasks();

      const menu = document.body.querySelector('[data-testid=entity-link-repair]') as HTMLElement;
      expect(document.activeElement).toBe(menu.querySelector('[data-testid=entity-link-repair-create]'));

      (menu.querySelector('[data-testid=entity-link-relink]') as HTMLElement).click();
      fixture.detectChanges();
      await flushMicrotasks();

      // The action list became the picker: the keyboard follows it rather than staying on a gone button.
      expect(document.activeElement?.tagName).toBe('INPUT');
      fixture.destroy();
    });

    it('mints once while a promotion is out — clicking Create again is not a second Entity', async () => {
      // The link stays unresolved until the mint lands, so its popover can be opened and asked again —
      // and a second mint is exactly the duplicate ADR-0073 keeps Create away from a dangling link over.
      configure(found('Avalon'));
      const editor = new Editor({ extensions: CONTENT_EXTENSIONS });
      editor.commands.insertEntityLink({ entityId: '', label: 'Zorblax' });
      const node = editor.state.doc.nodeAt(1)!;
      const mint = vi.fn(() => new Promise<EntitySummary>(() => undefined));
      const view = createEntityLinkNodeView(
        node,
        editor,
        () => 1,
        { writable: signal(true), creatable: signal(true), mint },
        TestBed.inject(EnvironmentInjector),
        TestBed.inject(Injector),
        TestBed.inject(ApplicationRef),
      );
      const appRef = TestBed.inject(ApplicationRef);
      appRef.tick();

      const promote = async () => {
        ((view.dom as HTMLElement).querySelector('[data-testid=entity-link]') as HTMLElement).click();
        appRef.tick();
        await flushMicrotasks();
        (document.body.querySelector('[data-testid=entity-link-repair-create]') as HTMLElement).click();
        appRef.tick();
      };
      await promote();
      await promote();

      expect(mint).toHaveBeenCalledTimes(1);
      view.destroy?.();
      editor.destroy();
    });

    it('still carries a Link Descriptor badge, in its own hue', () => {
      configure(found('Avalon'));
      const fixture = mount({ entityId: '', label: 'Zorblax', descriptor: 'hunts' });

      const badge = fixture.nativeElement.querySelector('[data-testid=link-descriptor]');
      expect(badge.textContent).toContain('hunts');
      // The badge follows the pill, so all three states stay tellable apart (ADR-0021 utilities).
      expect(badge.classList.contains('bg-astra')).toBe(true);
      expect(badge.classList.contains('bg-gold')).toBe(false);
      expect(badge.classList.contains('bg-ink-muted')).toBe(false);
    });
  });
});
