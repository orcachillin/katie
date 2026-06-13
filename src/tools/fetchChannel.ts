import { tool } from "@openrouter/sdk/lib/tool.js"
import z from "zod"
import { client } from "../deps.js"
import { channelManager } from "../ChannelManager.js"
import { TextChannel } from "discord.js-selfbot-v13"

export const fetchChannel = tool({
    name: "fetchchannel",
    description: "get info on a channel",
    inputSchema: z.object({
        channelId: z.string().describe("channel id, just the digits"),
    }),
    outputSchema: z.any(),
    execute: async (params: Record<string, unknown>) => {
        const channel = await client.channels.fetch(params.channelId as string)

        if (channel && channel.isText()) {
            channelManager.add(channel.id, channel as TextChannel)
        }

        return channel
    },
})