import * as cheerio from "cheerio";
import type { Tool } from "../toolService.js";

export const webfetch = {
    type: "function",
    function: {
        name: "webfetch",
        description: "fetch a webpage and return its text content",
        parameters: {
            type: "object",
            properties: {
                url: { type: "string", description: "URL of the webpage to download" },
            },
            required: ["url"],
        },
        execute: async (args) => {
            const url = args.url as string;
            const res = await fetch(url);
            const html = await res.text();
            const $ = cheerio.load(html);
            $("script, style, noscript, svg, img, video, audio, iframe").remove();
            const text = $("body").text().replace(/\s+/g, " ").trim();
            return text.substring(0, 10000);
        },
    },
} satisfies Tool;