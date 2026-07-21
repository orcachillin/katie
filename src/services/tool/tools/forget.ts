import Core from "../../../core.js";
import { MemoryCategory } from "../../../database/entities/Memory.entity.js";
import type { Tool } from "../toolService.js";

export const forget = {
    type: "function",
    function: {
        name: "forget",
        description: "delete a memory about a user or about yourself.",
        parameters: {
            type: "object",
            properties: {
                userId: { type: "string", description: "the user's id (just digits)" },
                name: { type: "string", description: "name of the memory to delete" },
                self: { type: "boolean", description: "set to true to delete one of your own notes" },
            },
            required: ["name"],
        },
        execute: async (args) => {
            const name = args.name as string;
            if (args.self) {
                const ok = await Core.services.memory.delete(MemoryCategory.Self, name);
                return ok ? `forgot "${name}"` : `no memory named "${name}" about yourself`;
            }
            const userId = args.userId as string | undefined;
            if (!userId) return "need a userId or set self=true";
            const ok = await Core.services.memory.delete(MemoryCategory.User, name, userId);
            return ok ? `forgot "${name}" about user ${userId}` : `no memory named "${name}" about user ${userId}`;
        },
    },
} satisfies Tool;