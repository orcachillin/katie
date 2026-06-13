import { tool } from "@openrouter/sdk/lib/tool.js"
import z from "zod"
import { channelManager } from "../ChannelManager.js"
import { client } from "../deps.js"

export const listChannels = tool({
    name: "listchannels",
    description: "list all channels that you know about",
    inputSchema: z.object({}),
    outputSchema: z.any(),
    execute: async () => {
        return channelManager.channels
    },
})