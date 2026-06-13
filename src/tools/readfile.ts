import { tool } from "@openrouter/agent"
import z from "zod"
import { readFileSync } from "node:fs"
import { execAsync } from "../util/execAsync.js"

export const readfile = tool({
    name: "readfile",
    description: "read the contents of a file. uses node:fs locally, or cat over SSH when host is set.",
    inputSchema: z.object({
        path: z.string().describe("absolute or relative path to the file"),
        host: z.string().optional().describe("SSH host to read from"),
        port: z.number().optional().describe("SSH port (default 22)").default(22),
    }),
    outputSchema: z.string(),
    execute: async (params: Record<string, unknown>) => {
        const filepath = params.path as string
        const host = params.host as string | undefined
        const port = (params.port as number) ?? 22

        if (host) {
            const cmd = `ssh -o ConnectTimeout=10 -p ${port} ${host} cat ${JSON.stringify(filepath)}`
            console.log(`ssh ${host}: cat ${filepath}`)
            return await execAsync(cmd, 15_000)
        }

        try {
            return readFileSync(filepath, "utf-8")
        } catch (err: any) {
            return `error: ${err.message}`
        }
    },
})