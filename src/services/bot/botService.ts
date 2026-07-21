import { Client, GuildTextBasedChannel, TextBasedChannel, type Message } from "discord.js-selfbot-v13";
import { ChannelType } from "discord-api-types/v10";
import AbstractService from "../../base/abstractService.js";
import Core from "../../core.js";
import { MemoryCategory } from "../../database/entities/Memory.entity.js";
import { User } from "../../database/entities/UserData.entity.js";
import ChannelContext from "./channelContext.js";
import type { ChatMessage } from "../agent/agentService.js";
import type { ToolContext } from "../tool/toolService.js";
import XML from "../../util/xml.js";
import AgentService from "../agent/agentService.js";

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

    public getContexts(): Record<string, ChatMessage[]> {
        return this.context.all();
    }

    public async destroy(): Promise<void> {
        this.client.destroy();
    }

    private async onMessage(msg: Message): Promise<void> {
        if (msg.author.id === this.client.user!.id) return;
        if (msg.author.bot) return;

        this.logger.log(`msg from ${msg.author.displayName} in #${(msg.channel as any).name ?? msg.channelId}: ${msg.content.slice(0, 80)}`);

        this.saveUserInfo(msg);

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
            const should = await this.shouldRespond(Array.from(channel.messages.cache.values()).sort((a, b) => b.createdTimestamp - a.createdTimestamp).slice(0, 10));
            if (!should) return this.logger.log("chose not to respond")
        }

        this.clearQueue(channelId)

        // const queue = this.getQueue(channelId)
        // this.clearQueue(channelId)

        // const queued: ChatMessage = {
        //     role: "assistant",
        //     content: queue.pending.map(m => XML.format("queuedMessage", { sendingIn: `${m.sendAt - Date.now()}` }, m.content)).join("\n")
        // }
        // this.context.append(channelId, queued)

        this.logger.log(`processing ${batch.messages.length} msgs from ${latest.author.displayName} in ${isDM ? "DM" : isGroup ? "group" : "guild"}`);

        const userMsg: ChatMessage = {
            role: "user",
            content: batch.messages.map(m =>
                XML.format("message", { from: m.author.id, id: m.id, replyTo: m.type == "REPLY" ? m.reference?.messageId : undefined, timestamp: m.createdTimestamp.toString() }, m.content)
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
        const parsedMessages = this.parseXMLMessages(text);
        let accumulatedDelay = 0;

        for (const parsed of parsedMessages) {
            let content = parsed.text;
            const opts = parsed.opts;
            const reactions = opts.react?.split(";").map(pair => {
                const colon = pair.lastIndexOf(":");
                return {
                    emoji: colon === -1 ? pair.trim() : pair.slice(0, colon).trim(),
                    messageId: colon === -1 ? defaultReplyTo : pair.slice(colon + 1).trim(),
                };
            });

            if (!content && !reactions?.length) continue;

            const wordCount = content.split(/\s+/).filter(Boolean).length;
            let messageDelay = opts.delayTime ?? Math.max(1000, wordCount * 1600) + (Math.random() * 6000)

            accumulatedDelay += messageDelay;
            const sendAt = Date.now() + accumulatedDelay;

            this.logger.info(`[${accumulatedDelay}ms] sending... ${content}`)

            // dedup
            if (q.pending.find(v => v.content == content)) {
                this.logger.warn(`duplicated message found in content, skipping...`)
                continue
            }

            // catches

            const illegal = ["</arg_value>", "</tool_call>"]

            for (const i of illegal) {
                content = content.replaceAll(i, "")
            }

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
            }, accumulatedDelay * (Math.random() / 2 + 0.5));
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
                        if (sent) {
                            this.logger.log(`sent message ${sent.id}`);

                        } else {
                            this.logger.warn(`failed to send: ${content.slice(0, 60)}`);
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

    private parseXMLMessages(raw: string): { text: string; opts: MessageOptions }[] {
        const results: { text: string; opts: MessageOptions }[] = [];

        // Match <message ...>...</message> or standalone <react .../>
        const regex = /<message\b([^>]*)>([\s\S]*?)<\/message>|<react\b([^>]*)\/>/g;
        let match: RegExpExecArray | null;

        while ((match = regex.exec(raw)) !== null) {
            if (match[1] !== undefined) {
                // <message> tag
                const attrs = this.parseXMLAttributes(match[1]);
                let innerContent = match[2];

                // Check for nested <react/> inside message content
                const reactMatch = /<react\b([^>]*)\/>/.exec(innerContent);
                const textContent = innerContent.replace(/<react\b[^>]*\/>/g, "").trim();

                const opts: MessageOptions = {};
                if (attrs.delay) opts.delayTime = Number(attrs.delay);
                if (attrs.replyto) opts.replyTo = attrs.replyto;
                if (reactMatch) {
                    const reactAttrs = this.parseXMLAttributes(reactMatch[1]);
                    opts.react = `${reactAttrs.emoji}:${reactAttrs.target}`;
                }

                results.push({ text: textContent, opts });
            } else if (match[3] !== undefined) {
                // Standalone <react/> tag
                const attrs = this.parseXMLAttributes(match[3]);
                results.push({
                    text: "",
                    opts: { react: `${attrs.emoji}:${attrs.target}` },
                });
            }
        }

        return results;
    }

    private parseXMLAttributes(attrStr: string): Record<string, string> {
        const attrs: Record<string, string> = {};
        const attrRegex = /(\w+)\s*=\s*"([^"]*)"/g;
        let m: RegExpExecArray | null;
        while ((m = attrRegex.exec(attrStr)) !== null) {
            attrs[m[1].toLowerCase()] = m[2];
        }
        return attrs;
    }

    private async run(channelId: string, toolCtx: ToolContext, signal: AbortSignal, enqueue: (text: string) => Promise<void>): Promise<void> {
        const channel = this.client.channels.cache.get(channelId) as TextBasedChannel
        const messages = [...this.context.get(channelId)];


        if (messages.length == 1) {

            messages.unshift({
                role: "system",
                content: XML.format("channel", { id: channel.id, type: channel.type, name: Object.hasOwn(channel, "name") ? (channel as GuildTextBasedChannel).name : undefined })
            })

            messages.unshift({
                role: "user",
                content: (await channel.messages.fetch())
                    .map(m =>
                        XML.format("recentMessage", { id: m.id, authorId: m.author.id, createdAt: AgentService.formatDate(m.createdAt) }, m.content)
                    ).join("\n")
            })

        }

        let loop = 0;

        while (true) {
            if (signal.aborted) return;
            loop++;
            this.logger.log(`run loop ${loop}`);

            const response = await Core.services.agent.chat(messages, {
                tools: Core.services.tool.definitions,
                signal,
            });

            if (signal.aborted) return;

            const raw: any = { role: "assistant", content: response.content };
            if (response.toolCalls?.length) {
                raw.tool_calls = response.toolCalls.map(tc => ({
                    id: tc.id,
                    type: "function",
                    function: { name: tc.name, arguments: tc.arguments },
                }));
            }
            messages.push(raw);

            if (response.content) {
                await enqueue(response.content);
            }

            if (!response.toolCalls?.length) break;

            this.logger.log(`tool calls: ${response.toolCalls.map(tc => tc.name).join(", ")}`);

            for (const tc of response.toolCalls) {
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
        this.logger.log("checking shouldRespond");
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
                content: `you are a filtering agent. you decide if katie would chime in. her system prompt is provided below with some additional context. reply with just "yes" or "no". do not respond as katie.`,
            },
            {
                role: "user",
                content: `katie's system prompt: \n\n${Core.services.agent.getSystemPrompt()}`
            },
            {
                role: "user",
                content: `channel info: ${channelCtx}\n\n${userContexts.join("\n\n")}\n\nrecent messages:\n${recentContent}`,
            },
        ], { model: "qwen3-14b", temperature: 0.1, stripSystemPrompt: true });

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
