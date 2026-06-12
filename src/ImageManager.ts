import { openRouter } from "./deps.js"
import type { Message } from "discord.js-selfbot-v13"
import { promptManager } from "./PromptManager.js"

const VISION_MODEL = "qwen/qwen3.5-flash-02-23"

class ImageManager {
    /** download attachments and get text descriptions from a vision model */
    async describeImages(message: Message, attempt: number = 1): Promise<string> {
        const images = message.attachments.filter((a) => a.contentType?.startsWith("image/"))
        if (images.size === 0) return ""

        const descriptions: string[] = []

        for (const att of images.values()) {
            let imageUri: string

            try {
                const resp = await fetch(att.url)
                if (!resp.ok) {
                    console.log(`image fetch failed: ${resp.status} ${resp.statusText}`)
                    continue
                }
                const buf = await resp.arrayBuffer()
                const base64 = Buffer.from(buf).toString("base64")
                imageUri = `data:${att.contentType};base64,${base64}`
                console.log(`downloaded ${att.name}: ${buf.byteLength} bytes`)
            } catch (e) {
                console.log(`failed to download ${att.url}:`, e)
                continue
            }

            try {
                const result = openRouter.callModel({
                    model: VISION_MODEL,
                    instructions: promptManager.get("image"),
                    input: [{
                        role: "user",
                        content: [{
                            type: "input_image",
                            imageUrl: imageUri,
                            detail: "auto",
                        }],
                    }],
                })

                const desc = await result.getText()
                const cleaned = desc.replaceAll(/```(\w+)?/g, "").trim()
                descriptions.push(`[image: ${att.name}]\n${cleaned}`)
                console.log(`described ${att.name}: ${cleaned.length} chars`)
            } catch (e) {
                if (attempt < 3) {
                    return this.describeImages(message, attempt + 1)
                }

                console.log(`failed to describe ${att.name}:`, e)
                descriptions.push(`[image: ${att.name}]\n(a image was attached but could not be described)`)
            }
        }

        if (descriptions.length === 0) return ""
        return `\n\nimage descriptions:\n${descriptions.join("\n\n")}`
    }
}

export const imageManager = new ImageManager()