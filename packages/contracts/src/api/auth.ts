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
