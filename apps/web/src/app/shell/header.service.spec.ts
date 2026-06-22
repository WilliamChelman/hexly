import { TestBed } from '@angular/core/testing';
import { HeaderService } from './header.service';

describe('HeaderService', () => {
  function service(): HeaderService {
    return TestBed.inject(HeaderService);
  }

  it('starts with no declarative content', () => {
    const header = service();
    expect(header.eyebrow()).toBeNull();
    expect(header.title()).toBeNull();
  });

  it('exposes the eyebrow and title a page sets on activation', () => {
    const header = service();

    header.set({ eyebrow: 'Library', title: 'Your maps' });

    expect(header.eyebrow()).toBe('Library');
    expect(header.title()).toBe('Your maps');
  });

  it('clears back to empty when a page leaves', () => {
    const header = service();
    header.set({ eyebrow: 'Library', title: 'Your maps' });

    header.clear();

    expect(header.eyebrow()).toBeNull();
    expect(header.title()).toBeNull();
  });
});
