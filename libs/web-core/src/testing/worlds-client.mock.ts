import { NEVER, Observable, of } from 'rxjs';
import {
  AvailableType,
  CreateUserDefinedTypeRequest,
  FollowSignal,
  ImportSummary,
  MemberRole,
  PublicLink,
  UpdateUserDefinedTypeRequest,
  UserDefinedType,
  WorldDetail,
  WorldMember,
  WorldSummary,
} from '@hexly/domain';
import { Watched } from '../services/live-follow';

/** Spy-backed stand-in for {@link WorldsClient} — set return values with `mockReturnValue`. */
export class MockWorldsClient {
  list = vi.fn<() => Observable<WorldSummary[]>>();
  // Live-follow seams default to a silent stream so a consumer that follows on construction doesn't
  // crash; a spec exercising live-follow overrides the impl (see the specs).
  watch = vi.fn<(id: string) => Observable<Watched<WorldDetail>>>(() => NEVER);
  watchAll = vi.fn<(ids: string[]) => Observable<FollowSignal>>(() => NEVER);
  create = vi.fn<(name: string) => Observable<WorldDetail>>();
  importVault = vi.fn<(file: File) => Observable<ImportSummary>>();
  exportVault = vi.fn<(id: string) => Observable<Blob>>();
  get = vi.fn<(id: string) => Observable<WorldDetail>>();
  rename = vi.fn<(id: string, name: string) => Observable<WorldDetail>>();
  setPins = vi.fn<(id: string, pinnedEntityIds: string[]) => Observable<WorldDetail>>();
  delete = vi.fn<(id: string) => Observable<void>>();
  // Defaults to an empty set so a spec that mounts the owner-set panel without
  // caring about it still renders; override per test as needed.
  owners = vi.fn<(id: string) => Observable<string[]>>(() => of<string[]>([]));
  addOwner = vi.fn<(id: string, userId: string) => Observable<string[]>>();
  removeOwner = vi.fn<(id: string, userId: string) => Observable<string[]>>();
  // Defaults to an empty set so a spec mounting the member panel without caring
  // about it still renders; override per test as needed.
  members = vi.fn<(id: string) => Observable<WorldMember[]>>(() => of<WorldMember[]>([]));
  addMember = vi.fn<(id: string, userId: string, role: MemberRole) => Observable<WorldMember[]>>();
  setMemberRole = vi.fn<(id: string, userId: string, role: MemberRole) => Observable<WorldMember[]>>();
  removeMember = vi.fn<(id: string, userId: string) => Observable<WorldMember[]>>();
  // Defaults to no active link so a spec mounting the Public Link control (#162) without
  // caring about it still renders; override per test as needed.
  link = vi.fn<(id: string) => Observable<PublicLink | null>>(() => of<PublicLink | null>(null));
  mintLink = vi.fn<(id: string) => Observable<PublicLink>>();
  revokeLink = vi.fn<(id: string) => Observable<void>>();
  // Defaults to no available types so a spec mounting the type-authoring panel (#191) without
  // caring about it still renders; override per test as needed.
  availableTypes = vi.fn<(id: string) => Observable<AvailableType[]>>(() => of<AvailableType[]>([]));
  createType = vi.fn<(id: string, req: CreateUserDefinedTypeRequest) => Observable<UserDefinedType>>();
  updateType =
    vi.fn<(id: string, typeId: string, patch: UpdateUserDefinedTypeRequest) => Observable<UserDefinedType>>();
  deleteType = vi.fn<(id: string, typeId: string) => Observable<void>>();
}
