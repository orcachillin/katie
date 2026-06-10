import { tool } from "@openrouter/sdk/lib/tool.js"
import z from "zod"
import { memoryManager, MemoryType } from "../MemoryManager.js"

export const memorize = tool({
    name: "memorize",
    description: "save a note about a user or for yourself. use this for facts, preferences, promises, anything you want to remember.",
    inputSchema: z.object({
        userId: z.string().describe("the user's id (just digits)").optional(),
        name: z.string().describe("a short name for this memory, like 'pronouns' or 'favorite_color'"),
        content: z.string().describe("what to remember"),
        self: z.boolean().describe("set to true to save it as your own note instead of about a user").optional(),
    }),
    outputSchema: z.string(),
    execute: async (params: Record<string, unknown>) => {
        const name = params.name as string
        const content = params.content as string

        if (params.self) {
            memoryManager.writeMemoryFile(MemoryType.Self, name, content)
            return `memorized "${name}" about yourself`
        }

        const userId = params.userId as string
        if (!userId) return "need a userId or set self=true"
        memoryManager.writeMemoryFile(MemoryType.User, userId, name, content)
        return `memorized "${name}" about user ${userId}`
    },
})