import { findKeyDrift } from './locale-key-sync';

describe('findKeyDrift', () => {
  it('reports no drift when both catalogs share the same keys', () => {
    const en = { auth: { heading: 'Sign in' }, common: { save: 'Save' } };
    const fr = { auth: { heading: 'Se connecter' }, common: { save: 'Enregistrer' } };

    const drift = findKeyDrift(en, fr);

    expect(drift.missing).toEqual([]);
    expect(drift.orphaned).toEqual([]);
    expect(drift.inSync).toBe(true);
  });

  it('flags a key present in the reference but missing from the target', () => {
    const en = { auth: { heading: 'Sign in' }, common: { save: 'Save' } };
    const fr = { auth: { heading: 'Se connecter' } };

    const drift = findKeyDrift(en, fr);

    expect(drift.missing).toEqual(['common.save']);
    expect(drift.orphaned).toEqual([]);
    expect(drift.inSync).toBe(false);
  });

  it('flags an orphaned target key that has no reference counterpart', () => {
    const en = { auth: { heading: 'Sign in' } };
    const fr = { auth: { heading: 'Se connecter', legacy: 'Ancien' } };

    const drift = findKeyDrift(en, fr);

    expect(drift.orphaned).toEqual(['auth.legacy']);
    expect(drift.missing).toEqual([]);
    expect(drift.inSync).toBe(false);
  });

  it('compares deeply nested keys by their full dot-path', () => {
    const en = { editor: { palette: { select: 'Select', erase: 'Erase' } } };
    const fr = { editor: { palette: { select: 'Sélectionner' } } };

    const drift = findKeyDrift(en, fr);

    expect(drift.missing).toEqual(['editor.palette.erase']);
    expect(drift.orphaned).toEqual([]);
  });

  it('treats an empty namespace as a leaf so a stubbed-vs-absent one drifts', () => {
    const en = { settings: {} };
    const fr = {};

    const drift = findKeyDrift(en, fr);

    expect(drift.missing).toEqual(['settings']);
    expect(drift.inSync).toBe(false);
  });

  it('does not alias a dotted key with a nested path of the same dot-form', () => {
    const en = { a: { b: 'nested' } };
    const fr = { 'a.b': 'flat' };

    const drift = findKeyDrift(en, fr);

    expect(drift.missing).toEqual(['a.b']);
    expect(drift.orphaned).toEqual(['a.b']);
    expect(drift.inSync).toBe(false);
  });
});
