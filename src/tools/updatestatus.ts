import { tool } from "@openrouter/agent"
import z from "zod"
import type { CustomStatusOption } from "discord.js-selfbot-v13"
import { client } from "../deps.js"

export const updatestatus = tool({
    name: "updatestatus",
    description: "update your discord presence status (online, idle, dnd, invisible) and optionally set a custom status text/emoji",
    inputSchema: z.object({
        status: z.enum(["online", "idle", "dnd", "invisible"]).optional().describe("online status"),
        customStatus: z.string().optional().describe("custom status text to display"),
        emoji: z.string().optional().describe("emoji for the custom status (:emoji_name: or unicode)"),
    }),
    outputSchema: z.string(),
    execute: async (params: Record<string, unknown>) => {
        const status = params.status as string | undefined
        const customStatus = params.customStatus as string | undefined
        const emoji = params.emoji as string | undefined

        if (status) {
            client.user?.setStatus(status)
        }

        if (customStatus || emoji) {
            const opts: CustomStatusOption = {}
            if (customStatus) opts.text = customStatus
            if (emoji) opts.emoji = emoji as any
            await client.user?.setCustomStatus(opts).catch(() => {})
        } else if (!status) {
            return "provide at least one of: status, customStatus"
        }

        return `status updated${status ? ` to ${status}` : ""}${customStatus ? `, custom: ${customStatus}` : ""}`
    },
})