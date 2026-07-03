import { tool } from "@openrouter/sdk/lib/tool.js"
import z from "zod"
import * as cheerio from "cheerio"

export const webfetch = tool({
    name: "webfetch",
    description: "fetch a webpage and return its text content",
    inputSchema: z.object({
        url: z.string().describe("URL of the webpage to download"),
    }),
    outputSchema: z.string(),
    execute: async (params: Record<string, unknown>) => {
        const url = params.url as string
        const res = await fetch(url)
        const html = await res.text()
        const $ = cheerio.load(html)

        $("script, style, noscript, svg, img, video, audio, iframe").remove()

        const text = $("body").text().replace(/\s+/g, " ").trim()

        return text.substring(0, 10000)
    },
})