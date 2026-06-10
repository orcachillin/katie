export interface Context {
    messageQueue: QueuedMessage[]
    timeouts: NodeJS.Timeout[]
}

export interface QueuedMessage {
    queuedAt: number // NOT MESSAGE ID, ITS AN IDENTIFIER TO REMOVE IT
    sendAt: number,
    content: string,
    replyTo: string
}

class ContextManager {
    private _contexts: Record<string, Context> = {}

    private readonly default: Context = {
        messageQueue: [],
        timeouts: []
    }

    get(channelId: string): Context {
        if (!this._contexts[channelId]) {
            this._contexts[channelId] = { ...this.default }
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
}

export const contextManager = new ContextManager()