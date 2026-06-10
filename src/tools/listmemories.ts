import { tool } from "@openrouter/sdk/lib/tool.js"
import z from "zod"
import { memoryManager, MemoryType } from "../MemoryManager.js"

export const listmemories = tool({
    name: "listmemories",
    description: "list all saved memories for a user or for yourself.",
    inputSchema: z.object({
        userId: z.string().describe("the user's id (just digits)").optional(),
        self: z.boolean().describe("set to true to list your own notes").optional(),
    }),
    outputSchema: z.string(),
    execute: async (params: Record<string, unknown>) => {
        if (params.self) {
            const names = memoryManager.listSelfMemories()
            if (names.length === 0) return "no memories saved about yourself"
            return names.join("\n")
        }

        const userId = params.userId as string
        if (!userId) return "need a userId or set self=true"
        const names = memoryManager.listUserMemories(userId)
        if (names.length === 0) return `no memories saved about user ${userId}`
        return names.join("\n")
    },
})