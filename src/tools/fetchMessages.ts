import { tool } from "@openrouter/sdk/lib/tool.js"
import z from "zod"
import { client } from "../deps.js"
import { TextChannel } from "discord.js-selfbot-v13"

export const fetchMessages = tool({
    name: "fetchmessages",
    description: "get messages in the channel",
    inputSchema: z.object({
        channelId: z.string().describe("channel id, just the digits"),
        before: z.string().optional().describe("message id to get messages before"),
        after: z.string().optional().describe("message id to get messages after"),
        around: z.string().optional().describe("message id to get messages around"),
        limit: z.number().int().optional().describe("number of messages to fetch"),
    }),
    outputSchema: z.array(
        z.object({
            id: z.string(),
            authorId: z.string(),
            content: z.string(),
            timestamp: z.number(),
        }),
    ),
    execute: async (params: Record<string, unknown>) => {
        console.log(`fetchmessages`, params)

        const messages = await (
            client.channels.cache.get(params.channelId as string) as TextChannel
        ).messages.fetch({
            before: params.before as string | undefined,
            after: params.after as string | undefined,
            around: params.around as string | undefined,
            limit: params.limit as number | undefined,
        })

        return messages.map((message) => ({
            id: message.id,
            authorId: message.author.id,
            content: message.content,
            timestamp: message.createdAt.getTime(),
        }))
    },
})