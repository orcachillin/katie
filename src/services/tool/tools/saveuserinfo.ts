import Core from "../../../core.js";
import { User } from "../../../database/entities/UserData.entity.js";
import type { Tool } from "../toolService.js";

export const saveuserinfo = {
    type: "function",
    function: {
        name: "saveuserinfo",
        description: "save or update info about a discord user. username and displayName are auto-saved — use this for pronouns and bio.",
        parameters: {
            type: "object",
            properties: {
                userId: { type: "string", description: "the user's discord id" },
                pronouns: { type: "string", description: "their pronouns" },
                bio: { type: "string", description: "a short bio or description" },
            },
            required: ["userId"],
        },
        execute: async (args) => {
            const repo = Core.database.repository.user;
            let user = await repo.findOne(args.userId as string);
            if (!user) {
                user = new User();
                user.id = args.userId as string;
            }
            if (args.pronouns) user.pronouns = args.pronouns as string;
            if (args.bio) user.bio = args.bio as string;
            Core.database.em.persist(user);
            await Core.database.em.flush();
            return `saved info for user ${user.id}`;
        },
    },
} satisfies Tool;