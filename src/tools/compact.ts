import { tool } from "@openrouter/sdk/lib/tool.js"
import { normalizeInputToArray } from "@openrouter/agent"
import z from "zod"
import { stateManager } from "../StateManager.js"
import { openRouter } from "../deps.js"

/** estimate how many words the context is using (closer to token count) */
function estimateContextWords(messages: unknown[]): number {
    let total = 0
    for (const m of messages) {
        total += JSON.stringify(m).split(/\s+/).length
    }
    return total
}

/** flatten a message's content to plain text */
function flattenContent(content: unknown): string {
    if (typeof content === "string") return content
    if (Array.isArray(content)) {
        return content
            .map((block: Record<string, unknown>) => {
                if (block.type === "output_text" || block.type === "input_text") {
                    return (block.text as string) ?? ""
                }
                return JSON.stringify(block)
            })
            .join(" ")
    }
    return JSON.stringify(content)
}

/** format full message history for the summarizer */
function formatMessages(messages: unknown[]): string {
    return messages
        .map((m) => {
            if (typeof m !== "object" || m === null) return JSON.stringify(m)
            const msg = m as Record<string, unknown>
            const role = (msg.role as string) ?? "unknown"
            const content = flattenContent(msg.content)
            return `${role}: ${content}`
        })
        .join("\n")
}

// threshold in words — ~80% of ~60k words for a 1M-token model
const COMPACT_THRESHOLD = 50000

export const compact = tool({
    name: "compact",
    description:
        "compress conversation history into a short summary to save context. " +
        "call this when messages are getting long or you feel like youre losing track.",
    inputSchema: z.object({
        channelId: z.string().describe("channel id to compact, just the digits"),
    }),
    outputSchema: z.string(),
    execute: async (params: Record<string, unknown>) => {
        const channelId = params.channelId as string
        const state = stateManager.get(channelId)

        if (!state) {
            return "no state found for this channel"
        }

        const messages = normalizeInputToArray(state.messages)
        if (messages.length === 0) {
            return "no messages to compact"
        }

        const words = estimateContextWords(messages)

        if (words < COMPACT_THRESHOLD) {
            return (
                `context is ${words} words (under ${COMPACT_THRESHOLD} threshold), ` +
                `no compaction needed yet`
            )
        }

        const formatted = formatMessages(messages)

        console.log(
            `compacting ${messages.length} messages (${words} words) for channel ${channelId}`,
        )

        const result = openRouter.callModel({
            model: "minimax/minimax-m3",
            instructions:
                "you are a conversation condensor. distill the conversation below into " +
                "a tight summary. preserve: who the people are, key facts shared, decisions " +
                "made, inside jokes, ongoing tasks, emotional beats. " +
                "respond with ONLY the summary, under 600 words.",
            input: [{ role: "user" as const, content: formatted }],
        })

        const summary = await result.getText()
        const cleaned = summary.replaceAll(/```(\w+)?/g, "").trim()

        // keep the summary as a system message + last 2 messages for immediate flow
        const keepCount = Math.min(2, messages.length)
        const recent = messages.slice(-keepCount)

        const compacted = [
            {
                role: "system" as const,
                content: `[compacted conversation summary]: ${cleaned}`,
            },
            ...recent,
        ]

        state.messages = compacted
        stateManager.set(channelId, state)

        return (
            `compacted ${messages.length} messages (${words} words → ` +
            `${estimateContextWords(compacted)} words). `
        )
    },
})