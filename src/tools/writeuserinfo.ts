import { tool } from "@openrouter/sdk/lib/tool.js"
import z from "zod"
import { memoryManager } from "../MemoryManager.js"

export const writeuserinfo = tool({
    name: "writeuserinfo",
    description: "save structured info about a user — username, display name, pronouns, preferred name, dm channel id, and extra notes.",
    inputSchema: z.object({
        userId: z.string().describe("the user's id (just digits)"),
        username: z.string().optional(),
        displayName: z.string().optional(),
        preferredName: z.string().optional(),
        pronouns: z.string().optional(),
        dmChannelId: z.string().optional(),
        details: z.string().optional(),
    }),
    outputSchema: z.string(),
    execute: async (params: Record<string, unknown>) => {
        memoryManager.writeUserInfoFile(params.userId as string, {
            username: (params.username as string) ?? "",
            displayName: (params.displayName as string) ?? "",
            preferredName: (params.preferredName as string) ?? "",
            pronouns: (params.pronouns as string) ?? "",
            dmChannelId: (params.dmChannelId as string) ?? "",
            details: (params.details as string) ?? "",
        })
        return `saved info for user ${params.userId}`
    },
})