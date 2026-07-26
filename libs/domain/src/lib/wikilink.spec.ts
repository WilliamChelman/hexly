import { basename } from 'node:path';
import { wikilinkName } from './wikilink';

describe('wikilinkName', () => {
  it('takes the label as it stands when it is already a plain name', () => {
    expect(wikilinkName('Zorblax')).toBe('Zorblax');
  });

  it('takes the basename, never the explicit path (ADR-0033)', () => {
    expect(wikilinkName('folder/Zorblax')).toBe('Zorblax');
    expect(wikilinkName('bestiary/wyrms/Zorblax')).toBe('Zorblax');
  });

  it('drops a `.md` suffix, whatever its case', () => {
    expect(wikilinkName('folder/Zorblax.MD')).toBe('Zorblax');
  });

  it('reads empty for a label that is no name at all, so nothing blank is offered', () => {
    expect(wikilinkName('   ')).toBe('');
    expect(wikilinkName('')).toBe('');
    expect(wikilinkName('/')).toBe('');
  });

  // The import reads labels through `posix.basename`; the editor's promotion cannot (no `node:path` in a
  // browser). This is the fact that keeps the reimplementation honest — `folder/` is where they used to
  // part ways, the client offering nothing where the server minted "folder".
  it('reads every label as `posix.basename` does, so both writers name the same Entity', () => {
    for (const label of ['Zorblax', 'folder/Zorblax', 'bestiary/wyrms/Zorblax', 'folder/', 'a//b', '/', '']) {
      expect(wikilinkName(label)).toBe(basename(label).replace(/\.md$/i, '').trim());
    }
  });
});
