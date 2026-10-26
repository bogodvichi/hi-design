import type { ChatMessage } from './chat.js';

export interface CompactConversationRequest {
  instructions?: string;
  locale?: string;
}

export interface CompactConversationResponse {
  compacted: boolean;
  preTokens?: number;
  message: ChatMessage;
}

/** Only a command occupying the whole input is dispatched to the runtime. */
export function parseCompactCommand(text: string): CompactConversationRequest | null {
  const match = /^\/compact(?:[ \t]+([^\n]*))?$/.exec(text.trim());
  return match ? { instructions: match[1]?.trim() ?? '' } : null;
}

/** Includes legacy persisted errors that predate structured failure details. */
export function isContextSizeError(text: string): boolean {
  return /\b(?:request body (?:so|too) large|payload too large|request entity too large|request body exceeds configured limit|request_too_large|prompt (?:is )?too (?:long|large)|context (?:window|length|size).*exceed(?:ed|s)?|maximum context length|context too large|too many tokens|prefill context too large)\b/i.test(text);
}
