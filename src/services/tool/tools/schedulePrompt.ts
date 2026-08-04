import Core from "../../../core.js";
import type { Tool } from "../toolService.js";

const MAX_DELAY_SECONDS = 365 * 24 * 60 * 60;
const MAX_PROMPT_LENGTH = 4000;

export const schedulePrompt = {
    type: "function",
    function: {
        name: "scheduleprompt",
        description: "schedule a prompt for your future self in the current channel. when due, the prompt is given back to you so you can send a reminder or follow-up.",
        parameters: {
            type: "object",
            properties: {
                prompt: { type: "string", description: "instructions for your future self, including what to remind the user about" },
                delaySeconds: { type: "number", description: "seconds from now to run the prompt; use this for relative times" },
                runAt: { type: "string", description: "ISO 8601 date and time with Z or a numeric UTC offset; use this for absolute times" },
            },
            required: ["prompt"],
        },
        execute: async (args, ctx) => {
            const prompt = typeof args.prompt === "string" ? args.prompt.trim() : "";
            if (!prompt) return "prompt is required";
            if (prompt.length > MAX_PROMPT_LENGTH) return `prompt must be ${MAX_PROMPT_LENGTH} characters or fewer`;

            const hasDelay = args.delaySeconds !== undefined;
            const hasRunAt = args.runAt !== undefined;
            if (hasDelay === hasRunAt) return "provide exactly one of delaySeconds or runAt";

            let dueAt: Date;
            if (hasDelay) {
                const delaySeconds = args.delaySeconds;
                if (typeof delaySeconds !== "number" || !Number.isFinite(delaySeconds) || delaySeconds < 1 || delaySeconds > MAX_DELAY_SECONDS) {
                    return `delaySeconds must be between 1 and ${MAX_DELAY_SECONDS}`;
                }
                dueAt = new Date(Date.now() + delaySeconds * 1000);
            } else {
                const runAt = args.runAt;
                if (typeof runAt !== "string" || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(runAt)) {
                    return "runAt must be an ISO 8601 date and time with Z or a numeric UTC offset";
                }
                dueAt = new Date(runAt);
                if (Number.isNaN(dueAt.getTime())) return "runAt is not a valid date and time";
                if (dueAt.getTime() <= Date.now()) return "runAt must be in the future";
                if (dueAt.getTime() - Date.now() > MAX_DELAY_SECONDS * 1000) return "runAt must be within one year";
            }

            const id = await Core.services.scheduler.schedule({
                channelId: ctx.channelId,
                userId: ctx.userId,
                username: ctx.username,
                messageId: ctx.messageId,
                prompt,
                dueAt,
            });
            return `scheduled prompt ${id} for ${dueAt.toISOString()}`;
        },
    },
} satisfies Tool;
