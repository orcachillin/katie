import { tool } from "@openrouter/sdk/lib/tool.js";
import z from "zod";

export const keysmash = tool({
    name: "keysmash",
    description: "generate keysmash",
    inputSchema: z.object({
        length: z.number().int().describe("length of keysmash")
    }),
    outputSchema: z.object({
        response: z.string()
    }),
    execute: async (params: Record<string, unknown>) => {
        const chars = "asdfghjklzxnmbuyw"

        let response = ''

        for (let i = 0; i < (params.length as number); i++) {
            response = response + chars[Math.floor(Math.random() * chars.length)]
        }

        return {
            response
        }
    }

})

