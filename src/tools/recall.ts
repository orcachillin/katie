import { tool } from "@openrouter/sdk/lib/tool.js"
import z from "zod"
import { memoryManager, MemoryType } from "../MemoryManager.js"

export const recall = tool({
    name: "recall",
    description: "read a memory about a user or about yourself.",
    inputSchema: z.object({
        userId: z.string().describe("the user's id (just digits)").optional(),
        name: z.string().describe("name of the memory to read"),
        self: z.boolean().describe("set to true to read one of your own notes").optional(),
    }),
    outputSchema: z.string(),
    execute: async (params: Record<string, unknown>) => {
        const name = params.name as string

        if (params.self) {
            const content = memoryManager.readMemoryFile(MemoryType.Self, name)
            return content ?? `no memory named "${name}" about yourself`
        }

        const userId = params.userId as string
        if (!userId) return "need a userId or set self=true"
        const content = memoryManager.readMemoryFile(MemoryType.User, userId, name)
        return content ?? `no memory named "${name}" about user ${userId}`
    },
})