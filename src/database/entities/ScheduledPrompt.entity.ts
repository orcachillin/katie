import { defineEntity, p } from "@mikro-orm/core";
import { ResourceBaseEntity } from "../baseEntities/resource.js";

export const ScheduledPromptSchema = defineEntity({
    name: "ScheduledPrompt",
    extends: ResourceBaseEntity,
    properties: {
        channelId: p.string().length(20),
        userId: p.string().length(20),
        username: p.string(),
        messageId: p.string().length(20),
        prompt: p.text(),
        dueAt: p.datetime(),
        nextAttemptAt: p.datetime(),
        attempts: p.integer().default(0),
        lastError: p.text().nullable(),
    },
    indexes: [
        { properties: ["nextAttemptAt"] },
    ],
});

export class ScheduledPrompt extends ScheduledPromptSchema.class { }

ScheduledPromptSchema.setClass(ScheduledPrompt);
