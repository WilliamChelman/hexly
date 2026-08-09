import { NEVER, Observable, of } from 'rxjs';
import {
  AvailableType,
  CreateUserDefinedTypeRequest,
  CreateWorldFieldRequest,
  Field,
  FollowSignal,
  ImporterSummary,
  ImportRunSummary,
  ImportSummary,
  InboundLinkCount,
  MemberRole,
  Mount,
  UpdateUserDefinedTypeRequest,
  UpdateWorldFieldRequest,
  UserDefinedType,
  VaultImportOptions,
  WorldDetail,
  WorldKind,
  WorldMember,
  WorldSummary,
  WorldThemeInput,
  WorldThemeSource,
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
  importVault = vi.fn<(file: File, options?: VaultImportOptions) => Observable<ImportSummary>>();
  exportVault = vi.fn<(id: string) => Observable<Blob>>();
  get = vi.fn<(id: string) => Observable<WorldDetail>>();
  rename = vi.fn<(id: string, name: string) => Observable<WorldDetail>>();
  setPins = vi.fn<(id: string, pinnedEntityIds: string[]) => Observable<WorldDetail>>();
  setTheme = vi.fn<(id: string, theme: WorldThemeInput | null) => Observable<WorldDetail>>();
  setKind = vi.fn<(id: string, kind: WorldKind) => Observable<WorldDetail>>();
  setOpen = vi.fn<(id: string, open: boolean) => Observable<WorldDetail>>();
  // Defaults to nothing to copy from, so a spec mounting the Theme editor (#376) without caring
  // about it still renders; override per test as needed.
  themeSources = vi.fn<(id: string) => Observable<WorldThemeSource[]>>(() => of<WorldThemeSource[]>([]));
  delete = vi.fn<(id: string) => Observable<void>>();
  // Defaults to a Container nothing points into (ADR-0080, #414), so a spec opening a delete or
  // unmount confirm without caring about the blast radius still renders; override per test.
  inboundLinks = vi.fn<(id: string) => Observable<InboundLinkCount>>(() => of({ links: 0, worlds: 0 }));
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
  // Both default to empty, so a spec mounting the Mounts panel (ADR-0080, #408) without caring about
  // it still renders — an unmounted World is the ordinary case; override per test as needed.
  mounts = vi.fn<(id: string) => Observable<Mount[]>>(() => of<Mount[]>([]));
  mountCandidates = vi.fn<(id: string) => Observable<Mount[]>>(() => of<Mount[]>([]));
  addMount = vi.fn<(id: string, containerId: string) => Observable<Mount[]>>();
  reorderMounts = vi.fn<(id: string, containerIds: string[]) => Observable<Mount[]>>();
  removeMount = vi.fn<(id: string, containerId: string) => Observable<Mount[]>>();
  mountInboundLinks = vi.fn<(id: string, containerId: string) => Observable<InboundLinkCount>>(() =>
    of({ links: 0, worlds: 0 }),
  );
  // Defaults to no available Importers so a spec mounting the Imports panel (#260) without caring
  // about it still renders; override per test as needed.
  importers = vi.fn<(id: string) => Observable<ImporterSummary[]>>(() => of<ImporterSummary[]>([]));
  runImport = vi.fn<(id: string, importerId: string) => Observable<ImportRunSummary>>();
  importStatus = vi.fn<(id: string) => Observable<ImportRunSummary>>();
  removeImporter = vi.fn<(id: string, importerId: string) => Observable<void>>();
  // Defaults to no available types so a spec mounting the type-authoring panel (#191) without
  // caring about it still renders; override per test as needed.
  availableTypes = vi.fn<(id: string) => Observable<AvailableType[]>>(() => of<AvailableType[]>([]));
  createType = vi.fn<(id: string, req: CreateUserDefinedTypeRequest) => Observable<UserDefinedType>>();
  updateType =
    vi.fn<(id: string, typeId: string, patch: UpdateUserDefinedTypeRequest) => Observable<UserDefinedType>>();
  deleteType = vi.fn<(id: string, typeId: string) => Observable<void>>();
  // Defaults to no World-defined Fields so a spec mounting a Field-consuming surface (#230) without
  // caring about it still renders; override per test as needed.
  fields = vi.fn<(id: string) => Observable<Field[]>>(() => of<Field[]>([]));
  createField = vi.fn<(id: string, req: CreateWorldFieldRequest) => Observable<Field>>();
  updateField = vi.fn<(id: string, fieldId: string, patch: UpdateWorldFieldRequest) => Observable<Field>>();
  deleteField = vi.fn<(id: string, fieldId: string) => Observable<void>>();
}
