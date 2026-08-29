import Core from "../../../core.js";
import type { Tool } from "../toolService.js";

const SNOWFLAKE = /^\d{17,20}$/;

export const callUser = {
    type: "function",
    function: {
        name: "calluser",
        description: "start a Discord voice call with a user. their speech is transcribed and processed as messages by the model. only use when someone asks for a voice call.",
        parameters: {
            type: "object",
            properties: {
                userId: { type: "string", description: "the Discord user id to call; omit to call the user who requested it" },
            },
        },
        execute: async (args, ctx) => {
            const userId = typeof args.userId === "string" ? args.userId.trim() : ctx.userId;
            if (!SNOWFLAKE.test(userId)) return "userId must be a Discord user id";

            return Core.services.voice.startCall(userId);
        },
    },
} satisfies Tool;

export const callGroup = {
    type: "function",
    function: {
        name: "callgroup",
        description: "start a voice call in an existing Discord Group DM. every speaker is transcribed separately and identified to the model.",
        parameters: {
            type: "object",
            properties: {
                channelId: { type: "string", description: "Group DM channel id; defaults to the current channel" },
                recipientIds: { type: "array", items: { type: "string" }, description: "specific Group DM users to ring; omit to ring everyone" },
            },
        },
        execute: async (args, ctx) => {
            const channelId = typeof args.channelId === "string" ? args.channelId.trim() : ctx.channelId;
            if (!SNOWFLAKE.test(channelId)) return "channelId must be a Discord Group DM channel id";

            let recipientIds: string[] | undefined;
            if (args.recipientIds !== undefined) {
                if (!Array.isArray(args.recipientIds) || !args.recipientIds.every(id => typeof id === "string" && SNOWFLAKE.test(id))) {
                    return "recipientIds must be an array of Discord user ids";
                }
                recipientIds = [...new Set(args.recipientIds as string[])];
            }
            return Core.services.voice.startGroupCall(channelId, recipientIds);
        },
    },
} satisfies Tool;

export const endCall = {
    type: "function",
    function: {
        name: "endcall",
        description: "end the active Discord voice call or decline a pending incoming call",
        parameters: {
            type: "object",
            properties: {},
        },
        execute: async () => Core.services.voice.stopCall(),
    },
} satisfies Tool;
