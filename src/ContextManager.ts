export interface Context {
    messageQueue: QueuedMessage[]
    timeouts: NodeJS.Timeout[]
    recentMessageIds: string[]
}

export interface QueuedMessage {
    queuedAt: number // NOT MESSAGE ID, ITS AN IDENTIFIER TO REMOVE IT
    sendAt: number,
    content: string,
    replyTo: string
}

const MAX_RECENT = 10

class ContextManager {
    private _contexts: Record<string, Context> = {}

    private readonly default: Context = {
        messageQueue: [],
        timeouts: [],
        recentMessageIds: [],
    }

    get(channelId: string): Context {
        if (!this._contexts[channelId]) {
            this._contexts[channelId] = { ...this.default, recentMessageIds: [] }
        }
        return this._contexts[channelId]
    }

    clearTimeouts(channelId: string) {
        const ctx = this._contexts[channelId]
        if (ctx) {
            ctx.timeouts.forEach((t) => clearTimeout(t))
            ctx.timeouts = []
        }
    }

    addTimeout(channelId: string, timeout: NodeJS.Timeout) {
        const ctx = this.get(channelId)
        ctx.timeouts.push(timeout)
    }

    addMessageToQueue(channelId: string, message: QueuedMessage) {
        const ctx = this.get(channelId)
        ctx.messageQueue.push(message)
    }

    trackSentMessage(channelId: string, messageId: string) {
        const ctx = this.get(channelId)
        ctx.recentMessageIds.push(messageId)
        if (ctx.recentMessageIds.length > MAX_RECENT) {
            ctx.recentMessageIds.shift()
        }
    }

    getRecentMessageIds(channelId: string): string[] {
        return this.get(channelId).recentMessageIds
    }
}

export const contextManager = new ContextManager()