import AbstractService from "../../base/abstractService.js";
import { readdirSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { ToolDefinition } from "../agent/agentService.js";

export interface ToolContext {
    channelId: string;
    userId: string;
    username: string;
    messageId: string;
}

export interface Tool {
    type: "function";
    function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
        execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<string>;
    };
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default class ToolService extends AbstractService<"tool"> {

    private _tools: Tool[] = [];
    private _loaded = false;

    constructor() {
        super("tool");
    }

    public async init(): Promise<void> {
        await this.loadAll();
    }

    public async destroy(): Promise<void> { }

    get definitions(): ToolDefinition[] {
        return this._tools.map(t => ({
            type: "function",
            function: {
                name: t.function.name,
                description: t.function.description,
                parameters: t.function.parameters,
            },
        }));
    }

    async execute(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
        const tool = this._tools.find(t => t.function.name === name);
        if (!tool) return `unknown tool "${name}"`;

        const start = Date.now();
        this.logger.log(`tool call: ${name}`, args);
        try {
            const result = await tool.function.execute(args, ctx);
            this.logger.log(`tool done: ${name} (${Date.now() - start}ms)`);
            return result;
        } catch (err: any) {
            this.logger.log(`tool error: ${name} (${Date.now() - start}ms): ${err.message}`);
            return `tool error: ${err.message}`;
        }
    }

    private async loadAll(): Promise<void> {
        const toolsDir = resolve(__dirname, "tools");
        if (!statSync(toolsDir, { throwIfNoEntry: false })) {
            this.logger.warn(`Tools directory not found at ${toolsDir}`);
            return;
        }

        const files = readdirSync(toolsDir).filter(f => f.endsWith(".js") || f.endsWith(".ts"));
        for (const file of files) {
            try {
                const mod = await import(`./tools/${file}`);
                for (const [key, val] of Object.entries(mod)) {
                    if (val && typeof val === "object" && "type" in val && "function" in val) {
                        this._tools.push(val as Tool);
                        this.logger.log(`loaded tool: ${key}`);
                    }
                }
            } catch (err) {
                this.logger.error(`failed to load tool ${file}:`, err);
            }
        }

        this._loaded = true;
        this.logger.log(`loaded ${this._tools.length} tools total`);
    }
}