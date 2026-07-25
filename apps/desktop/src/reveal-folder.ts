/** As much of Electron's `shell` as revealing a folder needs, so a spec can stand in for it. */
export interface PathOpener {
  /** Electron's contract: resolves `''` on success, or the platform's message on failure. */
  openPath(path: string): Promise<string>;
}

/**
 * Show `dir` in the platform's file manager, so backing up worldbuilding is copying one folder (ADR-0070).
 * A refusal is reported rather than thrown, as the menu item has no surface to fail on.
 */
export async function revealFolder(shell: PathOpener, dir: string): Promise<void> {
  const failure = await shell.openPath(dir);
  if (failure) console.error(`[hexly] could not reveal ${dir}: ${failure}`);
}
