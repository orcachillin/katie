import { Response } from "express";
import AbstractService from "../../base/abstractService.js";
import { Session } from "../../database/entities/Session.entity.js";
import SSEChannel, { ChannelConfig } from "./sseChannel.js";
import Core from "../../core.js";

export default class SSEService extends AbstractService<"sse"> {

    private channels: SSEChannel[] = []

    constructor() {
        super("sse");
    }

    public async init(): Promise<void> {
        Core.services.web.app.get("/events/:channel", async (req, res) => {
            const channelId = req.params.channel
            const session = Core.services.context.get<Session>("session");

            const channel = this.findChannel(channelId);
            if (!channel) {
                res.status(404).send(`No channel [${channelId}] registered`);
                return;
            }

            if (channel.config.permissionCheck) {
                if (!session) {
                    res.status(401).end();
                    return;
                }
                const allowed = await channel.config.permissionCheck(session, channelId.match(channel.config.pattern)?.groups ?? {});
                if (!allowed) {
                    res.status(401).send(`You are not authorized to connect to channel [${channelId}]`);
                    this.logger.warn(`Session(${session.id}) tried to connect to Channel(${channelId}) but is not permitted to.`);
                    return;
                }
            }

            channel.addClient(channelId, session ?? { id: "anon" } as any, res);

            res.writeHead(200, {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
            });

            // send an initial comment to flush headers
            res.write(": connected\n\n");

            // keepalive ping every 30 seconds to prevent proxy timeouts
            const keepalive = setInterval(() => {
                res.write(": keepalive\n\n");
            }, 30000);

            res.on("close", () => {
                clearInterval(keepalive);
                channel.removeClient((session ?? { id: "anon" }).id, res);
            });
        });

    }

    private findChannel(channelId: string): SSEChannel | undefined {
        return this.channels.find(c => c.matches(channelId));
    }

    public registerChannel(config: ChannelConfig, id?: string): SSEChannel {
        const entity = new SSEChannel(config, id);
        this.channels.push(entity);
        return entity;
    }

    public async addClient(channelId: string, session: Session, res: Response): Promise<boolean> {
        for (const channel of this.channels) {
            const match = channel.matches(channelId);
            if (!match) continue;

            if (channel.config.permissionCheck) {
                const allowed = await channel.config.permissionCheck(session, match.groups ?? {});
                if (!allowed) return false;
            }

            channel.addClient(channelId, session, res);

            res.on("close", () => channel.removeClient(session.id, res));
            return true;
        }
        return false;
    }

    public sendToChannel(channelId: string, event: string, data: string): void {
        for (const channel of this.channels) {
            if (!channel.matches(channelId)) continue;
            channel.send(event, data);
        }
    }

    public sendToSession(channelId: string, sessionId: string, event: string, data: string): void {
        for (const channel of this.channels) {
            if (!channel.matches(channelId)) continue;
            channel.sendToSession(sessionId, event, data);
        }
    }

    public broadcast(event: string, data: string): void {
        for (const channel of this.channels) {
            channel.send(event, data);
        }
    }

    public get connectionCount(): number {
        let count = 0;
        for (const channel of this.channels) {
            count += channel.connectionCount;
        }
        return count;
    }

}