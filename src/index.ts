process.on("unhandledRejection", (reason) => {
    if ((reason as Error)?.name === "AbortError" || (reason as Error)?.name === "RequestAbortedError") return
    console.error("Unhandled rejection:", reason)
})

import { bot } from "./Bot.js"

bot.start()