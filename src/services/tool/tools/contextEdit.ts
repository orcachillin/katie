import Core from "../../../core.js";
import { estimateContextTokens } from "../../agent/tokenEstimator.js";
import type { ChatMessage } from "../../agent/agentService.js";
import type ChannelContext from "../../bot/channelContext.js";
import type { Tool } from "../toolService.js";

const DEFAULT_TRUNCATE_CHARS = 200;
const MAX_TRUNCATE_CHARS = 20_000;
const MAX_TARGETS = 50;
const ID_ATTRIBUTE = /\bid="([^"]+)"/g;

interface ResolvedTargets {
    indexes: number[];
    unknownIds: string[];
    outOfRange: number[];
}

export const contextEdit = {
    type: "function",
    function: {
        name: "contextedit",
        description: "manage your own conversation context in the current channel. drop messages you no longer need (they disappear from your memory of this conversation), truncate an oversized message down to a short marker, or summarize to fold older messages into the context summary right now instead of waiting for the token budget. dropping a message that carried images keeps an evicted-image placeholder so the image is not silently forgotten.",
        parameters: {
            type: "object",
            properties: {
                action: {
                    type: "string",
                    enum: ["drop", "truncate", "summarize"],
                    description: "drop removes the targeted messages, truncate shrinks one message's content to chars characters, summarize compacts older messages into the rolling summary now",
                },
                indexes: { type: "array", items: { type: "integer" }, description: "0-based positions of messages in this channel's context (newest message has the highest index)" },
                ids: { type: "array", items: { type: "string" }, description: "message ids to target instead of indexes: the id=\"...\" value inside message/recentMessage/fetchedMessage tags, or a tool call id" },
                chars: { type: "integer", description: `truncate only: maximum content length in characters, defaults to ${DEFAULT_TRUNCATE_CHARS}` },
            },
            required: ["action"],
        },
        execute: async (args, ctx) => {
            const context = Core.services.bot.getChannelContext();
            if (!context.has(ctx.channelId)) return "this channel has no stored context yet";

            const action = args.action;
            if (action !== "drop" && action !== "truncate" && action !== "summarize") {
                return "action must be one of: drop, truncate, summarize";
            }

            const indexes = parseIndexes(args.indexes);
            if (typeof indexes === "string") return indexes;
            const ids = parseIds(args.ids);
            if (typeof ids === "string") return ids;

            if (action === "summarize") {
                if (indexes.length || ids.length) return "summarize takes no indexes or ids; it compacts older messages on its own";
                const result = await context.compact(ctx.channelId);
                if (!result) {
                    const messages = context.get(ctx.channelId);
                    return `context is already compact (~${formatTokens(estimateContextTokens(messages))} tokens across ${messages.length} messages, under the eviction target) — nothing to summarize`;
                }
                return `compacted: evicted ${result.dropped} message${result.dropped === 1 ? "" : "s"} and rolled them into the context summary, freed ~${formatTokens(result.tokensFreed)} tokens; ${contextSize(context, ctx.channelId)}`;
            }

            const resolved = resolveTargets(context, ctx.channelId, indexes, ids);
            if (!resolved.indexes.length) return describeUnresolved(context, ctx.channelId, resolved, action);

            if (action === "drop") {
                const result = context.dropMessages(ctx.channelId, resolved.indexes);
                if (!result) return describeUnresolved(context, ctx.channelId, resolved, action);
                const parts = [`dropped ${result.dropped} message${result.dropped === 1 ? "" : "s"}`];
                if (result.imagePlaceholders) parts.push(`kept ${result.imagePlaceholders} evicted-image placeholder${result.imagePlaceholders === 1 ? "" : "s"}`);
                parts.push(`saved ~${formatTokens(result.tokensSaved)} tokens`);
                return `${parts.join(", ")}; ${contextSize(context, ctx.channelId)}`;
            }

            const chars = typeof args.chars === "number" ? args.chars : DEFAULT_TRUNCATE_CHARS;
            if (!Number.isInteger(chars) || chars < 1 || chars > MAX_TRUNCATE_CHARS) {
                return `chars must be an integer between 1 and ${MAX_TRUNCATE_CHARS}`;
            }
            if (resolved.indexes.length > 1) {
                return `truncate targets exactly one message, but ${resolved.indexes.length} matched; narrow it to a single index or id`;
            }
            const index = resolved.indexes[0];
            const message = context.get(ctx.channelId)[index];
            if (typeof message.content !== "string") return "that message has no plain text content to truncate";
            const result = context.truncateMessage(ctx.channelId, index, chars);
            if (!result) return `message at index ${index} is already within ${chars} chars — nothing to truncate`;
            return `truncated message at index ${index} to ${chars} chars, saved ~${formatTokens(result.tokensSaved)} tokens; ${contextSize(context, ctx.channelId)}`;
        },
    },
} satisfies Tool;

function resolveTargets(context: ChannelContext, channelId: string, indexes: number[], ids: string[]): ResolvedTargets {
    const messages = context.get(channelId);
    const resolved: ResolvedTargets = { indexes: [], unknownIds: [], outOfRange: [] };
    for (const index of indexes) {
        if (index < messages.length) resolved.indexes.push(index);
        else resolved.outOfRange.push(index);
    }
    if (ids.length) {
        const idMap = new Map<string, number[]>();
        messages.forEach((message, index) => {
            for (const id of messageIds(message)) {
                const list = idMap.get(id) ?? [];
                list.push(index);
                idMap.set(id, list);
            }
        });
        for (const id of ids) {
            const matches = idMap.get(id);
            if (matches?.length) resolved.indexes.push(...matches);
            else resolved.unknownIds.push(id);
        }
    }
    resolved.indexes = [...new Set(resolved.indexes)].sort((a, b) => a - b);
    return resolved;
}

function messageIds(message: ChatMessage): string[] {
    const ids = new Set<string>();
    if (message.tool_call_id) ids.add(message.tool_call_id);
    const content = typeof message.content === "string" ? message.content : "";
    for (const match of content.matchAll(ID_ATTRIBUTE)) ids.add(match[1]);
    return [...ids];
}

function describeUnresolved(context: ChannelContext, channelId: string, resolved: ResolvedTargets, action: string): string {
    const messages = context.get(channelId);
    const problems: string[] = [];
    if (resolved.unknownIds.length) {
        problems.push(`no message in this channel's context has id ${resolved.unknownIds.map(id => `"${id}"`).join(" or ")}`);
    }
    for (const index of resolved.outOfRange) {
        problems.push(`index ${index} is out of range (context has ${messages.length} messages, indexes 0-${messages.length - 1})`);
    }
    if (!problems.length) problems.push(`no messages were targeted; give indexes or ids of messages in this channel's context (${messages.length} messages)`);
    return `nothing to ${action}: ${problems.join("; ")}`;
}

function parseIndexes(value: unknown): number[] | string {
    if (value === undefined) return [];
    if (!Array.isArray(value)) return "indexes must be an array of integers";
    if (value.length > MAX_TARGETS) return `no more than ${MAX_TARGETS} messages per call`;
    const indexes: number[] = [];
    for (const entry of value) {
        if (typeof entry !== "number" || !Number.isInteger(entry) || entry < 0) {
            return "indexes must be non-negative integers (0-based positions in this channel's context)";
        }
        indexes.push(entry);
    }
    return [...new Set(indexes)];
}

function parseIds(value: unknown): string[] | string {
    if (value === undefined) return [];
    if (!Array.isArray(value)) return "ids must be an array of strings";
    if (value.length > MAX_TARGETS) return `no more than ${MAX_TARGETS} messages per call`;
    const ids: string[] = [];
    for (const entry of value) {
        if (typeof entry !== "string" || !entry.trim()) return "ids must be non-empty strings";
        ids.push(entry.trim());
    }
    return [...new Set(ids)];
}

function formatTokens(tokens: number): string {
    return tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : String(tokens);
}

function contextSize(context: ChannelContext, channelId: string): string {
    const messages = context.get(channelId);
    return `context is now ~${formatTokens(estimateContextTokens(messages))} tokens across ${messages.length} messages`;
}
