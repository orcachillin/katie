import { tool } from "@openrouter/sdk/lib/tool.js"
import { normalizeInputToArray } from "@openrouter/agent"
import z from "zod"
import { stateManager } from "../StateManager.js"

/** estimate how many words the context is using (closer to token count) */
function estimateContextWords(messages: unknown[]): number {
    let total = 0
    for (const m of messages) {
        total += JSON.stringify(m).split(/\s+/).length
    }
    return total
}

const COMPACT_THRESHOLD = 50000

export const contextsize = tool({
    name: "contextsize",
    description:
        "check how much context the current conversation is using. " +
        "use this to decide if you should run compact.",
    inputSchema: z.object({
        channelId: z.string().describe("channel id to check, just the digits"),
    }),
    outputSchema: z.string(),
    execute: async (params: Record<string, unknown>) => {
        const channelId = params.channelId as string
        const state = stateManager.get(channelId)

        if (!state) {
            return "no state found for this channel"
        }

        const messages = normalizeInputToArray(state.messages)
        const words = estimateContextWords(messages)
        const pct = Math.round((words / COMPACT_THRESHOLD) * 100)

        return (
            `${messages.length} messages, ${words} words total ` +
            `(${pct}% of ${COMPACT_THRESHOLD} word compaction threshold). ` +
            (pct >= 80 ? "getting long, consider running compact." : "still plenty of room.")
        )
    },
})