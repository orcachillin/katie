import { tool } from "@openrouter/sdk/lib/tool.js"
import z from "zod"
import { client } from "../deps.js"

export const sendFriendRequest = tool({
    name: "sendfriendrequest",
    description: "send a friend request to a user",
    inputSchema: z.object({
        userId: z.string().describe("user id, just the digits"),
    }),
    outputSchema: z.any(),
    execute: async (params: Record<string, unknown>) => {
        const user = await client.users.fetch(params.userId as string)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const api = client.api as any
        await api.users("@me").relationships(user.id).put({
            data: {},
        })
        return `friend request sent to ${user.username}`
    },
})