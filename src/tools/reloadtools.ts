import { tool } from "@openrouter/agent"
import z from "zod"
import { toolLoader } from "../ToolLoader.js"

export const reloadtools = tool({
    name: "reloadtools",
    description: "reload all tool modules from disk",
    inputSchema: z.object({}),
    outputSchema: z.string(),
    execute: async () => {
        await toolLoader.reload()
        return `reloaded ${toolLoader.tools.length} tools`
    },
})