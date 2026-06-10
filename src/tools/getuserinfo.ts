import { tool } from "@openrouter/sdk/lib/tool.js"
import z from "zod"
import { memoryManager } from "../MemoryManager.js"

export const getuserinfo = tool({
    name: "getuserinfo",
    description: "read structured info about a user that was saved with writeuserinfo.",
    inputSchema: z.object({
        userId: z.string().describe("the user's id (just digits)"),
    }),
    outputSchema: z.string(),
    execute: async (params: Record<string, unknown>) => {
        const info = memoryManager.readUserInfoFile(params.userId as string)
        return info ?? `no saved info for user ${params.userId}`
    },
})