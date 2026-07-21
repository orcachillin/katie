import Core from "../../../core.js";
import { User } from "../../../database/entities/UserData.entity.js";
import XML from "../../../util/xml.js";
import type { Tool } from "../toolService.js";

export const getuserinfo = {
    type: "function",
    function: {
        name: "getuserinfo",
        description: "look up saved info about a discord user by their id. if they're not in the db yet, fetches from discord api.",
        parameters: {
            type: "object",
            properties: {
                userId: { type: "string", description: "the user's discord id" },
            },
            required: ["userId"],
        },
        execute: async (args) => {
            const repo = Core.database.repository.user;
            let user = await repo.findOne(args.userId as string);
            if (!user) {
                const discordUser = await Core.services.bot.getClient().users.fetch(args.userId as string).catch((err) => undefined)
                if (!discordUser) return "couldn't find that user. make sure youre passing in the id correctly, and that youre passing in a user id, not a channel id.";


                const profile = await discordUser.getProfile()
                user = new User();
                user.id = discordUser.id;
                user.username = discordUser.username;
                user.displayName = discordUser.displayName;
                user.pronouns = profile.user_profile.pronouns
                user.bio = profile.user_profile.bio
                Core.database.em.persist(user);
                await Core.database.em.flush();
            }
            return XML.format("user", {
                id: user.id,
                username: user.displayName,
                pronouns: user.pronouns || undefined,
                bio: user.bio || undefined
            })


        },
    },
} satisfies Tool;
