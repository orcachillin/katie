import { tool } from "@openrouter/sdk/lib/tool.js"
import z from "zod"
import { memoryManager } from "../MemoryManager.js"

export const writechannelinfo = tool({
    name: "writechannelinfo",
    description: "save structured info about a channel — topic, guild/server name, and extra notes.",
    inputSchema: z.object({
        channelId: z.string().describe("the channel's id (just digits)"),
        topic: z.string().optional(),
        guildName: z.string().optional(),
        details: z.string().optional(),
    }),
    outputSchema: z.string(),
    execute: async (params: Record<string, unknown>) => {
        memoryManager.writeChannelInfoFile(params.channelId as string, {
            topic: (params.topic as string) ?? "",
            guildName: (params.guildName as string) ?? "",
            details: (params.details as string) ?? "",
        })
        return `saved info for channel ${params.channelId}`
    },
})