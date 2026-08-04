import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import AbstractService from "../../base/abstractService.js";

const PROMPT_DIR = resolve("./prompts");

export default class PromptService extends AbstractService<"prompt"> {

    private prompts = new Map<string, string>();

    constructor() {
        super("prompt");
    }

    public async init(): Promise<void> {
        const files = (await readdir(PROMPT_DIR, { withFileTypes: true }))
            .filter(file => file.isFile() && file.name.endsWith(".md"))
            .sort((a, b) => a.name.localeCompare(b.name));
        const prompts = new Map<string, string>();

        for (const file of files) {
            const name = file.name.slice(0, -3);
            prompts.set(name, (await readFile(resolve(PROMPT_DIR, file.name), "utf-8")).trim());
        }

        this.prompts = prompts;
        this.logger.log(`Loaded ${prompts.size} prompts`);
    }

    public get(name: string): string {
        const prompt = this.prompts.get(name);
        if (prompt === undefined) throw new Error(`Prompt not found: ${name}`);
        return prompt;
    }

    public render(name: string, values: Record<string, string>): string {
        return this.get(name).replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
            if (!(key in values)) throw new Error(`Missing value "${key}" for prompt: ${name}`);
            return values[key];
        });
    }
}
