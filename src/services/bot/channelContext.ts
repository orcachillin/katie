import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import type { ChatMessage } from "../agent/agentService.js";
import { resolve } from "node:path";

const MAX_CONTEXT = 50;
const CONTEXT_ROOT = resolve("./workspace/contexts");

export default class ChannelContext {

    private channels: Record<string, ChatMessage[]> = {}

    constructor() {
        mkdirSync(CONTEXT_ROOT, { recursive: true });
        for (const file of readdirSync(CONTEXT_ROOT).filter(file => file.endsWith(".json"))) {
            try {
                const messages = JSON.parse(readFileSync(resolve(CONTEXT_ROOT, file), "utf-8"));
                if (Array.isArray(messages)) {
                    this.channels[file.slice(0, -5)] = messages.slice(-MAX_CONTEXT);
                }
            } catch { }
        }
    }

    get(channelId: string): ChatMessage[] {
        const context = this.channels[channelId]
        if (context) return context
        const empty: ChatMessage[] = []
        this.channels[channelId] = empty
        return empty
    }

    set(channelId: string, messages: ChatMessage[]): void {
        this.channels[channelId] = messages
        this.save(channelId)

    }

    append(channelId: string, ...messages: ChatMessage[]): void {
        const existing = this.get(channelId);
        existing.push(...messages);
        if (existing.length > MAX_CONTEXT) {
            this.channels[channelId] = existing.slice(-MAX_CONTEXT)
        }
        this.save(channelId)
    }

    prepend(channelId: string, ...messages: ChatMessage[]): void {
        const existing = this.get(channelId);
        existing.unshift(...messages);
        if (existing.length > MAX_CONTEXT) {
            this.channels[channelId] = existing.slice(-MAX_CONTEXT);
        }
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

    save(channelId: string) {
        writeFileSync(resolve(CONTEXT_ROOT, `${channelId}.json`), JSON.stringify(this.channels[channelId], null, 2))
    }

    clear(channelId: string): void {
        delete this.channels[channelId]
    }

    has(channelId: string): boolean {
        return !!this.channels[channelId]
    }

    all(): Record<string, ChatMessage[]> {
        return this.channels;
    }
}
