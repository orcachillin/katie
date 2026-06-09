import { readdirSync, statSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

interface ToolShape {
    type: string
    function: Record<string, unknown>
}

class ToolLoader {
    private _tools: ToolShape[] = []

    get tools(): ToolShape[] {
        return this._tools
    }

    async loadAll() {
        const toolsDir = resolve(__dirname, "tools")
        if (!statSync(toolsDir, { throwIfNoEntry: false })) {
            console.log("tools directory not found at", toolsDir)
            return
        }

        const files = readdirSync(toolsDir).filter((f) => f.endsWith(".js"))
        for (const file of files) {
            try {
                const mod = await import(`./tools/${file}`) as Record<string, unknown>
                for (const [key, val] of Object.entries(mod)) {
                    if (
                        val &&
                        typeof val === "object" &&
                        "type" in (val as object) &&
                        "function" in (val as object)
                    ) {
                        this._tools.push(val as ToolShape)
                        console.log(`loaded tool: ${key}`)
                    }
                }
            } catch (err) {
                console.error(`failed to load tool ${file}:`, err)
            }
        }

        console.log(`loaded ${this._tools.length} tools total`)
    }
}

export const toolLoader = new ToolLoader()