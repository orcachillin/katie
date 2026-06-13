import { tool } from "@openrouter/agent"
import z from "zod"
import { scheduledMessageManager } from "../ScheduledMessageManager.js"

export const unschedule = tool({
    name: "unschedule",
    description: "cancel/remove a scheduled message",
    inputSchema: z.object({
        id: z.string().describe("scheduled message id to cancel"),
    }),
    outputSchema: z.string(),
    execute: async (params: Record<string, unknown>) => {
        const id = params.id as string
        const ok = scheduledMessageManager.remove(id)
        return ok ? `cancelled ${id}` : `no scheduled message found with id ${id}`
    },
})