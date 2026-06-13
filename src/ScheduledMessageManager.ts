import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { TextChannel } from "discord.js-selfbot-v13"
import { client } from "./deps.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const SCHEDULED_PATH = resolve(__dirname, "..", "workspace", "scheduled.json")

export interface ScheduledMessage {
    id: string
    channelId: string
    content: string
    sendAt: number
    replyTo?: string
    createdAt: number
}

class ScheduledMessageManager {
    private _scheduled: Map<string, ScheduledMessage> = new Map()
    private _timeouts: Map<string, NodeJS.Timeout> = new Map()
    private _loaded = false

    get all(): ScheduledMessage[] {
        return Array.from(this._scheduled.values()).sort((a, b) => a.sendAt - b.sendAt)
    }

    get(id: string): ScheduledMessage | undefined {
        return this._scheduled.get(id)
    }

    schedule(channelId: string, content: string, sendAt: number, replyTo?: string): ScheduledMessage {
        const id = `sched_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
        const msg: ScheduledMessage = { id, channelId, content, sendAt, replyTo, createdAt: Date.now() }
        this._scheduled.set(id, msg)
        this._setTimeout(msg)
        this._save()
        console.log(`scheduled message ${id} for ${new Date(sendAt).toISOString()}`)
        return msg
    }

    edit(id: string, content?: string, sendAt?: number): ScheduledMessage | null {
        const msg = this._scheduled.get(id)
        if (!msg) return null
        if (content !== undefined) msg.content = content
        if (sendAt !== undefined) {
            msg.sendAt = sendAt
            const existing = this._timeouts.get(id)
            if (existing) clearTimeout(existing)
            this._setTimeout(msg)
        }
        this._save()
        return msg
    }

    remove(id: string): boolean {
        const existing = this._timeouts.get(id)
        if (existing) {
            clearTimeout(existing)
            this._timeouts.delete(id)
        }
        const ok = this._scheduled.delete(id)
        if (ok) this._save()
        return ok
    }

    async load() {
        if (this._loaded) return
        this._loaded = true

        if (!existsSync(SCHEDULED_PATH)) return

        try {
            const raw = readFileSync(SCHEDULED_PATH, "utf-8")
            const items = JSON.parse(raw) as ScheduledMessage[]
            const now = Date.now()
            for (const item of items) {
                if (item.sendAt <= now) continue
                this._scheduled.set(item.id, item)
                this._setTimeout(item)
            }
            console.log(`loaded ${this._scheduled.size} pending scheduled messages`)
        } catch (err) {
            console.error("failed to load scheduled messages:", err)
        }
    }

    private _setTimeout(msg: ScheduledMessage) {
        const delay = msg.sendAt - Date.now()
        if (delay <= 0) return

        const timeout = setTimeout(async () => {
            try {
                const channel = await client.channels.fetch(msg.channelId) as TextChannel
                if (msg.replyTo) {
                    try {
                        const replyMessage = await channel.messages.fetch(msg.replyTo)
                        await replyMessage.reply({ content: msg.content }).catch(() => { })
                    } catch {
                        await channel.send({ content: msg.content }).catch(() => { })
                    }
                } else {
                    await channel.send({ content: msg.content }).catch(() => { })
                }
            } catch (err) {
                console.error(`failed to send scheduled message ${msg.id}:`, err)
            }
            this._scheduled.delete(msg.id)
            this._timeouts.delete(msg.id)
            this._save()
        }, delay)

        this._timeouts.set(msg.id, timeout)
    }

    private _save() {
        try {
            const dir = dirname(SCHEDULED_PATH)
            if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
            writeFileSync(SCHEDULED_PATH, JSON.stringify(this.all, null, 2))
        } catch (err) {
            console.error("failed to save scheduled messages:", err)
        }
    }
}

export const scheduledMessageManager = new ScheduledMessageManager()