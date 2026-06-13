import { tool } from "@openrouter/agent"
import z from "zod"
import { scheduledMessageManager } from "../ScheduledMessageManager.js"

export const listschedules = tool({
    name: "listschedules",
    description: "list all pending scheduled messages, optionally filtered by channel",
    inputSchema: z.object({
        channelId: z.string().optional().describe("only show schedules for this channel"),
    }),
    outputSchema: z.string(),
    execute: async (params: Record<string, unknown>) => {
        const channelId = params.channelId as string | undefined
        let schedules = scheduledMessageManager.all
        if (channelId) {
            schedules = schedules.filter(m => m.channelId === channelId)
        }

        if (schedules.length === 0) {
            return "no pending scheduled messages"
        }

        const lines = schedules.map(m => {
            const time = new Date(m.sendAt).toISOString()
            const remaining = Math.round((m.sendAt - Date.now()) / 1000)
            return `[${m.id}] channel ${m.channelId} in ${remaining}s (${time}): ${m.content.slice(0, 200)}`
        })
        return lines.join("\n")
    },
})