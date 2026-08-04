import { defineEntity, p } from "@mikro-orm/core";

export const ChannelActivitySchema = defineEntity({
    name: "ChannelActivity",
    properties: {
        channelId: p.string().length(20).primary(),
        userId: p.string().length(20),
        username: p.string(),
        messageId: p.string().length(20),
        lastMessageAt: p.datetime(),
        lastIncentiveAt: p.datetime().nullable(),
    },
    indexes: [
        { properties: ["lastMessageAt"] },
    ],
});

export class ChannelActivity extends ChannelActivitySchema.class { }

ChannelActivitySchema.setClass(ChannelActivity);
