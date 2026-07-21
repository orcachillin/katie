import { Message, TextChannel } from "discord.js-selfbot-v13";
import Core from "../../../core.js";
import type { Tool } from "../toolService.js";
import AgentService from "../../agent/agentService.js";

export const fetchMessages = {
    type: "function",
    function: {
        name: "fetchmessages",
        description: "get messages in the channel",
        parameters: {
            type: "object",
            properties: {
                channelId: { type: "string", description: "channel id, just the digits" },
                before: { type: "string", description: "message id to get messages before" },
                after: { type: "string", description: "message id to get messages after" },
                around: { type: "string", description: "message id to get messages around" },
                limit: { type: "integer", description: "number of messages to fetch" },
            },
            required: ["channelId"],
        },
        execute: async (args) => {
            const channelId = args.channelId as string;
            const channel = Core.services.bot.getClient().channels.cache.get(channelId) as TextChannel;
            if (!channel) return "channel not found";

            const messages = await channel.messages.fetch({
                before: args.before as string | undefined,
                after: args.after as string | undefined,
                around: args.around as string | undefined,
                limit: args.limit as number | undefined,
            });

            return messages.map(m =>
                `<fetchedMessage id="${m.id}" createdAt="${AgentService.formatDate(m.createdAt)}" authorId=${m.author.id}>${m.content}</fetchedMessage>`
            ).join("\n")
        },
    },
} satisfies Tool;