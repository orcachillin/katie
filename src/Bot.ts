import { Message, TextChannel } from "discord.js-selfbot-v13"
import { client } from "./deps.js"
import { channelManager } from "./ChannelManager.js"
import { promptManager } from "./PromptManager.js"
import { toolLoader } from "./ToolLoader.js"
import { agent } from "./Agent.js"
import { memoryManager } from "./MemoryManager.js"
import { scheduledMessageManager } from "./ScheduledMessageManager.js"

const pendingMessages = new Map<string, Message[]>()
const channelControllers = new Map<string, AbortController>()
const activeBatches = new Map<string, Message[]>()

class Bot {
    async start() {
        promptManager.loadAll()
        await toolLoader.loadAll()
        memoryManager.init()

        client.on("ready", async () => {
            console.log(`${client.user!.username} is ready!`)
            await channelManager.load()
            await scheduledMessageManager.load()
        })

        client.on("error", (err) => console.error(err))

        client.on("messageCreate", async (message) => {
            if (message.author.id === client.user!.id) return
            if (message.author.bot) return
            memoryManager.onMessage(message)
            channelManager.add(message.channelId, message.channel as TextChannel)

            // queue the message
            const existing = pendingMessages.get(message.channelId) ?? []
            existing.push(message)
            pendingMessages.set(message.channelId, existing)

            // if already processing this channel, abort and re-queue the aborted batch
            const controller = channelControllers.get(message.channelId)
            if (controller) {
                controller.abort()
                const aborted = activeBatches.get(message.channelId)
                if (aborted) {
                    const requeue = pendingMessages.get(message.channelId) ?? []
                    pendingMessages.set(message.channelId, [...aborted, ...requeue])
                    activeBatches.delete(message.channelId)
                }
            }
            await this.processChannel(message.channelId)
        })

        client.login(process.env.TOKEN)
    }

    private async processChannel(channelId: string) {
        const batch = pendingMessages.get(channelId)
        pendingMessages.delete(channelId)
        if (!batch || batch.length === 0) return

        const controller = new AbortController()
        channelControllers.set(channelId, controller)
        activeBatches.set(channelId, batch)

        const extra = batch.slice(0, -1).map(m =>
            `<earlierMessage id="${m.id}" from="${m.author.displayName}" fromId="${m.author.id}" timestamp="${m.createdAt.getTime()}"${m.type === "REPLY" ? ` replyTo="${m.reference?.messageId}"` : ""}>${m.content}</earlierMessage>`
        ).join("\n")

        const latest = batch[batch.length - 1]
        await agent.handleMessage(latest, extra, controller.signal)

        // if a restart already started (new controller set), don't double-process
        if (channelControllers.has(channelId) && channelControllers.get(channelId) !== controller) return

        activeBatches.delete(channelId)
        channelControllers.delete(channelId)

        // process any messages that piled up during processing
        if (pendingMessages.has(channelId)) {
            await this.processChannel(channelId)
        }
    }
}

export const bot = new Bot()