import { Message } from "discord.js-selfbot-v13";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export enum MemoryType {
    User,
    Channel,
    Self
}

class MemoryManager {

    private readonly MEMORY_PATH = resolve("./workspace/memory/")

    private channelCache: Record<string, string[]> = {}

    init() {
        mkdirSync(resolve(this.MEMORY_PATH, "user"), { recursive: true })
        mkdirSync(resolve(this.MEMORY_PATH, "channel"), { recursive: true })
        mkdirSync(resolve(this.MEMORY_PATH, "self"), { recursive: true })

        try {
            let channelCacheFile = readFileSync(resolve(this.MEMORY_PATH, "channel/people.json"), "utf-8")
            this.channelCache = JSON.parse(channelCacheFile)
        } catch {
            this.channelCache = {}
            writeFileSync(resolve(this.MEMORY_PATH, "channel/people.json"), "{}")
        }
    }

    onMessage(message: Message) {
        if (!this.channelCache[message.channelId]) {
            this.channelCache[message.channelId] = []
        }
        if (!this.channelCache[message.channelId].includes(message.author.id)) {
            this.channelCache[message.channelId].push(message.author.id)
            writeFileSync(resolve(this.MEMORY_PATH, "channel/people.json"), JSON.stringify(this.channelCache), "utf-8")
        }
    }

    getChannelContext(channelId: string) {
        const channelInfoPath = resolve(this.MEMORY_PATH, "channel", channelId, "info.md")
        let channelInfo = ""
        try {
            channelInfo = readFileSync(channelInfoPath, "utf8")
        } catch { }

        const channelContext = channelInfo || "no information on this channel yet"

        const peopleContext: string[] = []
        for (const userId of (this.channelCache[channelId] ?? [])) {
            const userFilePath = resolve(this.MEMORY_PATH, "user", userId, "info.md")
            let userInfo = ""
            try {
                userInfo = readFileSync(userFilePath, "utf-8")
            } catch { }

            peopleContext.push(userInfo || "no information on this user yet")
        }

        const res: string[] = [channelContext, ...peopleContext]

        return res.join("\n\n---\n\n")
    }

    writeMemoryFile(type: MemoryType.Channel | MemoryType.User, id: string, name: string, content: string): void
    writeMemoryFile(type: MemoryType.Self, name: string, content?: string): void
    writeMemoryFile(type: MemoryType, id: string, name: string, content?: string): void {
        const dir = { [MemoryType.Channel]: "channel" as const, [MemoryType.User]: "user" as const, [MemoryType.Self]: "self" as const }[type]
        const savePath = type == MemoryType.Self ? resolve(this.MEMORY_PATH, dir, `${id}.md`) : resolve(this.MEMORY_PATH, dir, id, `${name}.md`)
        mkdirSync(dirname(savePath), { recursive: true })
        writeFileSync(savePath, type == MemoryType.Self ? name : content as string, "utf-8")
    }

    readMemoryFile(type: MemoryType.Channel | MemoryType.User, id: string, name: string): string | null
    readMemoryFile(type: MemoryType.Self, name: string): string | null
    readMemoryFile(type: MemoryType, id: string, name?: string): string | null {
        const dir = { [MemoryType.Channel]: "channel" as const, [MemoryType.User]: "user" as const, [MemoryType.Self]: "self" as const }[type]
        const savePath = type == MemoryType.Self
            ? resolve(this.MEMORY_PATH, dir, `${id}.md`)
            : resolve(this.MEMORY_PATH, dir, id, `${name!}.md`)

        try {
            return readFileSync(savePath, "utf-8")
        } catch {
            return "this memory doesnt exist yet, use memory to save something!"
        }
    }

    writeUserInfoFile(id: string, info: {
        username: string,
        displayName: string,
        preferredName: string,
        pronouns: string,
        dmChannelId: string,
        details: string
    }) {
        this.writeMemoryFile(MemoryType.User, id, "info", [
            '---',
            `user info for user: ${id}\n`,
            ...Object.entries(info as Record<string, string>)
                .filter(([v]) => v != "details")
                .map(v => v.join(": ")),
            '\n---\n',
            info.details
        ].join("\n"))
    }

    writeChannelInfoFile(id: string, info: {
        topic: string,
        guildName: string,
        details: string
    }) {
        this.writeMemoryFile(MemoryType.Channel, id, "info", [
            '---',
            `channel info for channel: ${id}\n`,
            ...Object.entries(info as Record<string, string>)
                .filter(([v]) => v != "details")
                .map(v => v.join(": ")),
            '\n---\n',
            info.details
        ].join("\n"))
    }

    readUserInfoFile(id: string): string | null {
        return this.readMemoryFile(MemoryType.User, id, "info")
    }

    readChannelInfoFile(id: string): string | null {
        return this.readMemoryFile(MemoryType.Channel, id, "info")
    }

    /** list all files in a directory */
    listFiles(dir: string): string[] {
        const full = resolve(this.MEMORY_PATH, dir)
        try {
            return readdirSync(full).filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, ""))
        } catch {
            return []
        }
    }

    /** list all files in a users memory dir */
    listUserMemories(userId: string): string[] {
        return this.listFiles(`user/${userId}`)
    }

    /** list all self memories */
    listSelfMemories(): string[] {
        return this.listFiles("self")
    }
}

export const memoryManager = new MemoryManager()