import { Message, TextChannel } from "discord.js-selfbot-v13"
import { openRouter } from "./deps.js"
import { stateManager } from "./StateManager.js"
import { contextManager } from "./ContextManager.js"
import { toolLoader } from "./ToolLoader.js"
import { promptManager } from "./PromptManager.js"
import { normalizeInputToArray } from "@openrouter/agent"
import { imageManager } from "./ImageManager.js"
import { typoify } from "./util/typo.js"

interface MessageOptions {
    delayTime?: number
    replyTo?: string
    react?: { emoji: string; messageId: string }[]
}

type OptionHandler = (val: string, opts: MessageOptions) => void

const optionHandlers: Record<string, OptionHandler> = {
    delayTime: (val, opts) => { opts.delayTime = Number(val) },
    replyTo: (val, opts) => { opts.replyTo = val },
    react: (val, opts) => {
        opts.react = val.split(";").map(pair => {
            const lastColon = pair.lastIndexOf(":")
            return {
                emoji: pair.slice(0, lastColon),
                messageId: pair.slice(lastColon + 1),
            }
        })
    },
}

/** parse leading header like [delayTime=3000,replyTo=id] from message content */
function parseHeader(raw: string): { text: string; opts: MessageOptions } {
    const opts: MessageOptions = {}
    const headerMatch = raw.match(/\[([^\]]+)\](.*)/s)
    if (!headerMatch) return { text: raw, opts }

    for (const pair of headerMatch[1].split(",")) {
        const eqIdx = pair.indexOf("=")
        if (eqIdx === -1) continue
        const key = pair.slice(0, eqIdx).trim()
        const val = pair.slice(eqIdx + 1).trim()
        optionHandlers[key]?.(val, opts)
    }

    return { text: headerMatch[2].trim(), opts }
}

/** flatten message content to plain text */
function flattenContent(content: unknown): string {
    if (typeof content === "string") return content
    if (Array.isArray(content)) {
        return content
            .map((block: Record<string, unknown>) => {
                if (block.type === "output_text" || block.type === "input_text") {
                    return (block.text as string) ?? ""
                }
                return JSON.stringify(block)
            })
            .join(" ")
    }
    return JSON.stringify(content)
}

/** format full message history for the summarizer */
function formatMessages(messages: unknown[]): string {
    return messages
        .map((m) => {
            if (typeof m !== "object" || m === null) return JSON.stringify(m)
            const msg = m as Record<string, unknown>
            const role = (msg.role as string) ?? "unknown"
            const content = flattenContent(msg.content)
            return `${role}: ${content}`
        })
        .join("\n")
}

/** estimate how many words the context is using (closer to token count) */
function estimateContextWords(messages: unknown[]): number {
    let total = 0
    for (const m of messages) {
        total += JSON.stringify(m).split(/\s+/).length
    }
    return total
}

const COMPACT_THRESHOLD = 15000

class Agent {
    private model = "minimax/minimax-m3"

    /** check if the state needs compaction and compact it if so */
    private async maybeCompact(channelId: string) {
        const state = stateManager.get(channelId)
        if (!state) return

        const messages = normalizeInputToArray(state.messages)
        if (messages.length === 0) return

        const size = estimateContextWords(messages)
        if (size < COMPACT_THRESHOLD) return

        console.log(
            `auto-compacting ${messages.length} messages (${size} words) for channel ${channelId}`,
        )

        const formatted = formatMessages(messages)

        const result = openRouter.callModel({
            model: this.model,
            instructions: promptManager.get("condense"),
            input: [{ role: "user" as const, content: formatted }],
        })

        const summary = await result.getText()
        const cleaned = summary.replaceAll(/```(\w+)?/g, "").trim()

        const keepCount = Math.min(2, messages.length)
        const recent = messages.slice(-keepCount)

        const compacted = [
            {
                role: "system" as const,
                content: `[compacted conversation summary]: ${cleaned}`,
            },
            ...recent,
        ]

        state.messages = compacted
        stateManager.set(channelId, state)

        console.log(`compacted to ${estimateContextWords(compacted)} words`)
    }

    async handleMessage(message: Message, extra?: string, signal?: AbortSignal) {
        const ctx = contextManager.get(message.channelId)
        const state = stateManager.getStateAccessor(message.channelId)

        const instructions = promptManager.get("katie") ?? ""


        const text_input = [
            extra || "",
            '<metadata>',
            `time: ${new Date().toDateString()} ${new Date().toTimeString()}`,
            `timestamp: ${Date.now()}`,
            `messageId: ${message.id}`,
            `from: ${message.author.id}`,
            message.type == "REPLY" ? `replyTo: ${message.reference?.messageId}` : "",
            `queuedMessages: \n${ctx.messageQueue.map(msg => `   in ${msg.sendAt - Date.now()}ms: ${msg.content}`).join("\n")}`,
            '</metadata>',
            `<content>${message.content}</content>`
        ].join("\n")

        await this.maybeCompact(message.channelId)

        // describe any images using a vision model and inject as text
        const imageDescription = await imageManager.describeImages(message)

        let text: string
        try {
            const result = openRouter.callModel({
                model: this.model,
                instructions,
                state,
                provider: {
                    sort: "price",
                    allowFallbacks: true,
                    // only: ["minimax"],
                    ignore: ["morph"]
                },
                input: [{
                    role: 'user' as const,
                    content: text_input + imageDescription,
                }],
                tools: toolLoader.tools as never[],
            }, { signal })

            text = await result.getText()
        } catch (err) {
            if ((err as Error)?.name === "AbortError") return
            throw err
        }

        const rawMessages = text.split("\n\n")
        let currentDelay = 0

        for (const raw of rawMessages) {
            if (raw.length === 0) return

            const { text: content, opts } = parseHeader(raw)

            const messageDelay = opts.delayTime ?? content.split(" ").length * 400
            const delayTime = currentDelay + messageDelay
            currentDelay += messageDelay

            const startTypingDelay = delayTime * 0.1
            const queuedAt = Date.now()
            const sendAt = queuedAt + delayTime

            ctx.messageQueue.push({
                ...{
                    content,
                    queuedAt,
                    sendAt,
                },
                queuedAt: queuedAt
            })

            console.log(`waiting ${(delayTime / 1000).toFixed(1)} seconds...`)

            content && ctx.timeouts.push(setTimeout(async () => {
                await message.channel.sendTyping().catch(() => { })
            }, startTypingDelay))

            ctx.timeouts.push(setTimeout(async () => {

                const indexToRemove = ctx.messageQueue.findIndex((m) => m.queuedAt == queuedAt)
                ctx.messageQueue.splice(indexToRemove, 1)

                const typoContent = Math.random() < 0.07 ? typoify(content) : null
                const sendContent = typoContent ?? content

                let sent: Message | undefined
                if (opts.replyTo) {
                    try {
                        const replyMsg = await message.channel.messages.fetch(opts.replyTo)
                        sent = await replyMsg.reply({ content: sendContent }).catch(() => undefined)
                    } catch {
                        sent = await message.channel.send({ content: sendContent }).catch(() => undefined)
                    }
                } else {
                    sent = await message.channel.send({ content: sendContent }).catch(() => undefined)
                }

                if (!content && opts.react) {
                    // have to process reacts seperately in the case of there not being content

                    for (const r of opts.react) {
                        try {
                            const target = await message.channel.messages.fetch(r.messageId)
                            if (!target) return console.log(`no message to react to for ${r.messageId}`)
                            await target.react(r.emoji)
                            console.log(`reacted ${r.emoji} to ${r.messageId}`)
                        } catch (err) {
                            console.error(err)
                            console.log(`failed to react ${r.emoji} to ${r.messageId}`)
                        }
                    }
                }


                if (sent) {
                    contextManager.trackSentMessage(message.channelId, sent.id)
                    if (opts.react) {
                        for (const r of opts.react) {
                            try {
                                const target = r.messageId === "this" ? sent : await message.channel.messages.fetch(r.messageId)
                                await target.react(r.emoji)
                                console.log(`reacted ${r.emoji} to ${r.messageId}`)
                            } catch (err) {
                                console.error(err)
                                console.log(`failed to react ${r.emoji} to ${r.messageId}`)
                            }
                        }
                    }
                    if (typoContent) {
                        const editDelay = 3000 + Math.random() * 5000
                        console.log(`typo in ${sent.id}, fixing in ${(editDelay / 1000).toFixed(1)}s`)
                        ctx.timeouts.push(setTimeout(async () => {
                            try {
                                await sent.edit({ content: content })
                            } catch { }
                        }, editDelay))
                    }
                }
            }, delayTime))
        }

    }
}

export const agent = new Agent()