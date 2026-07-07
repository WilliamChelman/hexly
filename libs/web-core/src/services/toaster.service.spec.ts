import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToasterService } from './toaster.service';

describe('ToasterService', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('shows a toast with its message and tone', () => {
    const toaster = new ToasterService();

    toaster.show('Move blocked', 'error');

    const toasts = toaster.toasts();
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toEqual(
      expect.objectContaining({ message: 'Move blocked', tone: 'error' }),
    );
  });

  it('defaults a toast to the info tone', () => {
    const toaster = new ToasterService();

    toaster.show('Saved');

    expect(toaster.toasts()[0].tone).toBe('info');
  });

  it('stacks multiple toasts, each with a distinct id, in order shown', () => {
    const toaster = new ToasterService();

    const first = toaster.show('one');
    const second = toaster.show('two');

    expect(first).not.toBe(second);
    expect(toaster.toasts().map((t) => t.message)).toEqual(['one', 'two']);
  });

  it('dismisses a single toast by id, leaving the rest', () => {
    const toaster = new ToasterService();
    const keep = toaster.show('keep');
    const drop = toaster.show('drop');

    toaster.dismiss(drop);

    expect(toaster.toasts().map((t) => t.id)).toEqual([keep]);
  });

  it('auto-dismisses a toast after its duration elapses', () => {
    const toaster = new ToasterService();
    toaster.show('transient', 'info', 1000);
    expect(toaster.toasts()).toHaveLength(1);

    vi.advanceTimersByTime(999);
    expect(toaster.toasts()).toHaveLength(1);

    vi.advanceTimersByTime(1);
    expect(toaster.toasts()).toHaveLength(0);
  });

  it('keeps a toast indefinitely when its duration is zero', () => {
    const toaster = new ToasterService();
    toaster.show('sticky', 'error', 0);

    vi.advanceTimersByTime(60_000);

    expect(toaster.toasts()).toHaveLength(1);
  });

  it('clears every toast at once', () => {
    const toaster = new ToasterService();
    toaster.show('a');
    toaster.show('b');

    toaster.clear();

    expect(toaster.toasts()).toEqual([]);
  });
});
