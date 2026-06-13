import { tool } from "@openrouter/sdk/lib/tool.js"
import { createInitialState, appendToMessages } from "@openrouter/agent"
import z from "zod"
import { channelManager } from "../ChannelManager.js"
import { stateManager } from "../StateManager.js"
import { openRouter } from "../deps.js"
import type { ConversationState } from "@openrouter/agent"
import { agent } from "../Agent.js"
import { promptManager } from "../PromptManager.js"

function formatMessages(messages: unknown): string {
    if (typeof messages === "string") return messages
    if (!Array.isArray(messages)) return JSON.stringify(messages)

    return messages
        .map((m) => {
            if (typeof m === "string") return m
            const msg = m as { role?: string; content?: unknown }
            const role = msg.role ?? "unknown"
            let content = msg.content
            if (typeof content === "string") return `${role}: ${content}`
            if (Array.isArray(content)) {
                return `${role}: ${content
                    .map((p: Record<string, unknown>) => p.text ?? p.type ?? JSON.stringify(p))
                    .join(" ")}`
            }
            return `${role}: ${JSON.stringify(content)}`
        })
        .join("\n")
}

export const crosspost = tool({
    name: "crosspost",
    description: "post in another channel",
    inputSchema: z.object({
        fromChannelId: z.string().describe("current channel id, just the digits"),
        channelId: z.string().describe("channel id, just the digits"),
        content: z.string().describe("content to send"),
    }),
    outputSchema: z.any(),
    execute: async (params: Record<string, unknown>) => {
        const channel = channelManager.get(params.channelId as string)

        if (!channel) {
            return "ERROR: failed to find channel, make sure you run fetchChannel first"
        }

        const fromState = stateManager.get(params.fromChannelId as string)
        let toState = stateManager.get(channel.id)

        if (fromState) {
            const formatted = formatMessages(fromState.messages)

            // get context 

            const result = openRouter.callModel({
                model: "minimax/minimax-m3",
                instructions:
                    promptManager.get("crosspost"),
                input: [
                    {
                        role: "user" as const,
                        content: `conversation history:\n${formatted}\n\ncrosspost content:\n${params.content}`,
                    },
                ],
            })

            const context = await result.getText()

            const contextMsg = {
                role: "user" as const,
                content: `[context from ${params.fromChannelId}]: ${context}\n[to respond, use crosspost back to channel]: ${channel.id}`,
            }

            if (toState) {
                toState.messages = appendToMessages(toState.messages, [contextMsg])
            } else {
                toState = createInitialState(channel.id) as ConversationState
                toState.messages = [contextMsg]
            }
            stateManager.set(channel.id, toState)
        }


        if (toState) {
            const formatted = formatMessages(toState.messages)

            // get context 

            const result = openRouter.callModel({
                model: "minimax/minimax-m3",
                instructions:
                    promptManager.get("crosspostReformat"),
                input: [
                    {
                        role: "user" as const,
                        content: `conversation history:\n${formatted}\n\ncrosspost content:\n${params.content}`,
                    },
                ],
            })

            const content = await result.getText()

            toState.messages = appendToMessages(toState.messages, [{
                role: "assistant" as const,
                content,
            }])
            stateManager.set(channel.id, toState)

            return await channel.send({
                content,
            })
        } else {
            return await channel.send({
                content: params.content as string
            })
        }
    },
})