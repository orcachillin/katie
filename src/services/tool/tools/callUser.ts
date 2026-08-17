import Core from "../../../core.js";
import type { Tool } from "../toolService.js";

const DEFAULT_DURATION_SECONDS = 60;
const MAX_DURATION_SECONDS = 5 * 60;

export const callUser = {
    type: "function",
    function: {
        name: "calluser",
        description: "start a short Discord voice call with a user. their speech is transcribed and processed as messages by the model. only use when someone asks for a voice call.",
        parameters: {
            type: "object",
            properties: {
                userId: { type: "string", description: "the Discord user id to call; omit to call the user who requested it" },
                durationSeconds: { type: "integer", description: "call duration from 10 to 300 seconds; defaults to 60" },
            },
        },
        execute: async (args, ctx) => {
            const userId = typeof args.userId === "string" ? args.userId.trim() : ctx.userId;
            if (!/^\d{17,20}$/.test(userId)) return "userId must be a Discord user id";

            const durationSeconds = args.durationSeconds ?? DEFAULT_DURATION_SECONDS;
            if (!Number.isInteger(durationSeconds) || (durationSeconds as number) < 10 || (durationSeconds as number) > MAX_DURATION_SECONDS) {
                return `durationSeconds must be an integer between 10 and ${MAX_DURATION_SECONDS}`;
            }

            return Core.services.voice.startCall(userId, (durationSeconds as number) * 1000);
        },
    },
} satisfies Tool;

export const endCall = {
    type: "function",
    function: {
        name: "endcall",
        description: "end the currently active Discord voice test call",
        parameters: {
            type: "object",
            properties: {},
        },
        execute: async () => Core.services.voice.stopCall(),
    },
} satisfies Tool;
