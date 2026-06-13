import { tool } from "@openrouter/agent"
import z from "zod"
import { scheduledMessageManager } from "../ScheduledMessageManager.js"

export const schedule = tool({
    name: "schedule",
    description: "schedule a message to be sent in a channel at a future time",
    inputSchema: z.object({
        channelId: z.string().describe("channel id to send the message in"),
        content: z.string().describe("message content"),
        sendAt: z.number().describe("unix timestamp in milliseconds to send the message"),
        replyTo: z.string().optional().describe("message id to reply to"),
    }),
    outputSchema: z.string(),
    execute: async (params: Record<string, unknown>) => {
        const channelId = params.channelId as string
        const content = params.content as string
        const sendAt = params.sendAt as number
        const replyTo = params.replyTo as string | undefined

        if (sendAt <= Date.now()) {
            return "sendAt must be in the future"
        }

        const msg = scheduledMessageManager.schedule(channelId, content, sendAt, replyTo)
        return `scheduled message ${msg.id} for ${new Date(sendAt).toISOString()}`
    },
})