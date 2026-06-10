import { tool } from "@openrouter/sdk/lib/tool.js"
import z from "zod"
import { memoryManager, MemoryType } from "../MemoryManager.js"

export const forget = tool({
    name: "forget",
    description: "delete a memory about a user or about yourself.",
    inputSchema: z.object({
        userId: z.string().describe("the user's id (just digits)").optional(),
        name: z.string().describe("name of the memory to delete"),
        self: z.boolean().describe("set to true to delete one of your own notes").optional(),
    }),
    outputSchema: z.string(),
    execute: async (params: Record<string, unknown>) => {
        const name = params.name as string

        if (params.self) {
            const existed = memoryManager.readMemoryFile(MemoryType.Self, name)
            if (!existed) return `no memory named "${name}" about yourself`
            memoryManager.writeMemoryFile(MemoryType.Self, name, "")
            return `forgot "${name}"`
        }

        const userId = params.userId as string
        if (!userId) return "need a userId or set self=true"
        const existed = memoryManager.readMemoryFile(MemoryType.User, userId, name)
        if (!existed) return `no memory named "${name}" about user ${userId}`
        memoryManager.writeMemoryFile(MemoryType.User, userId, name, "")
        return `forgot "${name}" about user ${userId}`
    },
})