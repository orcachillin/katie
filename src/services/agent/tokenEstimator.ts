import type { ChatMessage } from "./types.js";

const CHARS_PER_TOKEN = 2;
const CODE_CHARS_PER_TOKEN = 1.5;
const BASE64_CHARS_PER_TOKEN = 2;
const BASE64_MIN_LENGTH = 200;
const BASE64_PATTERN = new RegExp(`[A-Za-z0-9+/=]{${BASE64_MIN_LENGTH},}`, "g");
const IMAGE_TOKENS = 16;
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
