import { readFileSync, readdirSync } from "node:fs"
import { resolve } from "node:path"

const WORKSPACE_DIR = resolve("./workspace")

class PromptManager {
    private _prompts: Record<string, string> = {}

    loadAll() {
        const files = readdirSync(WORKSPACE_DIR).filter((f) => f.endsWith(".md"))
        for (const file of files) {
            const name = file.replace(/\.md$/, "")
            this._prompts[name] = readFileSync(resolve(WORKSPACE_DIR, file), "utf-8")
            console.log(`loaded prompt: ${name}`)
        }
    }

    get(name: string): string | undefined {
        return this._prompts[name]
    }

    get all(): Record<string, string> {
        return this._prompts
    }
}

export const promptManager = new PromptManager()