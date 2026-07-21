import { execAsync } from "../../../util/execAsync.js";
import type { Tool } from "../toolService.js";

const DEFAULT_TIMEOUT = 30_000;

function buildRemoteCommand(host: string, port: number, command: string): string {
    return `ssh -o ConnectTimeout=10 -p ${port} ${host} ${JSON.stringify(command)}`;
}

export const bash = {
    type: "function",
    function: {
        name: "bash",
        description: "run a shell command. if host is provided, runs via SSH (key-based auth must be configured).",
        parameters: {
            type: "object",
            properties: {
                command: { type: "string", description: "command to run" },
                timeout: { type: "number", description: "timeout in ms (default 30s, max 120s)" },
                cwd: { type: "string", description: "working directory (local, or remote if host is set)" },
                host: { type: "string", description: "SSH host to run the command on (hostname/IP/~/.ssh/config alias)" },
                port: { type: "number", description: "SSH port (default 22)" },
            },
            required: ["command"],
        },
        execute: async (args) => {
            let command = args.command as string;
            const timeout = Math.min((args.timeout as number) ?? DEFAULT_TIMEOUT, 120_000);
            const cwd = args.cwd as string | undefined;
            const host = args.host as string | undefined;
            const port = (args.port as number) ?? 22;

            if (cwd) {
                command = `cd ${JSON.stringify(cwd)} && ${command}`;
            }
            if (host) {
                command = buildRemoteCommand(host, port, command);
            }
            return await execAsync(command, timeout);
        },
    },
} satisfies Tool;