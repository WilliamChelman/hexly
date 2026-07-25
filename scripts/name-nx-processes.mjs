// Preloaded into every node process a dev serve forks (`NODE_OPTIONS=--import`), so that `ps`/`pgrep`
// show which dev server a process is instead of a wall of identical `node .../run-executor.js` lines.
//
// nx stamps the task's identity into the env of everything it forks, so the title can be derived here
// with no per-project wiring. Gating on those vars also keeps the long-lived nx daemon — spawned by
// the same CLI but carrying no task env — under its own recognisable name.
try {
  const project = process.env.NX_TASK_TARGET_PROJECT;
  const target = process.env.NX_TASK_TARGET_TARGET;
  if (project && target) {
    // @nx/js:node sets NX_FILE_TO_RUN only in the process that actually runs the bundle, which
    // separates the API server itself from the nx executor supervising it.
    const suffix = process.env.NX_FILE_TO_RUN ? ':app' : '';
    process.title = `hexly:${project}:${target}${suffix}`;
  }
} catch {
  // A throwing preload takes down every node process in the tree; a nicer `ps` output is never worth that.
}
