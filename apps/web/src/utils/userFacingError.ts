import type { Dict } from '../i18n/types';

type Translate = (key: keyof Dict, vars?: Record<string, string | number>) => string;
type FeedbackKey = Extract<keyof Dict, `feedback.${string}`>;

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
}

// Keep transport diagnostics on the Error, rather than placing them in UI copy.
export async function responseError(response: Response, payload?: unknown): Promise<Error> {
  const body = record(payload ?? await response.json().catch(() => null));
  const detail = record(body.error);
  const code = detail.code ?? (typeof body.error === 'string' ? body.error : undefined) ?? body.code;
  const message = detail.message ?? body.message ?? body.msg ?? body.error;
  return Object.assign(new Error(typeof message === 'string' ? message : `HTTP ${response.status}`), {
    code,
    status: response.status,
  });
}

const CODE_KEYS: Record<string, FeedbackKey> = {
  AUTHENTICATION_REQUIRED: 'feedback.signInRequired',
  INVALID_SESSION: 'feedback.sessionExpired',
  RESOURCE_ACCESS_DENIED: 'feedback.accessDenied',
  WORKSPACE_ACCESS_DENIED: 'feedback.accessDenied',
  PROJECT_ACCESS_DENIED: 'feedback.accessDenied',
  NOT_RESOURCE_OWNER: 'feedback.operationDenied',
  PROJECT_DELETE_FORBIDDEN: 'feedback.operationDenied',
  WORKSPACE_RESOURCE_ID_CONFLICT: 'feedback.skillInstallConflict',
  RESOURCE_NAME_CONFLICT: 'feedback.nameConflict',
  SOURCE_HAS_PUBLICATION: 'feedback.publicationExists',
  RESOURCE_NOT_FOUND: 'feedback.contentDeleted',
  PROJECT_NOT_FOUND: 'feedback.contentDeleted',
  FOLDER_NOT_FOUND: 'feedback.contentDeleted',
  FILE_EDIT_CONFLICT: 'feedback.editConflict',
  UPSTREAM_UNAVAILABLE: 'feedback.serviceUnavailable',
};

export function userFacingError(
  error: unknown,
  t: Translate,
  fallback: keyof Dict,
  object = t('feedback.objectContent'),
): string {
  const value = record(error);
  const detail = record(value.error);
  const message = typeof error === 'string' ? error
    : typeof value.message === 'string' ? value.message
      : typeof detail.message === 'string' ? detail.message
        : typeof value.error === 'string' ? value.error : '';
  const code = String(value.code ?? detail.code ?? message).trim();
  const key = CODE_KEYS[code] ?? CODE_KEYS[message.trim()];
  if (key) {
    // Chinese copy separates Latin product names from adjacent Chinese text.
    return t(key, { object }).replace(/([\u3400-\u9fff])([A-Za-z0-9])/g, '$1 $2')
      .replace(/([A-Za-z0-9])([\u3400-\u9fff])/g, '$1 $2');
  }
  if (/^(failed to fetch|network error|networkerror|network request failed|fetch failed)$/i.test(message)) {
    return t('feedback.networkFailed');
  }
  if (value.name === 'TimeoutError' || ['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT'].includes(code)) {
    return t('feedback.requestTimedOut');
  }
  // Preserve field guidance, but never echo stack traces, URLs or error codes.
  if (message.length <= 180 && /[\u3400-\u9fff]/.test(message)
    && !/[\r\n{}<>]|\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b|\bHTTP\b|\/api\/|https?:|\b(?:Error|TypeError|SyntaxError|ENOENT|EACCES|ECONNREFUSED|SQLITE|stack)\b|Bearer\s|\b(?:token|password|cookie|secret)\b|内部错误|未知错误/i.test(message)) {
    return message;
  }
  return t(fallback);
}
