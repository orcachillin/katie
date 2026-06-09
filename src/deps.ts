import "dotenv/config"
import { Client } from "discord.js-selfbot-v13"
import { OpenRouter } from "@openrouter/agent"

export const client = new Client()
export const openRouter = new OpenRouter({
    apiKey: process.env.OPENROUTER_KEY,
})

