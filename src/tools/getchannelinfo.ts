import { tool } from "@openrouter/sdk/lib/tool.js"
import z from "zod"
import { memoryManager } from "../MemoryManager.js"

export const getchannelinfo = tool({
    name: "getchannelinfo",
    description: "read structured info about a channel that was saved with writechannelinfo.",
    inputSchema: z.object({
        channelId: z.string().describe("the channel's id (just digits)"),
    }),
    outputSchema: z.string(),
    execute: async (params: Record<string, unknown>) => {
        const info = memoryManager.readChannelInfoFile(params.channelId as string)
        return info ?? `no saved info for channel ${params.channelId}`
    },
})