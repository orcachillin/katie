import { appendToMessages, createInitialState } from "@openrouter/agent"
import type { StateAccessor, ConversationState } from "@openrouter/agent"
import { TextChannel } from "discord.js-selfbot-v13"
import { client } from "./deps.js"
import { memoryManager } from "./MemoryManager.js"
import { scheduledMessageManager } from "./ScheduledMessageManager.js"

const RECENT_MESSAGE_LIMIT = 15

class StateManager {
    private _states = new Map<string, ConversationState>()

    getStateAccessor(key: string): StateAccessor {
        return {
            load: async () => this._states.get(key) ?? this.initial(key),
            save: async (s) => { this._states.set(key, s) },
        }
    }

    async initial(key: string) {
        const state = createInitialState(key)
        const channel = await client.channels.fetch(key) as TextChannel


        let context = [
            `id: ${channel.id}`,
            `name: ${channel.name}`,
            `type: ${channel.type}`,
            memoryManager.getChannelContext(key)
        ].join("\n")

        // fetch recent discord messages for context
        try {
            if (channel?.isText()) {
                const messages = await channel.messages.fetch({ limit: RECENT_MESSAGE_LIMIT })
                const formatted = messages.reverse().map(m =>
                    `[${new Date(m.createdTimestamp).toDateString()} ${new Date(m.createdTimestamp).toTimeString()}][${m.author.displayName}]: ${m.content}`
                ).join("\n")
                if (formatted) {
                    context += `\n\nrecent messages in this channel:\n${formatted}`
                }
            }
        } catch {
            console.log(`couldn't fetch recent messages for channel ${key}`)
        }

        const channelSchedules = scheduledMessageManager.all.filter(m => m.channelId === key)
        if (channelSchedules.length > 0) {
            const scheduleSummary = channelSchedules.map(m =>
                `  - [${m.id}] at ${new Date(m.sendAt).toISOString()}: "${m.content.slice(0, 100)}"`
            ).join("\n")
            context += `\n\npending scheduled messages for this channel:\n${scheduleSummary}`
        }

        state.messages = appendToMessages(state.messages, [{
            role: "assistant" as const,
            content: context,
        }])

        return state
    }


    get(key: string): ConversationState | undefined {
        return this._states.get(key)
    }

    set(key: string, state: ConversationState) {
        this._states.set(key, state)
    }
}

export const stateManager = new StateManager()