import { findKeyDrift } from './locale-key-sync';

describe('findKeyDrift', () => {
  it('reports no drift when both catalogs share the same keys', () => {
    const en = { auth: { heading: 'Sign in' }, common: { save: 'Save' } };
    const fr = { auth: { heading: 'Se connecter' }, common: { save: 'Enregistrer' } };

    const drift = findKeyDrift(en, fr);

    expect(drift.missingInFr).toEqual([]);
    expect(drift.missingInEn).toEqual([]);
    expect(drift.inSync).toBe(true);
  });

  it('flags a key present in en but missing from fr', () => {
    const en = { auth: { heading: 'Sign in' }, common: { save: 'Save' } };
    const fr = { auth: { heading: 'Se connecter' } };

    const drift = findKeyDrift(en, fr);

    expect(drift.missingInFr).toEqual(['common.save']);
    expect(drift.missingInEn).toEqual([]);
    expect(drift.inSync).toBe(false);
  });

  it('flags an orphaned fr key that has no en counterpart', () => {
    const en = { auth: { heading: 'Sign in' } };
    const fr = { auth: { heading: 'Se connecter', legacy: 'Ancien' } };

    const drift = findKeyDrift(en, fr);

    expect(drift.missingInEn).toEqual(['auth.legacy']);
    expect(drift.missingInFr).toEqual([]);
    expect(drift.inSync).toBe(false);
  });

  it('compares deeply nested keys by their full dot-path', () => {
    const en = { editor: { palette: { select: 'Select', erase: 'Erase' } } };
    const fr = { editor: { palette: { select: 'Sélectionner' } } };

    const drift = findKeyDrift(en, fr);

    expect(drift.missingInFr).toEqual(['editor.palette.erase']);
    expect(drift.missingInEn).toEqual([]);
  });
});
