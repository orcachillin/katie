import { tool } from "@openrouter/agent"
import z from "zod"
import { scheduledMessageManager } from "../ScheduledMessageManager.js"

export const editschedule = tool({
    name: "editschedule",
    description: "edit a scheduled message's content and/or send time",
    inputSchema: z.object({
        id: z.string().describe("scheduled message id"),
        content: z.string().optional().describe("new message content"),
        sendAt: z.number().optional().describe("new unix timestamp in milliseconds"),
    }),
    outputSchema: z.string(),
    execute: async (params: Record<string, unknown>) => {
        const id = params.id as string
        const content = params.content as string | undefined
        const sendAt = params.sendAt as number | undefined

        const msg = scheduledMessageManager.edit(id, content, sendAt)
        if (!msg) return `no scheduled message found with id ${id}`

        let reply = `updated ${id}`
        if (content !== undefined) reply += `, content changed`
        if (sendAt !== undefined) reply += `, now scheduled for ${new Date(sendAt).toISOString()}`
        return reply
    },
})