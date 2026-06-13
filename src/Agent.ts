import { Message, TextChannel } from "discord.js-selfbot-v13"
import { openRouter } from "./deps.js"
import { stateManager } from "./StateManager.js"
import { contextManager } from "./ContextManager.js"
import { toolLoader } from "./ToolLoader.js"
import { promptManager } from "./PromptManager.js"
import { normalizeInputToArray } from "@openrouter/agent"
import { imageManager } from "./ImageManager.js"
import { typoify } from "./util/typo.js"

interface Response {
    content: string
    replyTo: string
    sendAt: number
    interruptQueue: boolean
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

const COMPACT_THRESHOLD = 50000

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
            `channelId: ${message.channel.id}`,
            `channelType: ${message.channel.type}`,
            `fromId: ${message.author.id}`,
            `from: ${message.author.displayName}`,
            message.type == "REPLY" ? `replyTo: ${message.reference?.messageId}` : "",
            `embeds: [${message.embeds.map((a) => JSON.stringify(a.toJSON())).join(",")}]`,
            `queuedMessages: \n${ctx.messageQueue.map(msg => `   in ${msg.sendAt - Date.now()}ms: ${msg.content}`).join("\n")}`,
            `recentMessageIds: [${ctx.recentMessageIds.join(", ")}]`,
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

        try {
            const responses = JSON.parse(
                text.replaceAll(/```(json)?/g, ""),
            ) as Response[]
            if (!responses) return

            for (const response of responses) {
                if (response.content.length === 0) return

                if (response.interruptQueue) {
                    ctx.timeouts.forEach((t) => clearTimeout(t))
                    ctx.timeouts = []
                    ctx.messageQueue = []

                    console.log(`QUEUE INTERRUPT`)
                }

                const delayTime = response.sendAt - Date.now()
                const startTypingDelay = delayTime - Math.round(Math.random() * 750) * response.content.split(" ").length

                const queuedAt = Date.now()

                ctx.messageQueue.push({
                    ...response,
                    queuedAt: queuedAt
                })

                console.log(`waiting ${(delayTime / 1000).toFixed(1)} seconds...`)

                ctx.timeouts.push(setTimeout(async () => {
                    await message.channel.sendTyping().catch(() => { })
                }, startTypingDelay))

                ctx.timeouts.push(setTimeout(async () => {

                    const indexToRemove = ctx.messageQueue.findIndex((m) => m.queuedAt == queuedAt)
                    ctx.messageQueue.splice(indexToRemove, 1)

                    const typoContent = Math.random() < 0.15 ? typoify(response.content) : null
                    const sendContent = typoContent ?? response.content

                    let sent: Message | undefined
                    if (response.replyTo) {
                        try {
                            const replyMessage = await message.channel.messages.fetch(response.replyTo)
                            sent = await replyMessage.reply({ content: sendContent }).catch(() => undefined)
                        } catch {
                            sent = await message.channel.send({ content: sendContent }).catch(() => undefined)
                        }
                    } else {
                        sent = await message.channel.send({ content: sendContent }).catch(() => undefined)
                    }
                    if (sent) {
                        contextManager.trackSentMessage(message.channelId, sent.id)
                        if (typoContent) {
                            const editDelay = 3000 + Math.random() * 5000
                            console.log(`typo in ${sent.id}, fixing in ${(editDelay / 1000).toFixed(1)}s`)
                            ctx.timeouts.push(setTimeout(async () => {
                                try {
                                    await sent.edit({ content: response.content })
                                } catch { }
                            }, editDelay))
                        }
                    }
                }, delayTime))
            }
        } catch {
            await this.handleMessage(
                message,
                `you tried to send "${text}" but it wasnt properly formatted json. try again please!\n`,
                signal
            )
        }
    }
}

export const agent = new Agent()