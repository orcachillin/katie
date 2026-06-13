import { tool } from "@openrouter/agent"
import z from "zod"
import { TextChannel, Message } from "discord.js-selfbot-v13"
import { client } from "../deps.js"
import { channelManager } from "../ChannelManager.js"
import { contextManager } from "../ContextManager.js"

export const send = tool({
    name: "send",
    description: "send a message to a channel immediately. useful for sending intermediate updates, asking questions, or posting results between other tool calls.",
    inputSchema: z.object({
        channelId: z.string().describe("channel id to send to"),
        content: z.string().describe("message content"),
        replyTo: z.string().optional().describe("message id to reply to"),
    }),
    outputSchema: z.string(),
    execute: async (params: Record<string, unknown>) => {
        const channelId = params.channelId as string
        const content = params.content as string
        const replyTo = params.replyTo as string | undefined

        let channel = channelManager.get(channelId)
        if (!channel) {
            const fetched = await client.channels.fetch(channelId)
            if (fetched && fetched.isText()) {
                channel = fetched as TextChannel
                channelManager.add(channelId, channel)
            } else {
                return `error: could not find channel ${channelId}`
            }
        }

        let sent: Message<boolean> | undefined
        if (replyTo) {
            try {
                const replyMessage = await channel.messages.fetch(replyTo)
                sent = await replyMessage.reply({ content }).catch(() => undefined)
            } catch {
                sent = await channel.send({ content }).catch(() => undefined)
            }
        } else {
            sent = await channel.send({ content }).catch(() => undefined)
        }

        if (sent) {
            contextManager.trackSentMessage(channelId, sent.id)
        }

        return `sent message to ${channelId}`
    },
})