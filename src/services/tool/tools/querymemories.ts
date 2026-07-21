import Core from "../../../core.js";
import { MemoryCategory } from "../../../database/entities/Memory.entity.js";
import type { Tool } from "../toolService.js";

export const querymemories = {
    type: "function",
    function: {
        name: "querymemories",
        description: "search saved memories by semantic similarity. use this whenever you need to recall facts you have memorized.",
        parameters: {
            type: "object",
            properties: {
                query: { type: "string", description: "what you are looking for, in natural language" },
                category: { type: "string", enum: ["user", "self", "channel"], description: "which memory category to search" },
                userId: { type: "string", description: "for user memories, the user's id (just digits); omit for self/channel or to search across all users" },
                limit: { type: "number", description: "max results to return (default 5)" },
            },
            required: ["query", "category"],
        },
        execute: async (args) => {
            const query = args.query as string;
            const category = args.category as MemoryCategory;
            const userId = args.userId as string | undefined;
            const limit = typeof args.limit === "number" ? args.limit : 5;

            const results = await Core.services.memory.search(category, query, userId, limit);
            if (results.length === 0) return "no memories found";

            return results
                .map(r => `[${r.similarity.toFixed(3)}] ${r.memory.name}\n${r.memory.content}`)
                .join("\n\n---\n\n");
        },
    },
} satisfies Tool;