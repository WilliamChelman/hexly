import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EntityDetail, HexMap, coordKey, emptyContent } from '@hexly/domain';
import { provideTranslocoTesting } from '../../../core/i18n/transloco-testing';
import { MockEntitySession } from '../../../core/testing/mock-entity-session';
import { EntitySession } from '../services/entity-session';
import { SaveStatus } from './save-status';

/**
 * SaveStatus is the autosave feedback chip that replaced the Save button (ADR-0026):
 * one aria-live surface over the session's saving/dirty/error/conflict state. Tested
 * against a {@link MockEntitySession} whose state the spec sets directly — the chip is
 * the unit, the session its facade; the session's own transitions live in
 * `entity-session.spec`.
 */
describe('SaveStatus', () => {
  let session: MockEntitySession;
  let fixture: ComponentFixture<SaveStatus>;

  const content = emptyContent();
  const forestAt00: HexMap = {
    hexes: { [coordKey({ q: 0, r: 0 })]: { terrain: 'forest' } },
    regions: [],
    labels: [],
  };
  const aldermoor: EntityDetail = {
    id: 'm1',
    ownerId: 'u1',
    worldId: 'w1',
    name: 'Aldermoor',
    type: 'hexmap',
    tags: [],
    visibility: 'private',
    version: 3,
    createdAt: 1,
    updatedAt: 1,
    document: { type: 'hexmap', content, ...forestAt00 },
  };

  beforeEach(() => {
    session = new MockEntitySession();
    TestBed.configureTestingModule({
      imports: [SaveStatus, provideTranslocoTesting()],
      // The mock omits a few unused EntitySession methods; cast past the token's shape.
      providers: [{ provide: EntitySession, useValue: session as unknown as EntitySession }],
    });
    fixture = TestBed.createComponent(SaveStatus);
  });

  const text = () => fixture.nativeElement.textContent as string;
  const click = (testid: string) =>
    (fixture.nativeElement.querySelector(`[data-testid=${testid}]`) as HTMLButtonElement).click();

  it('reads Saved when the open entity is clean', () => {
    session.setCurrent(aldermoor);
    fixture.detectChanges();
    expect(text()).toContain('Saved');
  });

  it('reads Unsaved after an edit, before the save lands', () => {
    session.setCurrent(aldermoor);
    session.setDirty(true);
    fixture.detectChanges();
    expect(text()).toContain('Unsaved');
  });

  it('reads Saving while a save is in flight', () => {
    session.setSaving(true);
    fixture.detectChanges();
    expect(text()).toContain('Saving');
  });

  it('shows a conflict with a working Reload', () => {
    session.setConflict(aldermoor);
    fixture.detectChanges();
    expect(text()).toContain('Newer version on server');

    click('conflict-reload');
    expect(session.reload).toHaveBeenCalled();
  });

  it('surfaces a failed Reload while keeping the conflict and its Reload button', () => {
    // The re-pull failed: the conflict stands, but the user must be told Reload failed —
    // else the chip looks unchanged and Reload appears to do nothing (ADR-0026).
    session.setConflict(aldermoor);
    session.setError('reload');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid=reload-error]')).not.toBeNull();
    // The Reload button is still there to try again.
    expect(fixture.nativeElement.querySelector('[data-testid=conflict-reload]')).not.toBeNull();
  });

  it('shows a save error with a Retry that re-saves', () => {
    session.setError('save');
    fixture.detectChanges();
    expect(text()).toContain('Save failed');

    click('save-retry');
    expect(session.save).toHaveBeenCalledWith(true);
  });

  it('announces status politely for assistive tech', () => {
    session.setCurrent(aldermoor);
    fixture.detectChanges();
    const live = fixture.nativeElement.querySelector('[aria-live=polite]');
    expect(live).not.toBeNull();
  });
});
