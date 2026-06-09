import { tool } from "@openrouter/sdk/lib/tool.js"
import { createInitialState, appendToMessages } from "@openrouter/agent"
import z from "zod"
import { stateManager } from "../StateManager.js"
import type { ConversationState } from "@openrouter/agent"

export const pushToState = tool({
    name: "pushtostate",
    description: "push a message into another channel's conversation state so it has context. the message shows up as if the user said it.",
    inputSchema: z.object({
        channelId: z.string().describe("channel id, just the digits"),
        content: z.string().describe("message content to inject into the channel's state"),
    }),
    outputSchema: z.string(),
    execute: async (params: Record<string, unknown>) => {
        const channelId = params.channelId as string
        const content = params.content as string

        let state = stateManager.get(channelId)
        if (state) {
            state.messages = appendToMessages(state.messages, [{
                role: "user" as const,
                content,
            }])
        } else {
            state = createInitialState(channelId) as ConversationState
            state.messages = [{ role: "user" as const, content }]
        }
        stateManager.set(channelId, state)

        return `pushed message into state for channel ${channelId}`
    },
})