/* eslint-disable no-restricted-imports */
import { enablePatches } from 'immer';

enablePatches();

export type { Patch, PatchListener, Draft, Immutable, Objectish } from 'immer';
export {
  produce,
  produceWithPatches,
  applyPatches,
  createDraft,
  finishDraft,
  current,
  original,
  freeze,
  isDraft,
  isDraftable,
  nothing,
  castDraft,
  castImmutable,
  setAutoFreeze,
  setUseStrictShallowCopy,
} from 'immer';
