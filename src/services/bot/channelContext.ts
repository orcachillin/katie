import Core from "../../core.js";
import type { ChatMessage } from "../agent/agentService.js";

const MAX_CONTEXT = 50;

export default class ChannelContext {

    private channels: Record<string, ChatMessage[]> = {}

    get(channelId: string): ChatMessage[] {
        const context = this.channels[channelId]
        if (context) return context
        const empty: ChatMessage[] = []
        this.channels[channelId] = empty
        return empty
    }

    set(channelId: string, messages: ChatMessage[]): void {
        this.channels[channelId] = messages
    }

    append(channelId: string, ...messages: ChatMessage[]): void {
        const existing = this.get(channelId);
        existing.push(...messages);
        if (existing.length > MAX_CONTEXT) {
            this.channels[channelId] = existing.slice(-MAX_CONTEXT)
        }
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