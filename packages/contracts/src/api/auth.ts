/**
 * Web login gate contract.
 *
 * The web app authenticates against the daemon's `POST /api/auth/login`
 * endpoint so credential validation lives server-side (in the daemon) instead
 * of in the browser bundle. The daemon validates against a single configured
 * account (`OD_WEB_USERNAME` / `OD_WEB_PASSWORD`, defaulting to
 * `admin` / `admin123`).
 */

/** Body for `POST /api/auth/login`. */
export interface LoginRequest {
  username: string;
  password: string;
}

/** Successful response from `POST /api/auth/login`. */
export interface LoginResponse {
  ok: true | false;
  username: string;
  userInfo?: any;
  uedro?: any
}

/** Successful response from `POST /api/auth/logout`. */
export interface LogoutResponse {
  ok: true | false;
}

/** Response from `GET /api/auth/getUserName`. */
export interface GetUserNameResponse {
  ok: true | false;
  username: string;
}

/** Current signed-in user's cached UPlus avatar, projected without credentials. */
export interface GetCurrentUserAvatarResponse {
  ok: true;
  avatarUrl: string | null;
}

/** Successful response from `POST /api/auth/himind/launch`. */
export interface HiMindLaunchResponse {
  ok: true;
  launchUrl: string;
  expiresIn: number;
}

/** Successful response from `POST /api/auth/ai-research/launch`. */
export interface AiResearchLaunchResponse {
  ok: true;
  launchUrl: string;
  expiresIn: number;
}

/** Fixed Lanz OpenAI gateway, configured after the current OA account signs in. */
export const LANZ_OPENAI_BASE_URL = 'http://lanz.hikvision.com/v3/openai/model';
export const LANZ_DEFAULT_MODEL = 'EB-DeepSeek-Flash';

export type LanzAccountFailureKind =
  | 'not_signed_in'
  | 'session_expired'
  | 'account_mismatch'
  | 'key_unavailable'
  | 'unavailable';

/** Device-local credential response. Never log, cache in HTTP, or send to analytics. */
export interface LanzAccountCredentials {
  ok: true;
  username: string;
  apiKey: string;
  baseUrl: string;
  defaultModel: string;
}

export type LanzAccountResponse =
  | LanzAccountCredentials
  | { ok: false; kind: LanzAccountFailureKind };

