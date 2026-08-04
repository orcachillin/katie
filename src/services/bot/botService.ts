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
}

export interface ScheduledPromptInput {
    id: string;
    channelId: string;
    userId: string;
    username: string;
    messageId: string;
    prompt: string;
    dueAt: Date;
}

export interface IncentiveInput {
    channelId: string;
    userId: string;
    username: string;
    messageId: string;
    lastMessageAt: Date;
}

interface SyntheticPromptInput {
    channelId: string;
    userId: string;
    username: string;
    messageId: string;
}

interface QueuedMessage {
    content: string;
    replyTo?: string;
    reactions?: { emoji: string; messageId: string }[];
    sendAt: number;
    contextMessage: ChatMessage;
}

interface ChannelQueue {
    timeouts: NodeJS.Timeout[];
    pending: QueuedMessage[];
    cancelPending: (() => void)[];
}

interface MessageOptions {
    delayTime?: number;
    replyTo?: string;
    react?: string;
}

interface EnqueueResult {
    delivered: boolean;
    messages: ChatMessage[];
}

interface ParsedMessage {
    text: string;
    opts: MessageOptions;
    raw: string;
}

export default class BotService extends AbstractService<"bot"> {

    private client!: Client;
    private activeRuns = new Map<string, AbortController>();
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

    public async processScheduledPrompt(input: ScheduledPromptInput): Promise<boolean> {
        return this.processSyntheticPrompt(input, {
            role: "user",
            content: XML.format("scheduledPrompt", {
                id: input.id,
                from: input.userId,
                sourceMessageId: input.messageId,
                dueAt: input.dueAt.toISOString(),
            }, input.prompt),
        });
    }

    public async processIncentive(input: IncentiveInput): Promise<boolean> {
        return this.processSyntheticPrompt(input, {
            role: "user",
            content: XML.format("incentive", {
                lastMessageAt: input.lastMessageAt.toISOString(),
            }, Core.services.prompt.get("incentive")),
        });
    }

    private async processSyntheticPrompt(input: SyntheticPromptInput, syntheticMessage: ChatMessage): Promise<boolean> {
        if (this.activeRuns.has(input.channelId)) return false;

        const controller = new AbortController();
        this.activeRuns.set(input.channelId, controller);
        let completed = false;

        try {
            const channel = await this.client.channels.fetch(input.channelId);
            if (controller.signal.aborted) return false;
            if (!channel?.isText()) throw new Error(`channel ${input.channelId} is unavailable or is not text-based`);

            this.context.append(input.channelId, syntheticMessage);

            const toolCtx: ToolContext = {
                channelId: input.channelId,
                userId: input.userId,
                username: input.username,
                messageId: input.messageId,
            };

            let delivered = false;
            await this.run(input.channelId, toolCtx, controller.signal, async (text) => {
                const result = await this.enqueueMessages(input.channelId, channel as Message["channel"], text, input.messageId, controller.signal);
                delivered = result.delivered;
                if (!delivered && !controller.signal.aborted) {
                    throw new Error("synthetic prompt response could not be sent");
                }
                return result;
            }, channel as TextBasedChannel);
            completed = !controller.signal.aborted && delivered;
            return completed;
        } catch (err: any) {
            if (err?.name === "AbortError") return false;
            throw err;
        } finally {
            if (!completed) {
                this.context.remove(input.channelId, syntheticMessage);
            }
            if (this.activeRuns.get(input.channelId) === controller) {
                this.activeRuns.delete(input.channelId);
            }
        }
    }

    public async destroy(): Promise<void> {
        this.client.destroy();
    }

    private async onMessage(msg: Message): Promise<void> {
        if (msg.author.id === this.client.user!.id) return;
        if (msg.author.bot) return;

        this.logger.log(`msg from ${msg.author.displayName} in #${(msg.channel as any).name ?? msg.channelId}: ${msg.content.slice(0, 80)}`);

        this.saveUserInfo(msg);

        const existing = this.activeRuns.get(msg.channelId);
        if (existing) {
            existing.abort();
        }
        this.clearQueue(msg.channelId);

        const batch: PendingBatch = {
            messages: [msg],
        };
        const controller = new AbortController();
        this.activeRuns.set(msg.channelId, controller);

        try {
            await this.process(msg.channelId, batch, controller.signal);
        } finally {
            if (this.activeRuns.get(msg.channelId) === controller) {
                this.activeRuns.delete(msg.channelId);
            }
        }
    }

    private clearQueue(channelId: string): void {
        const q = this.queues.get(channelId);
        if (!q) return;
        for (const t of q.timeouts) {
            clearTimeout(t);
            clearInterval(t);
        }
        this.queues.delete(channelId);
        for (const cancel of q.cancelPending) cancel();
    }

    private getQueue(channelId: string): ChannelQueue {
        let q = this.queues.get(channelId);
        if (!q) {
            q = { timeouts: [], pending: [], cancelPending: [] };
            this.queues.set(channelId, q);
        }
        return q;
    }

    private async process(channelId: string, batch: PendingBatch, signal: AbortSignal): Promise<void> {
        const channel = batch.messages[0].channel;
        const latest = batch.messages[batch.messages.length - 1];

        const isDM = channel.type == "DM"
        const isGroup = channel.type == "GROUP_DM"

        if (!isDM && !isGroup && !latest.mentions.users.has(this.client.user!.id)) {
            const should = await this.shouldRespond(Array.from(channel.messages.cache.values()).sort((a, b) => a.createdTimestamp - b.createdTimestamp).slice(0, 10));
            if (!should) return this.logger.log("chose not to respond")
        }

        if (signal.aborted) return;

        void Core.services.incentive.recordActivity({
            channelId,
            userId: latest.author.id,
            username: latest.author.displayName,
            messageId: latest.id,
            lastMessageAt: latest.createdAt,
        }).catch(err => this.logger.warn(`failed to record channel activity: ${err?.message ?? err}`));

        let storedImages;
        try {
            storedImages = await Promise.all(batch.messages.map(message =>
                Core.services.image.storeMessageImages(message, signal)
            ));
        } catch (err: any) {
            if (err?.name === "AbortError") return;
            throw err;
        }
        if (signal.aborted) return;

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
            content: batch.messages.map((m, index) =>
                XML.format(
                    "message",
                    { from: m.author.id, id: m.id, replyTo: m.type == "REPLY" ? m.reference?.messageId : undefined, timestamp: m.createdTimestamp.toString() },
                    [m.content, storedImages[index].context].filter(Boolean).join("\n"),
                )
            ).join("\n"),
            images: storedImages.flatMap(result => result.images),
        };
        this.context.append(channelId, userMsg);

        const toolCtx: ToolContext = {
            channelId,
            userId: latest.author.id,
            username: latest.author.displayName,
            messageId: latest.id,
        };

        try {
            await this.run(channelId, toolCtx, signal, async (text) => {
                return this.enqueueMessages(channelId, channel, text, latest.id, signal);
            });
        } catch (err: any) {
            if (err?.name === "AbortError") return;
            throw err;
        }
    }

    private enqueueMessages(
        channelId: string,
        channel: Message["channel"],
        text: string,
        defaultReplyTo: string,
        signal: AbortSignal,
    ): Promise<EnqueueResult> {
        if (signal.aborted) return Promise.resolve({ delivered: false, messages: [] });

        const q = this.getQueue(channelId);
        let parsedMessages = this.parseXMLMessages(text);
        let accumulatedDelay = 0;
        const sendPromises: Promise<boolean>[] = [];
        const contextMessages: ChatMessage[] = [];

        // try to cover for improperly tagged messages
        // check for missing the first character of the tag since it seems to happen a lot
        if (text.trim().startsWith("message>")) {
            parsedMessages = this.parseXMLMessages(`<${text}`)
        }

        // try to cover for non formatted messages
        if (parsedMessages.length == 0) {

            parsedMessages.push({
                text,
                opts: {},
                raw: text,
            });
        }


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
            const readDelay = Math.random() * 8000
            const messageDelay = opts.delayTime ?? Math.max(1000, wordCount * 900) + readDelay

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

            const contextMessage: ChatMessage = {
                role: "assistant",
                content: parsed.raw,
                sent: false,
            };
            contextMessages.push(contextMessage);
            this.context.append(channelId, contextMessage);

            const queued: QueuedMessage = {
                content,
                replyTo: opts.replyTo,
                reactions,
                sendAt,
                contextMessage,
            };
            q.pending.push(queued);

            // Send typing immediately, then refresh every 10s until the message sends
            const sendTyping = async () => {
                if (signal.aborted || this.queues.get(channelId) !== q) return;
                try { await channel.sendTyping(); } catch { }
            };
            sendTyping();
            const typingInterval = setInterval(sendTyping, 10000);
            q.timeouts.push(typingInterval);

            const sendPromise = new Promise<boolean>((resolve) => {
                const sendTimeout = setTimeout(async () => {
                    clearInterval(typingInterval);
                    const idx = q.pending.indexOf(queued);
                    if (idx !== -1) q.pending.splice(idx, 1);
                    if (signal.aborted || this.queues.get(channelId) !== q) { resolve(false); return; }

                    try {
                        let sent: Message | undefined;
                        let delivered = !content && !queued.reactions?.length;

                        if (content) {
                            const payload = { content };
                            if (queued.replyTo) {
                                const replyMsg = await channel.messages.fetch(queued.replyTo).catch(() => undefined);
                                if (signal.aborted || this.queues.get(channelId) !== q) { resolve(false); return; }
                                sent = replyMsg
                                    ? await replyMsg.reply(payload).catch(() => undefined)
                                    : await channel.send(payload).catch(() => undefined);
                            } else {
                                sent = await channel.send(payload).catch(() => undefined);
                            }
                            if (sent) {
                                delivered = true;
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
                                if (signal.aborted || this.queues.get(channelId) !== q) break;
                                const target = r.messageId === "this"
                                    ? reactionTarget
                                    : await channel.messages.fetch(r.messageId).catch(() => undefined);
                                if (signal.aborted || this.queues.get(channelId) !== q) break;
                                if (target) {
                                    const reacted = await target.react(r.emoji).then(() => true).catch(() => false);
                                    delivered ||= reacted;
                                }
                            }
                        }
                        if (delivered) {
                            this.context.markSent(channelId, queued.contextMessage);
                        }
                        resolve(delivered);
                    } catch {
                        resolve(false);
                    }
                }, accumulatedDelay);
                q.timeouts.push(sendTimeout);
                q.cancelPending.push(() => resolve(false));
            });
            sendPromises.push(sendPromise);
        }

        return Promise.all(sendPromises).then(results => {
            const delivered = results.every(Boolean);
            return { delivered, messages: contextMessages };
        });
    }

    private parseXMLMessages(raw: string): ParsedMessage[] {
        const results: ParsedMessage[] = [];

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

                results.push({ text: textContent, opts, raw: match[0] });
            } else if (match[3] !== undefined) {
                // Standalone <react/> tag
                const attrs = this.parseXMLAttributes(match[3]);
                results.push({
                    text: "",
                    opts: { react: `${attrs.emoji}:${attrs.target}` },
                    raw: match[0],
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

    private async run(
        channelId: string,
        toolCtx: ToolContext,
        signal: AbortSignal,
        enqueue: (text: string) => Promise<EnqueueResult>,
        channelOverride?: TextBasedChannel,
    ): Promise<void> {
        const channel = channelOverride ?? this.client.channels.cache.get(channelId) as TextBasedChannel
        if (!channel) throw new Error(`channel ${channelId} is unavailable`);
        const messages = [...this.context.get(channelId)];


        if (messages.length == 1) {

            const channelMessage: ChatMessage = {
                role: "system",
                content: XML.format("channel", { id: channel.id, type: channel.type, name: Object.hasOwn(channel, "name") ? (channel as GuildTextBasedChannel).name : undefined })
            };

            const recentMessage: ChatMessage = {
                role: "user",
                content: (await channel.messages.fetch())
                    .map(m =>
                        XML.format("recentMessage", { id: m.id, authorId: m.author.id, createdAt: AgentService.formatDate(m.createdAt) }, m.content)
                    ).join("\n")
            };
            if (signal.aborted) return;
            messages.unshift(recentMessage, channelMessage);
            this.context.prepend(channelId, recentMessage, channelMessage);

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

            const hasToolCalls = !!response.toolCalls?.length;

            let assistantMsg: any = undefined;
            if (hasToolCalls) {
                assistantMsg = {
                    role: "assistant",
                    content: response.content,
                    tool_calls: response.toolCalls!.map(tc => ({
                        id: tc.id,
                        type: "function",
                        function: { name: tc.name, arguments: tc.arguments },
                    })),
                };
                messages.push(assistantMsg);
            }

            let queuedMessages: ChatMessage[] = [];
            if (response.content) {
                const result = await enqueue(response.content);
                queuedMessages = result.messages;
            }

            if (signal.aborted) return;

            if (!assistantMsg) {
                if (queuedMessages.length) {
                    messages.push(...queuedMessages);
                } else {
                    const emptyMessage: ChatMessage = { role: "assistant", content: response.content ?? "" };
                    messages.push(emptyMessage);
                    this.context.append(channelId, emptyMessage);
                }
            }

            if (!hasToolCalls) break;

            this.logger.log(`tool calls: ${response.toolCalls!.map(tc => tc.name).join(", ")}`);

            const toolMessages: ChatMessage[] = [];
            for (const tc of response.toolCalls!) {
                const result = await Core.services.tool.execute(tc.name, JSON.parse(tc.arguments), toolCtx);
                if (signal.aborted) return;
                const toolMessage: ChatMessage = {
                    role: "tool",
                    tool_call_id: tc.id,
                    content: result,
                };
                messages.push(toolMessage);
                toolMessages.push(toolMessage);
            }

            // Persist tool protocol messages only once every result is present.
            this.context.append(channelId, { ...assistantMsg, content: null }, ...toolMessages);
        }
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
            `[${m.author.displayName}]: ${m.content}${m.attachments.some(attachment => attachment.contentType?.startsWith("image/") || attachment.width !== null) ? " [image attached]" : ""}`
        ).join("\n");

        const res = await Core.services.agent.chat([
            {
                role: "system",
                content: Core.services.prompt.get("shouldRespond"),
            },
            {
                role: "user",
                content: Core.services.prompt.render("shouldRespondSystemPrompt", {
                    systemPrompt: Core.services.agent.getSystemPrompt(),
                }),
            },
            {
                role: "user",
                content: Core.services.prompt.render("shouldRespondContext", {
                    channelContext: channelCtx,
                    userContexts: userContexts.join("\n\n"),
                    recentContent,
                }),
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
