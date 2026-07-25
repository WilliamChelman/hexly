import { PathOpener, revealFolder } from './reveal-folder';

function fakeShell(failure = ''): PathOpener & { readonly opened: string[] } {
  const opened: string[] = [];
  return {
    opened,
    openPath: async (path) => (opened.push(path), failure),
  };
}

describe('revealFolder', () => {
  /** Main reports through the console, so that is what a refusal is read off. */
  let reported: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    reported = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    reported.mockRestore();
  });

  it('opens the folder itself, not its parent', async () => {
    const shell = fakeShell();

    await revealFolder(shell, '/Users/ada/Library/Application Support/Hexly/hexly');

    expect(shell.opened).toEqual(['/Users/ada/Library/Application Support/Hexly/hexly']);
    expect(reported).not.toHaveBeenCalled();
  });

  it('reports a refusal instead of throwing, having no surface to fail on', async () => {
    await expect(revealFolder(fakeShell('no such folder'), '/gone')).resolves.toBeUndefined();

    expect(reported).toHaveBeenCalledWith(expect.stringContaining('no such folder'));
  });
});
