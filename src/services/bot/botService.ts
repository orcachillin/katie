import { Client, TextBasedChannel, type Message } from "discord.js-selfbot-v13";
import { ChannelType } from "discord-api-types/v10";
import AbstractService from "../../base/abstractService.js";
import Core from "../../core.js";
import { MemoryCategory } from "../../database/entities/Memory.entity.js";
import { User } from "../../database/entities/UserData.entity.js";
import ChannelContext from "./channelContext.js";
import type { ChatMessage } from "../agent/agentService.js";
import type { ToolContext } from "../tool/toolService.js";

interface PendingBatch {
    messages: Message[];
    controller: AbortController;
}

interface QueuedMessage {
    content: string;
    replyTo?: string;
    reactions?: { emoji: string; messageId: string }[];
    sendAt: number;
}

interface ChannelQueue {
    timeouts: NodeJS.Timeout[];
    pending: QueuedMessage[];
}

interface MessageOptions {
    delayTime?: number;
    replyTo?: string;
    react?: string;
}

export default class BotService extends AbstractService<"bot"> {

    private client!: Client;
    private batches = new Map<string, PendingBatch>();
    private context = new ChannelContext();
    private queues = new Map<string, ChannelQueue>();

    constructor() {
        super("bot");
    }

    public async init(): Promise<void> {
        this.client = new Client();

        this.client.on("ready", () => {
            this.logger.log(`Logged in as ${this.client.user!.username}`);
        });

        this.client.on("messageCreate", (msg) => this.onMessage(msg));
        this.client.on("error", (err) => this.logger.error(err));

        await this.client.login(process.env.TOKEN);
    }

    public getClient(): Client {
        return this.client;
    }

    public async destroy(): Promise<void> {
        this.client.destroy();
    }

    private async onMessage(msg: Message): Promise<void> {
        if (msg.author.id === this.client.user!.id) return;
        if (msg.author.bot) return;

        this.saveUserInfo(msg);

        this.clearQueue(msg.channelId);

        const existing = this.batches.get(msg.channelId);
        if (existing) {
            existing.controller.abort();
            this.batches.delete(msg.channelId);
        }

        const batch: PendingBatch = {
            messages: [msg],
            controller: new AbortController(),
        };
        this.batches.set(msg.channelId, batch);

        await this.process(msg.channelId);
    }

    private clearQueue(channelId: string): void {
        const q = this.queues.get(channelId);
        if (!q) return;
        for (const t of q.timeouts) clearTimeout(t);
        this.queues.delete(channelId);
    }

    private getQueue(channelId: string): ChannelQueue {
        let q = this.queues.get(channelId);
        if (!q) {
            q = { timeouts: [], pending: [] };
            this.queues.set(channelId, q);
        }
        return q;
    }

    private async process(channelId: string): Promise<void> {
        const batch = this.batches.get(channelId);
        if (!batch) return;
        this.batches.delete(channelId);

        const channel = batch.messages[0].channel;
        const latest = batch.messages[batch.messages.length - 1];


        const isDM = channel.type == "DM"
        const isGroup = channel.type == "GROUP_DM"

        if (!isDM && !isGroup && !latest.mentions.users.has(this.client.user!.id)) {
            const should = await this.shouldRespond(batch.messages);
            if (!should) return this.logger.log("chose not to respond")
        }

        const userMsg: ChatMessage = {
            role: "user",
            content: batch.messages.map(m =>
                `<message from="${m.author.displayName}" id="${m.id}">${m.content}</message>`
            ).join("\n"),
        };
        this.context.append(channelId, userMsg);

        const toolCtx: ToolContext = {
            channelId,
            userId: latest.author.id,
            username: latest.author.displayName,
            messageId: latest.id,
        };

        try {
            await this.run(channelId, toolCtx, batch.controller.signal, async (text) => {
                await this.enqueueMessages(channelId, channel, text, latest.id);
            });
        } catch (err: any) {
            if (err?.name === "AbortError") return;
            throw err;
        }
    }

    private async enqueueMessages(
        channelId: string,
        channel: Message["channel"],
        text: string,
        defaultReplyTo: string,
    ): Promise<void> {
        const q = this.getQueue(channelId);
        const rawMessages = text.split("\n\n").filter(Boolean);
        let accumulatedDelay = 0;

        for (const raw of rawMessages) {
            const { text: content, opts } = this.parseHeader(raw);
            const reactions = opts.react?.split(";").map(pair => {
                const colon = pair.lastIndexOf(":");
                return {
                    emoji: colon === -1 ? pair.trim() : pair.slice(0, colon).trim(),
                    messageId: colon === -1 ? defaultReplyTo : pair.slice(colon + 1).trim(),
                };
            });

            if (!content && !reactions?.length) continue;

            const wordCount = content.split(/\s+/).filter(Boolean).length;
            let messageDelay = opts.delayTime ?? Math.min(8000, Math.max(1000, wordCount * 400));
            if (messageDelay < 500) messageDelay = 500;

            accumulatedDelay += messageDelay;
            const sendAt = Date.now() + accumulatedDelay;

            const queued: QueuedMessage = {
                content,
                replyTo: opts.replyTo,
                reactions,
                sendAt,
            };
            q.pending.push(queued);

            const typingTimeout = setTimeout(async () => {
                if (!this.queues.has(channelId)) return;
                try { await channel.sendTyping(); } catch { }
            }, accumulatedDelay * 0.1);
            q.timeouts.push(typingTimeout);

            const sendTimeout = setTimeout(async () => {
                const idx = q.pending.indexOf(queued);
                if (idx !== -1) q.pending.splice(idx, 1);
                if (!this.queues.has(channelId)) return;

                try {
                    let sent: Message | undefined;

                    if (content) {
                        const payload = { content };
                        if (queued.replyTo) {
                            const replyMsg = await channel.messages.fetch(queued.replyTo).catch(() => undefined);
                            sent = replyMsg
                                ? await replyMsg.reply(payload).catch(() => undefined)
                                : await channel.send(payload).catch(() => undefined);
                        } else {
                            sent = await channel.send(payload).catch(() => undefined);
                        }
                    }

                    const reactionTarget = queued.reactions?.length
                        ? sent ?? await channel.messages.fetch(defaultReplyTo).catch(() => undefined)
                        : undefined;

                    if (reactionTarget) {
                        for (const r of queued.reactions ?? []) {
                            const target = r.messageId === "this"
                                ? reactionTarget
                                : await channel.messages.fetch(r.messageId).catch(() => undefined);
                            if (target) await target.react(r.emoji).catch(() => { });
                        }
                    }
                } catch { }
            }, accumulatedDelay);
            q.timeouts.push(sendTimeout);
        }
    }

    private parseHeader(raw: string): { text: string; opts: MessageOptions } {
        const opts: MessageOptions = {};
        const stripped = raw.trim();
        const headerMatch = stripped.match(/^\[([^\]]+)\]\s*/);
        if (!headerMatch) return { text: stripped, opts };

        for (const pair of headerMatch[1].split(",")) {
            const eqIdx = pair.indexOf("=");
            const colonIdx = pair.indexOf(":");
            const sepIdx = eqIdx !== -1 ? eqIdx : colonIdx;
            if (sepIdx === -1) continue;
            const key = pair.slice(0, sepIdx).trim().toLowerCase();
            const val = pair.slice(sepIdx + 1).trim();
            if (key === "delaytime" || key === "t") opts.delayTime = Number(val);
            if (key === "replyto" || key === "r") opts.replyTo = val;
            if (key === "react") opts.react = val;
        }

        return { text: stripped.slice(headerMatch[0].length).trim(), opts };
    }

    private async run(channelId: string, toolCtx: ToolContext, signal: AbortSignal, enqueue: (text: string) => Promise<void>): Promise<void> {
        const messages = [...this.context.get(channelId)];

        if (messages.length == 0) {
            const recentContent = (await (this.client.channels.cache.get(channelId) as TextBasedChannel).messages.fetch())
                .map(m =>
                    `[${m.author.displayName}]: ${m.content}`
                ).join("\n");

            messages.unshift({
                role: "user",
                content: `recent messages\n\n${recentContent}`
            })
        }

        while (true) {
            if (signal.aborted) return;

            let content = "";
            const toolCallsAcc = new Map<number, { id: string; name: string; arguments: string }>();

            for await (const chunk of Core.services.agent.chatStream(messages, {
                tools: Core.services.tool.definitions,
                signal,
            })) {
                if (chunk.content) content += chunk.content;
                if (chunk.toolCall) {
                    const existing = toolCallsAcc.get(chunk.toolCall.index) || { id: "", name: "", arguments: "" };
                    if (chunk.toolCall.id) existing.id = chunk.toolCall.id;
                    if (chunk.toolCall.name) existing.name = chunk.toolCall.name;
                    if (chunk.toolCall.arguments) existing.arguments += chunk.toolCall.arguments;
                    toolCallsAcc.set(chunk.toolCall.index, existing);
                }
            }

            if (signal.aborted) return;

            const raw: any = { role: "assistant", content: content || null };
            const toolCalls = [...toolCallsAcc.values()].filter(tc => tc.name);
            if (toolCalls.length) {
                raw.tool_calls = toolCalls.map(tc => ({
                    id: tc.id,
                    function: { name: tc.name, arguments: tc.arguments },
                }));
            }
            messages.push(raw);

            if (content) {
                await enqueue(content);
            }

            if (!toolCalls.length) break;

            for (const tc of toolCalls) {
                const result = await Core.services.tool.execute(tc.name, JSON.parse(tc.arguments), toolCtx);
                messages.push({
                    role: "tool",
                    tool_call_id: tc.id,
                    content: result,
                });
            }
        }

        this.context.set(channelId, messages);
    }

    private async shouldRespond(messages: Message[]): Promise<boolean> {
        const channelId = messages[0].channelId;
        const channelCtx = await Core.services.memory.readContent(MemoryCategory.Channel, "info", channelId);
        const userContexts: string[] = [];
        for (const m of messages) {
            const userInfo = await Core.services.memory.readContent(MemoryCategory.User, "info", m.author.id);
            if (userInfo && !userInfo.includes("doesnt exist yet")) {
                userContexts.push(`--- ${m.author.displayName} ---\n${userInfo}`);
            }
        }

        const recentContent = messages.map(m =>
            `[${m.author.displayName}]: ${m.content}`
        ).join("\n");

        const res = await Core.services.agent.chat([
            {
                role: "system",
                content: `you decide if katie would chime in. reply with just "yes" or "no".`,
            },
            {
                role: "user",
                content: `channel info: ${channelCtx}\n\n${userContexts.join("\n\n")}\n\nrecent messages:\n${recentContent}`,
            },
        ], { model: "qwen3.6-35b-fast", maxTokens: 10, temperature: 0.1 });

        return res.content?.toLowerCase().includes("yes") ?? false;
    }

    private async saveUserInfo(msg: Message): Promise<void> {
        const repo = Core.database.repository.user;
        let user = await repo.findOne(msg.author.id);
        if (!user) {
            user = new User();
            user.id = msg.author.id;
        }
        user.username = msg.author.username;
        user.displayName = msg.author.displayName;

        if (!user.pronouns || !user.bio) {
            const detailedUser = await msg.author.getProfile().catch(() => undefined)
            if (detailedUser) {
                user.pronouns = detailedUser.user_profile.pronouns
                user.bio = detailedUser.user_profile.bio
            }
        }

        Core.database.em.persist(user);
        await Core.database.em.flush();
    }
}
