/** Body for the existing `POST /api/hik/uedro/userList` lookup. */
export interface UedroUserListRequest {
  userName: string;
  pageNo: number;
  pageSize: number;
  /** Bind delegated lookups to the OA user who opened the embedded tool. */
  expectedUsername?: string;
}

export interface HiMindDirectorySearchRequest {
  type: 'himind:directory-search:v1';
  requestId: string;
  query: string;
}

export interface HiMindDirectoryPerson {
  email: string;
  name?: string;
  userDeptPath?: string;
}

export type HiMindDirectorySearchResult = {
  type: 'hidesign:directory-search-result:v1';
  requestId: string;
} & ({ ok: true; people: HiMindDirectoryPerson[] } | { ok: false });

/** Runtime metadata needed by the web client to build HDW share links. */
export interface HdwRuntimeConfigResponse {
  /** Explicit share base resolved from the effective HDW gateway address. */
  sharePublicBase: string;
}
