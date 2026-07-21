import { readFileSync } from "node:fs";
import { execAsync } from "../../../util/execAsync.js";
import type { Tool } from "../toolService.js";

export const readfile = {
    type: "function",
    function: {
        name: "readfile",
        description: "read the contents of a file. uses node:fs locally, or cat over SSH when host is set.",
        parameters: {
            type: "object",
            properties: {
                path: { type: "string", description: "absolute or relative path to the file" },
                host: { type: "string", description: "SSH host to read from" },
                port: { type: "number", description: "SSH port (default 22)" },
            },
            required: ["path"],
        },
        execute: async (args) => {
            const filepath = args.path as string;
            const host = args.host as string | undefined;
            const port = (args.port as number) ?? 22;

            if (host) {
                const cmd = `ssh -o ConnectTimeout=10 -p ${port} ${host} cat ${JSON.stringify(filepath)}`;
                return await execAsync(cmd, 15_000);
            }
            try {
                return readFileSync(filepath, "utf-8");
            } catch (err: any) {
                return `error: ${err.message}`;
            }
        },
    },
} satisfies Tool;