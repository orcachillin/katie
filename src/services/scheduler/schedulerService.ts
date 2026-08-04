import AbstractService from "../../base/abstractService.js";
import Core from "../../core.js";
import { QueryOrder } from "@mikro-orm/core";
import { ScheduledPrompt } from "../../database/entities/ScheduledPrompt.entity.js";

const POLL_INTERVAL = 5000;
const MAX_BATCH_SIZE = 20;

export interface SchedulePromptInput {
    channelId: string;
    userId: string;
    username: string;
    messageId: string;
    prompt: string;
    dueAt: Date;
}

export default class SchedulerService extends AbstractService<"scheduler"> {

    private active = false;
    private timer?: NodeJS.Timeout;
    private polling?: Promise<void>;

    constructor() {
        super("scheduler");
    }

    public async init(): Promise<void> {
        this.active = true;
        this.schedulePoll(1000);
    }

    public async destroy(): Promise<void> {
        this.active = false;
        if (this.timer) clearTimeout(this.timer);
        await this.polling;
    }

    public async schedule(input: SchedulePromptInput): Promise<string> {
        const em = Core.database.orm.em.fork();
        const scheduledPrompt = em.create(ScheduledPrompt, {
            ...input,
            nextAttemptAt: input.dueAt,
        });
        em.persist(scheduledPrompt);
        await em.flush();
        this.wake();
        return scheduledPrompt.id;
    }

    private wake(): void {
        if (!this.active || this.polling) return;
        if (this.timer) clearTimeout(this.timer);
        this.schedulePoll(0);
    }

    private schedulePoll(delay: number): void {
        if (!this.active) return;
        this.timer = setTimeout(() => {
            this.polling = this.poll()
                .catch(err => this.logger.error(`poll failed: ${err.message}`))
                .finally(() => {
                    this.polling = undefined;
                    this.schedulePoll(POLL_INTERVAL);
                });
        }, delay);
    }

    private async poll(): Promise<void> {
        if (!Core.services.bot) return;

        const em = Core.database.orm.em.fork();
        const rows = await em.find(ScheduledPrompt, {
            nextAttemptAt: { $lte: new Date() },
        }, {
            orderBy: { nextAttemptAt: QueryOrder.ASC },
            limit: MAX_BATCH_SIZE,
        });

        for (const row of rows) {
            if (!this.active) return;
            try {
                const delivered = await Core.services.bot.processScheduledPrompt(row);
                if (!delivered) throw new Error("channel is busy; scheduled prompt was deferred");

                em.remove(row);
                await em.flush();
                this.logger.log(`delivered scheduled prompt ${row.id}`);
            } catch (err: any) {
                row.attempts++;
                const retryDelay = Math.min(300_000, 15_000 * (2 ** Math.min(row.attempts - 1, 5)));
                row.lastError = String(err?.message ?? err).slice(0, 2000);
                row.nextAttemptAt = new Date(Date.now() + retryDelay);
                await em.flush();
                this.logger.warn(`scheduled prompt ${row.id} failed; retrying in ${retryDelay}ms: ${err?.message ?? err}`);
            }
        }
    }
}
