import { Message, TextChannel } from "discord.js-selfbot-v13"
import { openRouter } from "./deps.js"
import { stateManager } from "./StateManager.js"
import { contextManager } from "./ContextManager.js"
import { channelManager } from "./ChannelManager.js"
import { toolLoader } from "./ToolLoader.js"
import { promptManager } from "./PromptManager.js"

interface Response {
    content: string
    replyTo: string
    sendAt: number
    interruptQueue: boolean
}

class Agent {
    private model = "minimax/minimax-m3"

    async handleMessage(message: Message, extra?: string) {
        const ctx = contextManager.get(message.channelId)
        const state = stateManager.getStateAccessor(message.channelId)

        const instructions = promptManager.get("katie") ?? ""

        const content = [
            extra || "",
            `currentTime: ${new Date().toDateString()} ${new Date().toTimeString()}`,
            `timestamp: ${Date.now()}`,
            `currentTimeMs: ${Date.now()}`,
            `messageId: ${message.id}`,
            `channelId: ${message.channel.id}`,
            `channelType: ${message.channel.type}`,
            `fromId: ${message.author.id}`,
            `from: ${message.author.displayName}`,
            `content: "${message.content}"`,
            `embeds: [${message.embeds.map((a) => JSON.stringify(a.toJSON())).join(",")}]`,
            `queuedMessageCount: ${ctx.timeouts.length / 2}`,
        ].join("\n")

        const result = openRouter.callModel({
            model: this.model,
            instructions,
            state,
            input: [{ role: "user" as const, content }],
            tools: toolLoader.tools as never[],
        })

        const text = await result.getText()

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
                }

                const delayTime = response.sendAt - Date.now()
                const startTypingDelay = delayTime - Math.round(Math.random() * 10000)

                console.log(`waiting ${(delayTime / 1000).toFixed(1)} seconds...`)

                ctx.timeouts.push(setTimeout(async () => {
                    await message.channel.sendTyping().catch(() => {})
                }, startTypingDelay))

                ctx.timeouts.push(setTimeout(async () => {
                    if (response.replyTo) {
                        try {
                            const replyMessage = await message.channel.messages.fetch(response.replyTo)
                            await replyMessage.reply({ content: response.content }).catch(() => {})
                        } catch {
                            await message.channel.send({ content: response.content }).catch(() => {})
                        }
                    } else {
                        await message.channel.send({ content: response.content }).catch(() => {})
                    }
                }, delayTime))
            }
        } catch {
            await this.handleMessage(
                message,
                `you tried to send "${text}" but it wasnt properly formatted json. try again please!\n`,
            )
        }
    }
}

export const agent = new Agent()