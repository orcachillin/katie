import { tool } from "@openrouter/agent"
import z from "zod"
import { readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { execAsync } from "../util/execAsync.js"

function formatEntry(name: string, isDir: boolean, size: number): string {
    const type = isDir ? "d" : "-"
    const sizeStr = isDir ? "" : `${size}`.padStart(10)
    return `${type}  ${sizeStr}  ${name}`
}

export const listdir = tool({
    name: "listdir",
    description: "list files and directories in a path. uses node:fs locally, or ls over SSH when host is set.",
    inputSchema: z.object({
        path: z.string().describe("absolute or relative path to the directory"),
        host: z.string().optional().describe("SSH host to list from"),
        port: z.number().optional().describe("SSH port (default 22)").default(22),
    }),
    outputSchema: z.string(),
    execute: async (params: Record<string, unknown>) => {
        const dirpath = params.path as string
        const host = params.host as string | undefined
        const port = (params.port as number) ?? 22

        if (host) {
            const cmd = `ssh -o ConnectTimeout=10 -p ${port} ${host} ls -la ${JSON.stringify(dirpath)}`
            console.log(`ssh ${host}: ls ${dirpath}`)
            return await execAsync(cmd, 15_000)
        }

        try {
            const entries = readdirSync(dirpath)
            const lines = entries.map(name => {
                const full = join(dirpath, name)
                try {
                    const stat = statSync(full)
                    return formatEntry(name, stat.isDirectory(), stat.size)
                } catch {
                    return formatEntry(name, false, 0)
                }
            })
            return `${dirpath}:\n` + lines.join("\n")
        } catch (err: any) {
            return `error: ${err.message}`
        }
    },
})