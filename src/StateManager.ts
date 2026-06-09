import { createInitialState } from "@openrouter/agent"
import type { StateAccessor, ConversationState } from "@openrouter/agent"

class StateManager {
    private _states = new Map<string, ConversationState>()

    getStateAccessor(key: string): StateAccessor {
        return {
            load: async () => this._states.get(key) ?? createInitialState(key),
            save: async (s) => { this._states.set(key, s) },
        }
    }

    get(key: string): ConversationState | undefined {
        return this._states.get(key)
    }

    set(key: string, state: ConversationState) {
        this._states.set(key, state)
    }
}

export const stateManager = new StateManager()