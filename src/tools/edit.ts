import { tool } from "@openrouter/agent"
import z from "zod"
import { TextChannel } from "discord.js-selfbot-v13"
import { client } from "../deps.js"
import { contextManager } from "../ContextManager.js"

export const edit = tool({
    name: "edit",
    description: "edit a message the bot has previously sent. pass the message id and new content.",
    inputSchema: z.object({
        channelId: z.string().describe("channel the message is in"),
        messageId: z.string().describe("id of the message to edit"),
        content: z.string().describe("new message content"),
    }),
    outputSchema: z.string(),
    execute: async (params: Record<string, unknown>) => {
        const channelId = params.channelId as string
        const messageId = params.messageId as string
        const content = params.content as string

        const channel = await client.channels.fetch(channelId) as TextChannel
        if (!channel) return `error: could not find channel ${channelId}`

        const message = await channel.messages.fetch(messageId)
        if (!message) return `error: could not find message ${messageId}`

        await message.edit({ content })
        return `edited message ${messageId}`
    },
})