import { promotedName } from './promoted-name';

describe('promotedName', () => {
  it('takes the label as it stands when it is already a plain name', () => {
    expect(promotedName('Zorblax')).toBe('Zorblax');
  });

  it('takes the basename, never the explicit path (ADR-0073)', () => {
    expect(promotedName('folder/Zorblax')).toBe('Zorblax');
    expect(promotedName('bestiary/wyrms/Zorblax')).toBe('Zorblax');
  });

  it('drops a `.md` suffix, as import does for the same label', () => {
    expect(promotedName('folder/Zorblax.MD')).toBe('Zorblax');
  });

  it('reads empty for a label that is no name at all, so nothing blank is offered', () => {
    expect(promotedName('   ')).toBe('');
    expect(promotedName('folder/')).toBe('');
  });
});
