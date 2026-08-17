import type { MessageSearchOptions, TextBasedChannel } from "discord.js-selfbot-v13";
import Core from "../../../core.js";
import XML from "../../../util/xml.js";
import type { Tool } from "../toolService.js";

const MAX_RESULTS = 25;
const MAX_OFFSET = 5_000;
const MAX_CONTENT_LENGTH = 1_000;
const SNOWFLAKE = /^\d{17,20}$/;
const HAS_FILTERS = new Set(["link", "embed", "file", "video", "image", "sound", "sticker"]);

export const searchMessages = {
    type: "function",
    function: {
        name: "searchmessages",
        description: "search Discord's server-side message index in a DM, channel, selected server channels, or an entire server. use this to find older messages by text, author, mention, attachment type, or message id bounds.",
        parameters: {
            type: "object",
            properties: {
                channelId: { type: "string", description: "channel to search; defaults to the current channel" },
                content: { type: "string", description: "text contained in the message" },
                authorIds: { type: "array", items: { type: "string" }, description: "only messages from these Discord user ids" },
                mentionIds: { type: "array", items: { type: "string" }, description: "only messages mentioning these Discord user ids" },
                channelIds: { type: "array", items: { type: "string" }, description: "server channel ids to search instead of only channelId" },
                allChannels: { type: "boolean", description: "search every accessible channel in the server containing channelId" },
                includeNsfw: { type: "boolean", description: "include accessible age-restricted server channels" },
                has: {
                    type: "array",
                    items: { type: "string", enum: [...HAS_FILTERS] },
                    description: "only messages containing these kinds of content",
                },
                pinned: { type: "boolean", description: "filter by whether the message is pinned" },
                beforeId: { type: "string", description: "only messages older than this message id" },
                afterId: { type: "string", description: "only messages newer than this message id" },
                offset: { type: "integer", description: "number of matching results to skip, defaults to 0" },
                limit: { type: "integer", description: "results to return from 1 to 25, defaults to 10" },
                sortBy: { type: "string", enum: ["timestamp", "relevance"], description: "sort by time or relevance" },
                sortOrder: { type: "string", enum: ["asc", "desc"], description: "ascending or descending order" },
            },
        },
        execute: async (args, ctx) => {
            const channelId = typeof args.channelId === "string" ? args.channelId.trim() : ctx.channelId;
            if (!SNOWFLAKE.test(channelId)) return "channelId must be a Discord channel id";

            const content = typeof args.content === "string" ? args.content.trim() : "";
            const authorIds = parseSnowflakes(args.authorIds);
            if (typeof authorIds === "string") return authorIds;
            const mentionIds = parseSnowflakes(args.mentionIds);
            if (typeof mentionIds === "string") return mentionIds;
            const channelIds = parseSnowflakes(args.channelIds, 20);
            if (typeof channelIds === "string") return channelIds;

            const beforeId = parseOptionalSnowflake(args.beforeId, "beforeId");
            if (beforeId.error) return beforeId.error;
            const afterId = parseOptionalSnowflake(args.afterId, "afterId");
            if (afterId.error) return afterId.error;

            const has = Array.isArray(args.has)
                ? args.has.filter((value): value is string => typeof value === "string" && HAS_FILTERS.has(value))
                : [];
            const pinned = typeof args.pinned === "boolean" ? args.pinned : undefined;
            if (!content && !authorIds.length && !mentionIds.length && !has.length && pinned === undefined && !beforeId.value && !afterId.value) {
                return "provide at least one search filter";
            }

            const limit = args.limit ?? 10;
            if (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > MAX_RESULTS) {
                return `limit must be an integer between 1 and ${MAX_RESULTS}`;
            }
            const offset = args.offset ?? 0;
            if (!Number.isInteger(offset) || (offset as number) < 0 || (offset as number) > MAX_OFFSET) {
                return `offset must be an integer between 0 and ${MAX_OFFSET}`;
            }
            if (args.sortBy !== undefined && args.sortBy !== "timestamp" && args.sortBy !== "relevance") {
                return "sortBy must be timestamp or relevance";
            }
            if (args.sortOrder !== undefined && args.sortOrder !== "asc" && args.sortOrder !== "desc") {
                return "sortOrder must be asc or desc";
            }

            const channel = await Core.services.bot.getClient().channels.fetch(channelId);
            if (!channel?.isText()) return "channel not found or is not text-based";
            const guildId = "guildId" in channel ? channel.guildId : undefined;
            if (args.allChannels === true && !guildId) return "allChannels is only available in a server";

            const searchChannels = guildId
                ? args.allChannels === true ? [] : channelIds.length ? channelIds : [channel.id]
                : [];
            const options = {
                authors: authorIds,
                content,
                mentions: mentionIds,
                has,
                maxId: beforeId.value,
                minId: afterId.value,
                channels: searchChannels,
                pinned,
                nsfw: args.includeNsfw === true,
                offset: offset as number,
                limit: limit as number,
                sortBy: args.sortBy,
                sortOrder: args.sortOrder,
            } as unknown as MessageSearchOptions;

            const result = await (channel as TextBasedChannel).messages.search(options);
            const messages = result.messages.map(message => XML.format("discordMessage", {
                id: message.id,
                channelId: message.channelId,
                guildId: message.guildId ?? undefined,
                authorId: message.author.id,
                author: message.author.displayName,
                createdAt: message.createdAt.toISOString(),
                attachmentCount: message.attachments.size ? String(message.attachments.size) : undefined,
            }, escapeXML(message.content.slice(0, MAX_CONTENT_LENGTH))));

            return XML.format("discordMessageSearch", {
                total: String(result.total),
                returned: String(messages.length),
                offset: String(offset),
            }, messages.join("\n"));
        },
    },
} satisfies Tool;

function parseSnowflakes(value: unknown, max = 10): string[] | string {
    if (value === undefined) return [];
    if (!Array.isArray(value)) return "user and channel id filters must be arrays";
    if (value.length > max) return `id filters cannot contain more than ${max} values`;
    if (!value.every(id => typeof id === "string" && SNOWFLAKE.test(id))) return "id filters must contain Discord ids";
    return [...new Set(value as string[])];
}

function parseOptionalSnowflake(value: unknown, name: string): { value?: string; error?: string } {
    if (value === undefined) return {};
    if (typeof value !== "string" || !SNOWFLAKE.test(value)) return { error: `${name} must be a Discord message id` };
    return { value };
}

function escapeXML(value: string): string {
    return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
