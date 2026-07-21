import * as cheerio from "cheerio";
import type { Tool } from "../toolService.js";

export const webSearch = {
    type: "function",
    function: {
        name: "websearch",
        description: "search the internet for information using duckduckgo",
        parameters: {
            type: "object",
            properties: {
                query: { type: "string", description: "search query" },
            },
            required: ["query"],
        },
        execute: async (args) => {
            const query = encodeURIComponent(args.query as string);
            const res = await fetch(`https://html.duckduckgo.com/html/?q=${query}`);
            const html = await res.text();
            const $ = cheerio.load(html);
            const results: { title: string; url: string; snippet: string }[] = [];
            $(".result").each((_, el) => {
                const title = $(el).find(".result__title").text().trim();
                const url = $(el).find(".result__url").attr("href") ?? "";
                const snippet = $(el).find(".result__snippet").text().trim();
                if (title || url) {
                    results.push({ title, url, snippet });
                }
            });
            return JSON.stringify(results.slice(0, 10));
        },
    },
} satisfies Tool;