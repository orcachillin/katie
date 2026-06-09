import { tool } from "@openrouter/sdk/lib/tool.js"
import z from "zod"
import * as cheerio from "cheerio"

export const webSearch = tool({
    name: "websearch",
    description: "search the internet for information using duckduckgo",
    inputSchema: z.object({
        query: z.string().describe("search query"),
    }),
    outputSchema: z.array(
        z.object({
            title: z.string(),
            url: z.string(),
            snippet: z.string(),
        }),
    ),
    execute: async (params: Record<string, unknown>) => {
        const query = encodeURIComponent(params.query as string)
        const res = await fetch(`https://html.duckduckgo.com/html/?q=${query}`)
        const html = await res.text()
        const $ = cheerio.load(html)

        const results: { title: string; url: string; snippet: string }[] = []

        $(".result").each((_, el) => {
            const title = $(el).find(".result__title").text().trim()
            const url = $(el).find(".result__url").attr("href") ?? ""
            const snippet = $(el).find(".result__snippet").text().trim()
            if (title || url) {
                results.push({ title, url, snippet })
            }
        })

        return results.slice(0, 10)
    },
})