import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { execAsync } from "../../../util/execAsync.js";
import type { Tool } from "../toolService.js";

function formatEntry(name: string, isDir: boolean, size: number): string {
    const type = isDir ? "d" : "-";
    const sizeStr = isDir ? "" : `${size}`.padStart(10);
    return `${type}  ${sizeStr}  ${name}`;
}

export const listdir = {
    type: "function",
    function: {
        name: "listdir",
        description: "list files and directories in a path. uses node:fs locally, or ls over SSH when host is set.",
        parameters: {
            type: "object",
            properties: {
                path: { type: "string", description: "absolute or relative path to the directory" },
                host: { type: "string", description: "SSH host to list from" },
                port: { type: "number", description: "SSH port (default 22)" },
            },
            required: ["path"],
        },
        execute: async (args) => {
            const dirpath = args.path as string;
            const host = args.host as string | undefined;
            const port = (args.port as number) ?? 22;

            if (host) {
                const cmd = `ssh -o ConnectTimeout=10 -p ${port} ${host} ls -la ${JSON.stringify(dirpath)}`;
                return await execAsync(cmd, 15_000);
            }
            try {
                const entries = readdirSync(dirpath);
                const lines = entries.map(name => {
                    const full = join(dirpath, name);
                    try {
                        const stat = statSync(full);
                        return formatEntry(name, stat.isDirectory(), stat.size);
                    } catch {
                        return formatEntry(name, false, 0);
                    }
                });
                return `${dirpath}:\n` + lines.join("\n");
            } catch (err: any) {
                return `error: ${err.message}`;
            }
        },
    },
} satisfies Tool;