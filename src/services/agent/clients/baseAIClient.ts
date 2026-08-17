import { Logger } from "../../../util/logger.js";

export default abstract class BaseAIClient {

    protected readonly logger: Logger;

    constructor(
        name: string,
        protected readonly apiKey: string,
        protected readonly apiUrl: string,
    ) {
        this.logger = new Logger(name);
    }

    protected async post(body: Record<string, unknown>, signal: AbortSignal | undefined, operation: string): Promise<Response> {
        const response = await fetch(`${this.apiUrl}/chat/completions`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify(body),
            signal,
        });

        if (!response.ok) {
            const text = await response.text();
            this.logger.error(`${operation} API error ${response.status}: ${text}`);
            throw new Error(`${operation} API error ${response.status}: ${text}`);
        }
        return response;
    }
}
