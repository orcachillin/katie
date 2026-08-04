import AbstractService from "../../base/abstractService.js";
import Core from "../../core.js";
import { ChannelActivity } from "../../database/entities/ChannelActivity.entity.js";

const DEFAULT_INTERVAL = 30 * 60 * 1000;
const DEFAULT_CHANCE = 0.1;
const DEFAULT_COOLDOWN = 6 * 60 * 60 * 1000;
const DEFAULT_ACTIVE_WINDOW = 24 * 60 * 60 * 1000;

export interface ChannelActivityInput {
    channelId: string;
    userId: string;
    username: string;
    messageId: string;
    lastMessageAt: Date;
}

export default class IncentiveService extends AbstractService<"incentive"> {

    private active = false;
    private timer?: NodeJS.Timeout;
    private checking?: Promise<void>;
    private readonly interval = this.readNumber("INCENTIVE_INTERVAL_MS", DEFAULT_INTERVAL, 1000);
    private readonly chance = this.readNumber("INCENTIVE_CHANCE", DEFAULT_CHANCE, 0, 1);
    private readonly cooldown = this.readNumber("INCENTIVE_COOLDOWN_MS", DEFAULT_COOLDOWN, 0);
    private readonly activeWindow = this.readNumber("INCENTIVE_ACTIVE_WINDOW_MS", DEFAULT_ACTIVE_WINDOW, 60_000);

    constructor() {
        super("incentive");
    }

    public async init(): Promise<void> {
        this.active = true;
        this.scheduleCheck(this.interval);
        this.logger.log(`checking every ${this.interval}ms with a ${this.chance * 100}% chance`);
    }

    public async destroy(): Promise<void> {
        this.active = false;
        if (this.timer) clearTimeout(this.timer);
        await this.checking;
    }

    public async recordActivity(input: ChannelActivityInput): Promise<void> {
        const em = Core.database.orm.em.fork();
        await em.upsert(ChannelActivity, input);
    }

    private scheduleCheck(delay: number): void {
        if (!this.active) return;
        this.timer = setTimeout(() => {
            this.checking = this.check()
                .catch(err => this.logger.error(`check failed: ${err?.message ?? err}`))
                .finally(() => {
                    this.checking = undefined;
                    this.scheduleCheck(this.interval);
                });
        }, delay);
    }

    private async check(): Promise<void> {
        if (!Core.services.bot || Math.random() >= this.chance) return;

        const now = new Date();
        const em = Core.database.orm.em.fork();
        const candidates = await em.find(ChannelActivity, {
            lastMessageAt: { $gte: new Date(now.getTime() - this.activeWindow) },
            $or: [
                { lastIncentiveAt: null },
                { lastIncentiveAt: { $lte: new Date(now.getTime() - this.cooldown) } },
            ],
        });
        if (candidates.length === 0) return;

        const selected = candidates[Math.floor(Math.random() * candidates.length)];
        selected.lastIncentiveAt = now;
        await em.flush();

        try {
            const delivered = await Core.services.bot.processIncentive({
                channelId: selected.channelId,
                userId: selected.userId,
                username: selected.username,
                messageId: selected.messageId,
                lastMessageAt: selected.lastMessageAt,
            });
            this.logger.log(delivered
                ? `sent incentive in channel ${selected.channelId}`
                : `skipped incentive in channel ${selected.channelId}`
            );
        } catch (err: any) {
            this.logger.warn(`incentive failed in channel ${selected.channelId}: ${err?.message ?? err}`);
        }
    }

    private readNumber(name: string, fallback: number, min: number, max = Number.POSITIVE_INFINITY): number {
        const value = Number(process.env[name]);
        return Number.isFinite(value) && value >= min && value <= max ? value : fallback;
    }
}
