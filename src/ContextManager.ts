class ContextManager {
    private _contexts: Record<string, { timeouts: NodeJS.Timeout[] }> = {}

    get(channelId: string): { timeouts: NodeJS.Timeout[] } {
        if (!this._contexts[channelId]) {
            this._contexts[channelId] = { timeouts: [] }
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
}

export const contextManager = new ContextManager()