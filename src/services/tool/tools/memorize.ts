import Core from "../../../core.js";
import { MemoryCategory } from "../../../database/entities/Memory.entity.js";
import type { Tool } from "../toolService.js";

export const memorize = {
    type: "function",
    function: {
        name: "memorize",
        description: "save a note about a user or for yourself. use this for facts, preferences, promises, anything you want to remember.",
        parameters: {
            type: "object",
            properties: {
                userId: { type: "string", description: "the user's id (just digits)" },
                name: { type: "string", description: "a short name for this memory, like 'pronouns' or 'favorite_color'" },
                content: { type: "string", description: "what to remember" },
                self: { type: "boolean", description: "set to true to save it as your own note instead of about a user" },
            },
            required: ["name", "content"],
        },
        execute: async (args) => {
            const name = args.name as string;
            const content = args.content as string;
            if (args.self) {
                await Core.services.memory.save(MemoryCategory.Self, name, content);
                return `memorized "${name}" about yourself`;
            }
            const userId = args.userId as string | undefined;
            if (!userId) return "need a userId or set self=true";
            await Core.services.memory.save(MemoryCategory.User, name, content, userId);
            return `memorized "${name}" about user ${userId}`;
        },
    },
} satisfies Tool;