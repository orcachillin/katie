import { tool } from "@openrouter/agent"
import z from "zod"
import { TextChannel, Message } from "discord.js-selfbot-v13"
import { client } from "../deps.js"
import { channelManager } from "../ChannelManager.js"
import { contextManager } from "../ContextManager.js"
import { typoify } from "../util/typo.js"

export const disabled = true

export const send = tool({
    name: "send",
    description: "send a message to a channel.",
    inputSchema: z.object({
        channelId: z.string().describe("channel id to send to"),
        content: z.string().describe("message content"),
        replyTo: z.string().optional().describe("message id to reply to"),
        delayTime: z.number().optional().describe("time in milliseconds to wait before sending the message")
    }),
    outputSchema: z.string(),
    execute: async (params: Record<string, unknown>) => {
        const channelId = params.channelId as string
        const content = params.content as string
        const replyTo = params.replyTo as string | undefined
        const delayTime = params.delayTime as number || 0

        const sendAt = Date.now() + delayTime
        const startTypingDelay = delayTime - (content.split(" ").length * 750)
        const queuedAt = Date.now()

        const ctx = contextManager.get(channelId)

        ctx.messageQueue.push({
            ...{
                content,
                queuedAt,
                replyTo,
                sendAt
            },
            queuedAt: queuedAt
        })

        console.log(`waiting ${(delayTime / 1000).toFixed(1)} seconds...`)



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


        ctx.timeouts.push(setTimeout(async () => {
            await channel.sendTyping().catch(() => { })
        }, startTypingDelay))

        const sent = await new Promise<Message | undefined>((resolve, reject) => {
            ctx.timeouts.push(setTimeout(async () => {

                const indexToRemove = ctx.messageQueue.findIndex((m) => m.queuedAt == queuedAt)
                ctx.messageQueue.splice(indexToRemove, 1)

                const typoContent = Math.random() < 0.15 ? typoify(content) : null
                const sendContent = typoContent ?? content

                let sent: Message | undefined
                if (replyTo) {
                    try {
                        const replyMessage = await channel.messages.fetch(replyTo)
                        sent = await replyMessage.reply({ content: sendContent }).catch(() => undefined)
                    } catch {
                        sent = await channel.send({ content: sendContent }).catch(() => undefined)
                    }
                } else {
                    sent = await channel.send({ content: sendContent }).catch(() => undefined)
                }
                if (sent) {
                    contextManager.trackSentMessage(channelId, sent.id)
                    if (typoContent) {
                        const editDelay = 3000 + Math.random() * 5000
                        console.log(`typo in ${sent.id}, fixing in ${(editDelay / 1000).toFixed(1)}s`)
                        ctx.timeouts.push(setTimeout(async () => {
                            try {
                                await sent.edit({ content: content })
                            } catch {
                                reject()
                            }
                        }, editDelay))
                    }

                    resolve(sent)

                } else {
                    reject("failed to send message")
                }

            }, delayTime))
        })

        return `message sent! id: ${sent?.id}`

    }
})