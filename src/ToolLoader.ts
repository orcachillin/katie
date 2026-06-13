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
                        const tool = val as ToolShape
                        const origExecute = tool.function.execute as
                            ((params: Record<string, unknown>) => Promise<unknown>) | undefined
                        if (origExecute) {
                            const name = (tool.function.name as string) ?? key
                            tool.function.execute = async (params: Record<string, unknown>) => {
                                const start = Date.now()
                                console.log(`tool call: ${name}`, params)
                                try {
                                    const result = await origExecute(params)
                                    console.log(`tool done: ${name} (${Date.now() - start}ms)`)
                                    return result
                                } catch (err) {
                                    console.log(`tool error: ${name} (${Date.now() - start}ms): ${err}`)
                                    throw err
                                }
                            }
                        }
                        this._tools.push(tool)
                        console.log(`loaded tool: ${key}`)
                    }
                }
            } catch (err) {
                console.error(`failed to load tool ${file}:`, err)
            }
        }

        console.log(`loaded ${this._tools.length} tools total`)
    }

    async reload() {
        this._tools = []
        console.log("reloading tools...")
        await this.loadAll()
    }
}

export const toolLoader = new ToolLoader()