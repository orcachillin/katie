import { tool } from "@openrouter/agent"
import z from "zod"
import { execAsync } from "../util/execAsync.js"

function buildRemoteCommand(host: string, port: number, command: string): string {
    return `ssh -o ConnectTimeout=10 -p ${port} ${host} ${JSON.stringify(command)}`
}

const DEFAULT_TIMEOUT = 30_000

export const bash = tool({
    name: "bash",
    description:
        "run a shell command. if host is provided, runs via SSH (key-based auth must be configured).",
    inputSchema: z.object({
        command: z.string().describe("command to run"),
        timeout: z
            .number()
            .optional()
            .describe("timeout in ms (default 30s, max 120s)")
            .default(DEFAULT_TIMEOUT),
        cwd: z
            .string()
            .optional()
            .describe("working directory (local, or remote if host is set)"),
        host: z
            .string()
            .optional()
            .describe("SSH host to run the command on (hostname/IP/~/.ssh/config alias)"),
        port: z
            .number()
            .optional()
            .describe("SSH port (default 22)")
            .default(22),
    }),
    outputSchema: z.string().describe("result"),
    execute: async (params: Record<string, unknown>) => {
        let command = params.command as string
        const timeout = Math.min(
            (params.timeout as number) ?? DEFAULT_TIMEOUT,
            120_000,
        )
        const cwd = params.cwd as string | undefined
        const host = params.host as string | undefined
        const port = (params.port as number) ?? 22

        if (cwd) {
            command = `cd ${JSON.stringify(cwd)} && ${command}`
        }

        if (host) {
            command = buildRemoteCommand(host, port, command)
            console.log(`ssh ${host}: ${command}`)
        }

        return await execAsync(command, timeout)
    },
})