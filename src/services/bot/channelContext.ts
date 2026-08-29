import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import type { ChatMessage } from "../agent/agentService.js";
import { estimateContextTokens, estimateMessageTokens, estimateTokens, trimOldToolResults, TRUNCATED_MARKER } from "../agent/tokenEstimator.js";
import { Logger } from "../../util/logger.js";
import XML from "../../util/xml.js";
import { resolve } from "node:path";

const CONTEXT_ROOT = resolve(process.env.CONTEXT_ROOT || "./workspace/contexts");
const TOKEN_BUDGET = Math.max(1000, Number(process.env.CONTEXT_TOKEN_BUDGET) || 24000);
const EVICT_TARGET_RATIO = 0.6;
const MIN_RECENT_MESSAGES = 30;
const SUMMARY_TAG = "contextSummary";
const SUMMARY_MATCH = new RegExp(`^<${SUMMARY_TAG}[^>]*>([\\s\\S]*)</${SUMMARY_TAG}>$`);
const SUMMARY_MAX_TOKENS = 150;
const SUMMARY_INPUT_MESSAGE_CHARS = 400;
const SUMMARY_INPUT_MAX_CHARS = 24000;
const SUMMARY_CACHE_MAX = 100;

export type ContextSummarizer = (messages: ChatMessage[], previousSummary: string) => Promise<string>;

export interface ChannelContextStats {
    evictions: number;
    summaries: number;
    cachedSummaries: number;
}

export interface ContextDropResult {
    dropped: number;
    imagePlaceholders: number;
    tokensSaved: number;
}

export interface ContextTruncateResult {
    tokensSaved: number;
}

export interface ContextCompactResult {
    dropped: number;
    tokensFreed: number;
}

export default class ChannelContext {

    private logger = new Logger("channelContext");
    private channels: Record<string, ChatMessage[]> = {}
    private pendingSpans: Record<string, ChatMessage[][]> = {};
    private pendingPriorSummary: Record<string, string> = {};
    private summarizing = new Set<string>();
    private summaryCache = new Map<string, string>();
    private statsMap: Record<string, ChannelContextStats> = {};

    constructor(private readonly summarizer?: ContextSummarizer) {
        mkdirSync(CONTEXT_ROOT, { recursive: true });
        for (const file of readdirSync(CONTEXT_ROOT).filter(file => file.endsWith(".json"))) {
            try {
                const messages = JSON.parse(readFileSync(resolve(CONTEXT_ROOT, file), "utf-8"));
                if (Array.isArray(messages)) {
                    const context = messages as ChatMessage[];
                    trimOldToolResults(context);
                    this.channels[file.slice(0, -5)] = context;
                }
            } catch { }
        }
    }

    get(channelId: string): ChatMessage[] {
        const context = this.channels[channelId]
        // create a copy of context that removes unsent messages
        if (context) return context
        const empty: ChatMessage[] = []
        this.channels[channelId] = empty
        return empty
    }

    set(channelId: string, messages: ChatMessage[]): void {
        this.channels[channelId] = messages
        trimOldToolResults(messages);
        this.evict(channelId);
        this.save(channelId)

    }

    append(channelId: string, ...messages: ChatMessage[]): void {
        const existing = this.get(channelId);
        existing.push(...messages);
        trimOldToolResults(existing);
        this.evict(channelId);
        this.save(channelId)
    }

    prepend(channelId: string, ...messages: ChatMessage[]): void {
        const existing = this.get(channelId);
        existing.unshift(...messages);
        trimOldToolResults(existing);
        this.evict(channelId);
        this.save(channelId);
    }

    markSent(channelId: string, message: ChatMessage): void {
        if (!this.get(channelId).includes(message)) return;
        message.sent = true;
        this.save(channelId);
    }

    remove(channelId: string, message: ChatMessage): void {
        const existing = this.get(channelId);
        const index = existing.indexOf(message);
        if (index === -1) return;
        existing.splice(index, 1);
        this.save(channelId);
    }

    dropMessages(channelId: string, indexes: number[]): ContextDropResult | null {
        const messages = this.channels[channelId];
        if (!messages) return null;
        const targets = [...new Set(indexes)]
            .filter(index => Number.isInteger(index) && index >= 0 && index < messages.length)
            .sort((a, b) => b - a);
        if (!targets.length) return null;
        const tokensBefore = estimateContextTokens(messages);
        let imagePlaceholders = 0;
        for (const index of targets) {
            const message = messages[index];
            if (message.images?.length) {
                messages[index] = {
                    role: message.role,
                    tool_call_id: message.tool_call_id,
                    content: message.images.map(image => `[image attachment: ${image.name} — evicted]`).join("\n"),
                };
                imagePlaceholders++;
            } else {
                messages.splice(index, 1);
            }
        }
        this.save(channelId);
        return {
            dropped: targets.length,
            imagePlaceholders,
            tokensSaved: tokensBefore - estimateContextTokens(messages),
        };
    }

    truncateMessage(channelId: string, index: number, maxLength: number): ContextTruncateResult | null {
        const messages = this.channels[channelId];
        const message = messages?.[index];
        if (!message || typeof message.content !== "string") return null;
        if (!Number.isInteger(maxLength) || maxLength < 1) return null;
        const truncated = `${message.content.slice(0, maxLength)} ${TRUNCATED_MARKER}`;
        if (truncated.length >= message.content.length) return null;
        const tokensBefore = estimateMessageTokens(message);
        message.content = truncated;
        this.save(channelId);
        return { tokensSaved: tokensBefore - estimateMessageTokens(message) };
    }

    async compact(channelId: string): Promise<ContextCompactResult | null> {
        const span = this.evictSpan(channelId);
        if (!span) return null;
        const result = { dropped: span.length, tokensFreed: estimateContextTokens(span) };
        this.save(channelId);
        if (this.summarizer && this.pendingSpans[channelId]?.length && !this.summarizing.has(channelId)) {
            this.summarizing.add(channelId);
            try {
                await this.summarizePending(channelId);
            } catch (err: any) {
                this.logger.warn(`context summary failed for ${channelId}: ${err?.message ?? err}`);
            } finally {
                this.summarizing.delete(channelId);
                if (this.pendingSpans[channelId]?.length) this.scheduleSummary(channelId);
            }
        } else {
            this.scheduleSummary(channelId);
        }
        return result;
    }

    save(channelId: string) {
        writeFileSync(resolve(CONTEXT_ROOT, `${channelId}.json`), JSON.stringify(this.channels[channelId], null, 2))
    }

    clear(channelId: string): void {
        delete this.channels[channelId]
        delete this.pendingSpans[channelId];
        delete this.pendingPriorSummary[channelId];
    }

    has(channelId: string): boolean {
        return !!this.channels[channelId]
    }

    all(): Record<string, ChatMessage[]> {
        return this.channels;
    }

    getStats(): Record<string, ChannelContextStats> {
        return this.statsMap;
    }

    private stats(channelId: string): ChannelContextStats {
        return this.statsMap[channelId] ??= { evictions: 0, summaries: 0, cachedSummaries: 0 };
    }

    private evict(channelId: string): void {
        const messages = this.channels[channelId];
        if (!messages) return;
        if (estimateContextTokens(messages) <= TOKEN_BUDGET) return;
        const span = this.evictSpan(channelId);
        if (span) this.scheduleSummary(channelId);
    }

    private evictSpan(channelId: string): ChatMessage[] | null {
        const messages = this.channels[channelId];
        if (!messages) return null;
        const total = estimateContextTokens(messages);
        const target = Math.floor(TOKEN_BUDGET * EVICT_TARGET_RATIO);
        let evicted = 0;
        let split = 0;
        while (split < messages.length && total - evicted > target) {
            evicted += estimateMessageTokens(messages[split]);
            split++;
        }
        split = Math.min(split, messages.length - MIN_RECENT_MESSAGES);
        while (split > 0 && split < messages.length && messages[split].role === "tool") split++;
        if (split <= 0) return null;

        const span = messages.splice(0, split);
        const spanSummary = span.find(message =>
            message.role === "system"
            && typeof message.content === "string"
            && message.content.startsWith(`<${SUMMARY_TAG}`)
        );
        if (spanSummary) {
            const prior = SUMMARY_MATCH.exec(spanSummary.content as string);
            if (prior) this.pendingPriorSummary[channelId] = prior[1].trim();
        }

        this.stats(channelId).evictions++;
        this.logger.log(`context ${channelId}: evicted ${span.length} messages (~${estimateContextTokens(span)} tokens, budget ${TOKEN_BUDGET})`);
        (this.pendingSpans[channelId] ??= []).push(span);
        return span;
    }

    private scheduleSummary(channelId: string): void {
        if (this.summarizing.has(channelId) || !this.summarizer) return;
        if (!this.pendingSpans[channelId]?.length) return;
        this.summarizing.add(channelId);
        void this.summarizePending(channelId)
            .catch(err => this.logger.warn(`context summary failed for ${channelId}: ${err?.message ?? err}`))
            .finally(() => {
                this.summarizing.delete(channelId);
                if (this.pendingSpans[channelId]?.length) this.scheduleSummary(channelId);
            });
    }

    private async summarizePending(channelId: string): Promise<void> {
        const spans = this.pendingSpans[channelId] ?? [];
        this.pendingSpans[channelId] = [];
        if (!spans.length || !this.summarizer) return;

        const flat = spans.flat();
        let material = "";
        for (const message of flat) {
            if (material.length >= SUMMARY_INPUT_MAX_CHARS) break;
            material += `${message.role}: ${String(message.content ?? "").slice(0, SUMMARY_INPUT_MESSAGE_CHARS)}\n`;
        }
        const priorSummary = this.pendingPriorSummary[channelId] ?? this.currentSummaryText(channelId);
        const input = priorSummary
            ? `Previous summary:\n${priorSummary}\n\nNewer activity to fold in:\n${material}`
            : material;

        const cacheKey = this.hash(input);
        let summary = this.summaryCache.get(cacheKey);
        if (summary !== undefined) {
            this.stats(channelId).cachedSummaries++;
        } else {
            summary = this.clampSummary(await this.summarizer(flat.map(message => ({
                role: message.role,
                content: String(message.content ?? "").slice(0, SUMMARY_INPUT_MESSAGE_CHARS),
            })), priorSummary));
            if (!summary) return;
            this.summaryCache.set(cacheKey, summary);
            if (this.summaryCache.size > SUMMARY_CACHE_MAX) {
                this.summaryCache.delete(this.summaryCache.keys().next().value as string);
            }
            this.stats(channelId).summaries++;
        }

        if (!this.has(channelId)) return;
        const content = XML.format(SUMMARY_TAG, { updatedAt: new Date().toISOString() }, summary);
        const messages = this.get(channelId);
        const index = messages.findIndex(message =>
            message.role === "system"
            && typeof message.content === "string"
            && message.content.startsWith(`<${SUMMARY_TAG}`)
        );
        if (index !== -1) {
            messages[index] = { ...messages[index], content };
        } else {
            messages.unshift({ role: "system", content });
        }
        delete this.pendingPriorSummary[channelId];
        this.save(channelId);
        this.logger.log(`context ${channelId}: summarized ${flat.length} evicted messages into ~${estimateTokens(content)} tokens`);
    }

    private currentSummaryText(channelId: string): string {
        if (!this.has(channelId)) return "";
        const message = this.get(channelId).find(message =>
            message.role === "system"
            && typeof message.content === "string"
            && message.content.startsWith(`<${SUMMARY_TAG}`)
        );
        if (!message) return "";
        const match = SUMMARY_MATCH.exec(message.content as string);
        return match ? match[1].trim() : "";
    }

    private clampSummary(text: string): string {
        const stripped = this.stripThinking(text);
        const words = stripped.split(/\s+/).filter(Boolean);
        const clamped: string[] = [];
        for (const word of words) {
            if (estimateTokens(clamped.join(" ") + word) > SUMMARY_MAX_TOKENS) break;
            clamped.push(word);
        }
        if (!clamped.length) return "";
        const summary = clamped.join(" ");
        return clamped.length < words.length ? `${summary}...` : summary;
    }

    private stripThinking(text: string): string {
        let out = text;
        while (out.includes("</think>")) out = out.slice(out.lastIndexOf("</think>") + 8);
        const open = out.indexOf("<think>");
        if (open !== -1) out = out.slice(0, open);
        return out.trim();
    }

    private hash(text: string): string {
        let hash = 5381;
        for (let i = 0; i < text.length; i++) {
            hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
        }
        return `${(hash >>> 0).toString(36)}-${text.length.toString(36)}`;
    }
}
