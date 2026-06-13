import { tool } from "@openrouter/sdk/lib/tool.js"
import z from "zod"
import { client } from "../deps.js"

export const fetchUser = tool({
    name: "fetchuser",
    description: "get info on a user",
    inputSchema: z.object({
        userId: z.string().describe("user id, just the digits"),
    }),
    outputSchema: z.any(),
    execute: async (params: Record<string, unknown>) => {
        const user = await client.users.fetch(params.userId as string)
        const profile = await user.getProfile()

        return profile
    },
})