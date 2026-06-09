import { TextChannel } from "discord.js-selfbot-v13"
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { resolve } from "node:path"
import { client } from "./deps.js"

const CHANNELS_PATH = resolve("./workspace/channels.json")

class ChannelManager {
    private _channels: Record<string, TextChannel> = {}

    get channels(): Record<string, TextChannel> {
        return this._channels
    }

    add(id: string, channel: TextChannel) {
        this._channels[id] = channel
        this.save()
    }

    get(id: string): TextChannel | undefined {
        return this._channels[id]
    }

    save() {
        const ids = Object.keys(this._channels)
        writeFileSync(CHANNELS_PATH, JSON.stringify(ids, null, 2))
    }

    async load() {
        if (!existsSync(CHANNELS_PATH)) return
        const ids: string[] = JSON.parse(readFileSync(CHANNELS_PATH, "utf-8"))
        for (const id of ids) {
            try {
                const channel = await client.channels.fetch(id)
                if (channel && channel.isText()) {
                    this._channels[channel.id] = channel as TextChannel
                }
            } catch {
                console.log(`couldn't restore channel ${id}, skipping`)
            }
        }
        console.log(`loaded ${Object.keys(this._channels).length} channels`)
    }
}

export const channelManager = new ChannelManager()