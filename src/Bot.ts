import { TextChannel } from "discord.js-selfbot-v13"
import { client } from "./deps.js"
import { channelManager } from "./ChannelManager.js"
import { promptManager } from "./PromptManager.js"
import { toolLoader } from "./ToolLoader.js"
import { agent } from "./Agent.js"
import { memoryManager } from "./MemoryManager.js"

class Bot {
    async start() {
        promptManager.loadAll()
        await toolLoader.loadAll()
        memoryManager.init()

        client.on("ready", async () => {
            console.log(`${client.user!.username} is ready!`)
            await channelManager.load()
        })

        client.on("error", (err) => console.error(err))

        client.on("messageCreate", async (message) => {
            if (message.author.id === client.user!.id) return
            if (message.author.bot) return
            memoryManager.onMessage(message)
            channelManager.add(message.channelId, message.channel as TextChannel)
            await agent.handleMessage(message)
        })

        client.login(process.env.TOKEN)
    }
}

export const bot = new Bot()