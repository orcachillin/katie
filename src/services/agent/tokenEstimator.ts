import type { ChatMessage } from "./types.js";

const CHARS_PER_TOKEN = 4;
const CODE_CHARS_PER_TOKEN = 3;
const BASE64_CHARS_PER_TOKEN = 2;
const BASE64_MIN_LENGTH = 200;
const BASE64_PATTERN = new RegExp(`[A-Za-z0-9+/=]{${BASE64_MIN_LENGTH},}`, "g");
const IMAGE_TOKENS = 16;
const TOOL_RESULT_MAX_CHARS = 200;
export const TRUNCATED_MARKER = "[truncated]";

export function estimateTokens(text: string): number {
    if (!text) return 0;
    const base64Runs = text.match(BASE64_PATTERN) ?? [];
    const base64Chars = base64Runs.reduce((sum, run) => sum + run.length, 0);
    const remainder = base64Runs.length ? text.replace(BASE64_PATTERN, " ") : text;

    let tokens = base64Chars / BASE64_CHARS_PER_TOKEN;
    const segments = remainder.split("```");
    for (let i = 0; i < segments.length; i++) {
        tokens += i % 2 === 1
            ? segments[i].length / CODE_CHARS_PER_TOKEN
            : segments[i].length / CHARS_PER_TOKEN;
    }
    return Math.ceil(tokens);
}

export function estimateMessageTokens(message: ChatMessage): number {
    const content = typeof message.content === "string" ? message.content : "";
    return estimateTokens(content) + (message.images?.length ?? 0) * IMAGE_TOKENS;
}

export function estimateContextTokens(messages: ChatMessage[]): number {
    return messages.reduce((sum, message) => sum + estimateMessageTokens(message), 0);
}

export function trimOldToolResults(messages: ChatMessage[]): void {
    let end = messages.length - 1;
    while (end >= 0 && messages[end].role !== "tool") end--;
    if (end === -1) return;
    let start = end;
    while (start > 0 && messages[start - 1].role === "tool") start--;
    for (let i = 0; i < start; i++) {
        const message = messages[i];
        if (message.role !== "tool" || typeof message.content !== "string") continue;
        if (message.content.endsWith(TRUNCATED_MARKER)) continue;
        if (message.content.length <= TOOL_RESULT_MAX_CHARS) continue;
        message.content = `${message.content.slice(0, TOOL_RESULT_MAX_CHARS)} ${TRUNCATED_MARKER}`;
    }
}
