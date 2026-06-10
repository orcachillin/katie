import { Message } from "discord.js-selfbot-v13";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export enum MemoryType {
    User,
    Channel,
    Self
}

class MemoryManager {

    private readonly MEMORY_PATH = resolve("./workspace/memory/")

    private channelCache: Record<string, string[]> = {}

    init() {
        mkdirSync(resolve(this.MEMORY_PATH, "user"))
        mkdirSync(resolve(this.MEMORY_PATH, "channel"))
        mkdirSync(resolve(this.MEMORY_PATH, "self"))

        let channelCacheFile = readFileSync(resolve(this.MEMORY_PATH, "channel/people.json"), "utf-8")

        if (!channelCacheFile) {
            this.channelCache = {}
            writeFileSync(resolve(this.MEMORY_PATH, "channel/people.json"), "{}")
        } else {
            this.channelCache = JSON.parse(channelCacheFile)
        }

    }

    onMessage(message: Message) {
        if (!this.channelCache[message.channelId]) {
            this.channelCache[message.channelId] = [message.author.id]
            writeFileSync(resolve(this.MEMORY_PATH, "channel/people.json"), JSON.stringify(this.channelCache), "utf-8")
        }
    }

    getChannelContext(channelId: string) {
        const channelInfoPath = resolve(this.MEMORY_PATH, "channel", channelId, "info.md")
        const channelInfo = readFileSync(channelInfoPath, "utf8")

        const channelContext = channelInfo || "no information on  this channel yet"

        const peopleContext: string[] = []
        for (const userId of this.channelCache[channelId]) {
            const userFilePath = resolve(this.MEMORY_PATH, "user", userId, "info.md")
            const userInfo = readFileSync(userFilePath, "utf-8")

            if (userInfo.length > 0) {
                peopleContext.push(userInfo)
            } else {
                peopleContext.push("no information on this user yet")
            }
        }

        const res: string[] = [channelContext, ...peopleContext]

        return res.join("\n\n---\n\n")
    }

    writeMemoryFile(type: MemoryType.Channel | MemoryType.User, id: string, name: string, content: string): void
    writeMemoryFile(type: MemoryType.Self, name: string, content?: string): void
    writeMemoryFile(type: MemoryType, id: string, name: string, content?: string): void {
        const dir = { [MemoryType.Channel]: "channel" as const, [MemoryType.User]: "user" as const, [MemoryType.Self]: "self" as const }[type]
        const savePath = type == MemoryType.Self ? resolve(this.MEMORY_PATH, dir, `${id}.md`) : resolve(this.MEMORY_PATH, dir, id, `${name}.md`)
        writeFileSync(savePath, type == MemoryType.Self ? name : content as string, "utf-8")
    }


}

export const memoryManager = new MemoryManager()