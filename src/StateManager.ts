import { appendToMessages, createInitialState } from "@openrouter/agent"
import type { StateAccessor, ConversationState } from "@openrouter/agent"
import { memoryManager } from "./MemoryManager.js"

class StateManager {
    private _states = new Map<string, ConversationState>()

    getStateAccessor(key: string): StateAccessor {
        return {
            load: async () => this._states.get(key) ?? this.initial(key),
            save: async (s) => { this._states.set(key, s) },
        }
    }

    initial(key: string) {
        const state = createInitialState(key)

        appendToMessages(state.messages, [{
            role: "stystem" as const,
            content: memoryManager.getChannelContext(key)
        }])

        return state
    }


    get(key: string): ConversationState | undefined {
        return this._states.get(key)
    }

    set(key: string, state: ConversationState) {
        this._states.set(key, state)
    }
}

export const stateManager = new StateManager()