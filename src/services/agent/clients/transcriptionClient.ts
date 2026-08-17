import BaseAIClient from "./baseAIClient.js";

export default class TranscriptionClient extends BaseAIClient {

    constructor(apiKey: string, apiUrl: string, private readonly model: string) {
        super("agent:transcription", apiKey, apiUrl);
    }

    public async transcribe(wav: Buffer, signal?: AbortSignal): Promise<string> {
        this.logger.log(`transcribing ${Math.round(wav.length / 1024)} KiB with ${this.model}`);
        const response = await this.post({
            model: this.model,
            messages: [{
                role: "user",
                content: [
                    {
                        type: "text",
                        text: "Transcribe the spoken audio exactly. Return only JSON with a transcript string. Use an empty string when there is no intelligible speech.",
                    },
                    {
                        type: "input_audio",
                        input_audio: {
                            data: wav.toString("base64"),
                            format: "wav",
                        },
                    },
                ],
            }],
            response_format: {
                type: "json_schema",
                json_schema: {
                    name: "audio_transcription",
                    strict: true,
                    schema: {
                        type: "object",
                        properties: { transcript: { type: "string" } },
                        required: ["transcript"],
                        additionalProperties: false,
                    },
                },
            },
            temperature: 0,
            max_tokens: 512,
        }, signal, "transcription");

        const data = (await response.json()) as any;
        const content = data.choices?.[0]?.message?.content;
        if (typeof content !== "string") throw new Error("transcription API returned no text");

        const trimmed = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
        try {
            const parsed = JSON.parse(trimmed);
            return typeof parsed.transcript === "string" ? parsed.transcript.trim() : "";
        } catch {
            return trimmed.replace(/^(["'])|(["'])$/g, "").trim();
        }
    }
}
