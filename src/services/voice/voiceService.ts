import {
    EndBehaviorType,
    NetworkingStatusCode,
    VoiceConnectionStatus,
    entersState,
    joinVoiceChannel,
    type DiscordGatewayAdapterCreator,
    type VoiceConnection,
    type VoiceWebSocket,
} from "@discordjs/voice";
import type { CallState, DMChannel, GroupDMChannel } from "discord.js-selfbot-v13";
import OpusScript from "opusscript";
import AbstractService from "../../base/abstractService.js";
import Core from "../../core.js";
import Id from "../../util/id.js";

const CONNECTION_TIMEOUT = 20_000;
const DEFAULT_INCOMING_DELAY_MIN = 2_500;
const DEFAULT_INCOMING_DELAY_MAX = 7_000;
const DEFAULT_TRANSCRIPTION_CHUNK_MS = 3_000;
const DEFAULT_UTTERANCE_SILENCE_MS = 250;
const DEFAULT_EMPTY_CALL_GRACE_MS = 1_000;
const MIN_UTTERANCE_PACKETS = 10;
const MIN_SPEECH_PEAK = 500;
const MIN_SPEECH_RMS = 100;

type PrivateCallChannel = DMChannel | GroupDMChannel;

interface ActiveCall {
    capturing: Set<string>;
    channelId: string;
    connection: VoiceConnection;
    emptyCallTimeout?: NodeJS.Timeout;
    packetsReceived: number;
    participants: Set<string>;
    processingQueue: Promise<void>;
    startedAt: number;
    label: string;
    usernames: Map<string, string>;
    timeout?: NodeJS.Timeout;
    onSpeaking: (userId: string) => void;
    onVoicePacket?: (packet: any) => void;
    voiceWebSocket?: VoiceWebSocket;
}

interface PendingIncomingCall {
    timeout: NodeJS.Timeout;
    userId: string;
}

export default class VoiceService extends AbstractService<"voice"> {

    private activeCall?: ActiveCall;
    private pendingIncomingCalls = new Map<string, PendingIncomingCall>();
    private ignoredIncomingCalls = new Set<string>();
    private readonly incomingDelayMin = this.readNumber("INCOMING_CALL_DELAY_MIN_MS", DEFAULT_INCOMING_DELAY_MIN, 0);
    private readonly incomingDelayMax = Math.max(
        this.incomingDelayMin,
        this.readNumber("INCOMING_CALL_DELAY_MAX_MS", DEFAULT_INCOMING_DELAY_MAX, 0),
    );

    private readonly transcriptionChunkMs = this.readNumber(
        "VOICE_TRANSCRIPTION_CHUNK_MS",
        DEFAULT_TRANSCRIPTION_CHUNK_MS,
        1_000,
        30_000,
    );
    private readonly utteranceSilenceMs = this.readNumber(
        "VOICE_UTTERANCE_SILENCE_MS",
        DEFAULT_UTTERANCE_SILENCE_MS,
        100,
        2_000,
    );
    private readonly emptyCallGraceMs = this.readNumber(
        "VOICE_EMPTY_CALL_GRACE_MS",
        DEFAULT_EMPTY_CALL_GRACE_MS,
        0,
        30_000,
    );
    private readonly onCallCreate = (call: CallState) => this.handleCallState(call);
    private readonly onCallUpdate = (call: CallState) => this.handleCallState(call);
    private readonly onCallDelete = (call: CallState) => this.handleCallDelete(call);

    constructor() {
        super("voice");
    }

    public async init(): Promise<void> {
        const client = Core.services.bot.getClient();
        client.on("callCreate", this.onCallCreate);
        client.on("callUpdate", this.onCallUpdate);
        client.on("callDelete", this.onCallDelete);
    }

    public async startCall(userId: string): Promise<string> {
        if (this.activeCall) {
            return `already in a call with ${this.activeCall.label}`;
        }

        const client = Core.services.bot.getClient();
        if (userId === client.user?.id) return "cannot call the current account";

        const user = await client.users.fetch(userId);
        const channel = await user.createDM();
        return this.connectCall(
            channel,
            "outgoing",
            new Map([[user.id, user.username]]),
            [],
            () => channel.ring(),
        );
    }

    public async startGroupCall(channelId: string, recipientIds?: string[]): Promise<string> {
        if (this.activeCall) return `already in a call with ${this.activeCall.label}`;

        const client = Core.services.bot.getClient();
        const channel = await client.channels.fetch(channelId);
        if (!channel || channel.type !== "GROUP_DM") return "channel is not an accessible Group DM";

        const selfId = client.user?.id;
        const users = new Map(
            [...channel.recipients.values()]
                .filter(user => user.id !== selfId)
                .map(user => [user.id, user.username]),
        );
        const ringingIds = recipientIds?.length ? [...new Set(recipientIds)] : [...users.keys()];
        const invalidId = ringingIds.find(id => !users.has(id));
        if (invalidId) return `user ${invalidId} is not in Group DM ${channel.id}`;
        if (!ringingIds.length) return "Group DM has no other users to call";

        return this.connectCall(
            channel,
            "outgoing",
            users,
            [],
            () => channel.ring(ringingIds),
        );
    }

    public stopCall(): string {
        if (!this.activeCall) {
            if (!this.pendingIncomingCalls.size) return "no active or incoming voice call";
            const pendingUserIds = [...this.pendingIncomingCalls.values()].map(pending => pending.userId);
            for (const channelId of this.pendingIncomingCalls.keys()) {
                this.ignoredIncomingCalls.add(channelId);
                this.cancelPendingIncomingCall(channelId, "declined by tool");
            }
            return `declined incoming voice call from user ${pendingUserIds.join(", ")}`;
        }
        const label = this.activeCall.label;
        this.finishCall(this.activeCall, "stopped by tool");
        return `ended voice call with ${label}`;
    }

    public async destroy(): Promise<void> {
        const client = Core.services.bot.getClient();
        client.off("callCreate", this.onCallCreate);
        client.off("callUpdate", this.onCallUpdate);
        client.off("callDelete", this.onCallDelete);
        for (const pending of this.pendingIncomingCalls.values()) clearTimeout(pending.timeout);
        this.pendingIncomingCalls.clear();
        this.ignoredIncomingCalls.clear();
        if (this.activeCall) this.finishCall(this.activeCall, "service shutdown");
    }

    private async connectCall(
        channel: PrivateCallChannel,
        direction: "incoming" | "outgoing",
        usernames: Map<string, string>,
        initialParticipants: Iterable<string>,
        ring?: () => Promise<void>,
    ): Promise<string> {
        if (this.activeCall) return `already in a call with ${this.activeCall.label}`;

        const label = channel.type === "DM"
            ? channel.recipient.username
            : channel.name || [...usernames.values()].join(", ") || channel.id;

        const connection = joinVoiceChannel({
            adapterCreator: this.createPrivateCallAdapter(channel),
            channelId: channel.id,
            daveEncryption: true,
            guildId: channel.id,
            group: "dm",
            selfDeaf: false,
            selfMute: false,
        });

        const call: ActiveCall = {
            capturing: new Set(),
            channelId: channel.id,
            connection,
            packetsReceived: 0,
            participants: new Set(initialParticipants),
            processingQueue: Promise.resolve(),
            startedAt: Date.now(),
            label,
            usernames,
            onSpeaking: () => undefined,
        };
        this.activeCall = call;

        call.onSpeaking = (speakingUserId) => {
            if (
                speakingUserId === Core.services.bot.getClient().user?.id ||
                this.activeCall !== call ||
                call.capturing.has(speakingUserId)
            ) return;

            call.capturing.add(speakingUserId);
            this.trackParticipantJoined(call, speakingUserId);
            const username = this.getParticipantUsername(call, speakingUserId);
            this.logger.log(`receiving audio from ${username} (${speakingUserId})`);
            const decoder = new OpusScript(48_000, 2, OpusScript.Application.VOIP);
            const transcriptionChunks: Promise<string>[] = [];
            let pcmChunks: Buffer[] = [];
            let pcmBytes = 0;
            let packetCount = 0;
            let finalized = false;
            const chunkBytes = 48_000 * 2 * 2 * this.transcriptionChunkMs / 1000;
            const flushChunk = () => {
                if (packetCount >= MIN_UTTERANCE_PACKETS && pcmBytes > 0) {
                    transcriptionChunks.push(this.queueTranscription(
                        call,
                        speakingUserId,
                        Buffer.concat(pcmChunks, pcmBytes),
                    ));
                }
                pcmChunks = [];
                pcmBytes = 0;
                packetCount = 0;
            };
            const stream = connection.receiver.subscribe(speakingUserId, {
                end: {
                    behavior: EndBehaviorType.AfterSilence,
                    duration: this.utteranceSilenceMs,
                },
            });
            stream.on("data", packet => {
                call.packetsReceived++;
                packetCount++;
                try {
                    const pcm = decoder.decode(packet);
                    pcmChunks.push(pcm);
                    pcmBytes += pcm.length;
                    if (pcmBytes >= chunkBytes) flushChunk();
                } catch (err: any) {
                    this.logger.warn(`Opus decode error: ${err?.message ?? err}`);
                }
            });
            stream.on("error", err => this.logger.warn(`audio receive error: ${err.message}`));

            const finalize = () => {
                if (finalized) return;
                finalized = true;
                call.capturing.delete(speakingUserId);
                decoder.delete();
                flushChunk();
                if (transcriptionChunks.length) {
                    this.queueTranscriptProcessing(call, speakingUserId, username, transcriptionChunks);
                }
            };
            stream.once("end", finalize);
            stream.once("close", finalize);
        };

        connection.receiver.speaking.on("start", call.onSpeaking);
        connection.on("error", err => {
            this.logger.error(`voice connection error: ${err.message}`);
            this.finishCall(call, "connection error");
        });
        connection.on("debug", message => this.logger.debug(message));
        connection.on("transitioned", transitionId => {
            this.logger.log(`DAVE transition ${transitionId} completed`);
        });

        try {
            await entersState(connection, VoiceConnectionStatus.Ready, CONNECTION_TIMEOUT);
            this.attachPrivateCallReceiveCompatibility(call);
            if (ring) await ring();
        } catch (err) {
            this.finishCall(call, "startup failed");
            throw err;
        }

        call.startedAt = Date.now();
        Core.services.bot.recordVoiceCallStarted({
            channelId: channel.id,
            userId: [...call.participants][0] ?? [...usernames.keys()][0],
            participantIds: [...call.participants],
            channelType: channel.type,
            direction,
            startedAt: new Date(call.startedAt),
        });

        this.logger.log(`${direction} voice call started in ${label} (${channel.id})`);
        return direction === "outgoing" ? `calling ${label}` : `answered voice call in ${label}`;
    }

    private handleCallState(call: CallState): void {
        const clientUserId = Core.services.bot.getClient().user?.id;
        if (!clientUserId || !call.ringing.has(clientUserId)) {
            this.cancelPendingIncomingCall(call.channelId, "ringing stopped");
            this.ignoredIncomingCalls.delete(call.channelId);
            return;
        }
        if (this.activeCall || this.pendingIncomingCalls.has(call.channelId) || this.ignoredIncomingCalls.has(call.channelId)) return;

        const channel = call.channel;
        if (!channel || (channel.type !== "DM" && channel.type !== "GROUP_DM")) {
            this.logger.log(`ignored incoming call in unsupported channel ${call.channelId}`);
            return;
        }

        const selfId = Core.services.bot.getClient().user?.id;
        const usernames = this.getChannelUsernames(channel);
        const connectedUserIds = [...channel.voiceUsers.keys()].filter(id => id !== selfId);
        const userId = connectedUserIds[0] ?? [...usernames.keys()][0];
        if (!userId) {
            this.logger.warn(`incoming call in ${channel.id} had no identifiable caller`);
            return;
        }
        const username = usernames.get(userId) ?? userId;
        const delay = this.incomingDelayMin + Math.random() * (this.incomingDelayMax - this.incomingDelayMin);
        const timeout = setTimeout(() => {
            this.pendingIncomingCalls.delete(call.channelId);
            const participants = [...channel.voiceUsers.keys()].filter(id => id !== selfId);
            if (this.activeCall || !participants.length) return;
            void this.connectCall(channel, "incoming", usernames, participants)
                .catch(err => this.logger.error(`failed to answer call from ${userId}: ${err?.message ?? err}`));
        }, delay);
        timeout.unref();
        this.pendingIncomingCalls.set(call.channelId, { timeout, userId });
        this.logger.log(`incoming call from ${username} (${userId}); answering in ${(delay / 1000).toFixed(1)}s`);
        void this.processVoiceEventWithRetry({
            channelId: call.channelId,
            userId,
            username,
            messageId: `voice-event-${Id.get()}`,
            event: "incomingCall",
            occurredAt: new Date(),
        });
    }

    private handleCallDelete(call: CallState): void {
        this.cancelPendingIncomingCall(call.channelId, "call ended");
        this.ignoredIncomingCalls.delete(call.channelId);
        if (this.activeCall?.channelId === call.channelId) {
            for (const userId of [...this.activeCall.participants]) {
                this.trackParticipantLeft(this.activeCall, userId);
            }
            this.finishCall(this.activeCall, "remote call ended");
        }
    }

    private cancelPendingIncomingCall(channelId: string, reason: string): void {
        const pending = this.pendingIncomingCalls.get(channelId);
        if (!pending) return;
        clearTimeout(pending.timeout);
        this.pendingIncomingCalls.delete(channelId);
        this.logger.log(`cancelled pending call answer for ${pending.userId}: ${reason}`);
    }

    private createPrivateCallAdapter(channel: PrivateCallChannel): DiscordGatewayAdapterCreator {
        return methods => {
            const adapter = channel.voiceAdapterCreator({
                ...methods,
                onVoiceServerUpdate: data => methods.onVoiceServerUpdate({
                    ...data,
                    guild_id: data.guild_id ?? channel.id,
                }),
            });

            return {
                destroy: () => adapter.destroy(),
                sendPayload: payload => adapter.sendPayload({
                    ...payload,
                    d: {
                        ...payload.d,
                        guild_id: null,
                    },
                }),
            };
        };
    }

    private getChannelUsernames(channel: PrivateCallChannel): Map<string, string> {
        const selfId = Core.services.bot.getClient().user?.id;
        if (channel.type === "DM") return new Map([[channel.recipient.id, channel.recipient.username]]);
        return new Map(
            [...channel.recipients.values()]
                .filter(user => user.id !== selfId)
                .map(user => [user.id, user.username]),
        );
    }

    private getParticipantUsername(call: ActiveCall, userId: string): string {
        const cached = Core.services.bot.getClient().users.cache.get(userId)?.username;
        if (cached) call.usernames.set(userId, cached);
        return cached ?? call.usernames.get(userId) ?? userId;
    }

    private attachPrivateCallReceiveCompatibility(call: ActiveCall): void {
        const connectionState = call.connection.state;
        if (connectionState.status !== VoiceConnectionStatus.Ready) return;

        const networkingState = connectionState.networking.state;
        if (networkingState.code !== NetworkingStatusCode.Ready) return;

        const onVoicePacket = (packet: any) => {
            if (packet?.op === 11) {
                for (const userId of packet.d?.user_ids ?? []) this.trackParticipantJoined(call, userId);
                return;
            }
            if (packet?.op === 13) {
                this.trackParticipantLeft(call, packet.d?.user_id);
                return;
            }
            if (packet?.op !== 12) return;

            const userId = packet.d?.user_id;
            this.trackParticipantJoined(call, userId);
            const audioSSRC = Number(packet.d?.audio_ssrc);
            if (typeof userId !== "string" || !Number.isInteger(audioSSRC) || audioSSRC <= 0) return;

            const videoSSRC = Number(packet.d?.video_ssrc);
            networkingState.connectionData.connectedClients.add(userId);
            call.connection.receiver.ssrcMap.update({
                userId,
                audioSSRC,
                ...(Number.isInteger(videoSSRC) && videoSSRC > 0 ? { videoSSRC } : {}),
            });
            this.logger.log(`mapped private-call participant ${userId} to SSRC ${audioSSRC}`);
        };

        call.onVoicePacket = onVoicePacket;
        call.voiceWebSocket = networkingState.ws;
        networkingState.ws.on("packet", onVoicePacket);
    }

    private trackParticipantJoined(call: ActiveCall, userId: unknown): void {
        if (typeof userId !== "string" || userId === Core.services.bot.getClient().user?.id || call.participants.has(userId)) return;
        if (call.emptyCallTimeout) {
            clearTimeout(call.emptyCallTimeout);
            call.emptyCallTimeout = undefined;
        }
        const user = Core.services.bot.getClient().users.cache.get(userId);
        if (user) call.usernames.set(userId, user.username);
        call.participants.add(userId);
        this.queueVoiceEvent(call, "participantJoined", userId);
    }

    private trackParticipantLeft(call: ActiveCall, userId: unknown): void {
        if (typeof userId !== "string" || !call.participants.delete(userId)) return;
        this.queueVoiceEvent(call, "participantLeft", userId);
        if (call.participants.size === 0 && this.activeCall === call) {
            call.emptyCallTimeout = setTimeout(() => {
                call.emptyCallTimeout = undefined;
                if (this.activeCall === call && call.participants.size === 0) {
                    this.finishCall(call, "no other participants remained");
                }
            }, this.emptyCallGraceMs);
            call.emptyCallTimeout.unref();
        }
    }

    private queueVoiceEvent(call: ActiveCall, event: "participantJoined" | "participantLeft", userId: string): void {
        call.processingQueue = call.processingQueue.then(() => this.processVoiceEventWithRetry({
            channelId: call.channelId,
            userId,
            username: this.getParticipantUsername(call, userId),
            messageId: `voice-event-${Id.get()}`,
            event,
            occurredAt: new Date(),
        })).catch(err => this.logger.error(`voice event processing failed: ${err?.message ?? err}`));
    }

    private async processVoiceEventWithRetry(input: {
        channelId: string;
        userId: string;
        username: string;
        messageId: string;
        event: "incomingCall" | "participantJoined" | "participantLeft";
        occurredAt: Date;
    }): Promise<void> {
        for (let attempt = 0; attempt < 30; attempt++) {
            if (await Core.services.bot.processVoiceCallEvent(input)) return;
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        this.logger.warn(`voice event ${input.event} was not processed because channel ${input.channelId} remained busy`);
    }

    private queueTranscription(call: ActiveCall, userId: string, stereoPcm: Buffer): Promise<string> {
        const wav = this.createMonoWav(stereoPcm);
        if (!this.hasSpeech(wav.subarray(44))) {
            this.logger.log("skipped silent voice utterance");
            return Promise.resolve("");
        }

        return Core.services.agent.transcribe(wav).then(transcript => {
            if (transcript) this.logger.log(`transcription chunk from ${userId}: ${transcript}`);
            return transcript;
        }).catch(err => {
            this.logger.error(`voice transcription failed: ${err?.message ?? err}`);
            return "";
        });
    }

    private queueTranscriptProcessing(call: ActiveCall, userId: string, username: string, chunks: Promise<string>[]): void {
        call.processingQueue = call.processingQueue.then(async () => {
            const transcript = (await Promise.all(chunks)).filter(Boolean).join(" ").trim();
            if (!transcript) return;
            this.logger.log(`transcript from ${userId}: ${transcript}`);
            const input = {
                channelId: call.channelId,
                userId,
                username,
                messageId: `voice-${Id.get()}`,
                transcript,
            };

            for (let attempt = 0; attempt < 30; attempt++) {
                if (await Core.services.bot.processVoiceTranscript(input)) return;
                await new Promise(resolve => setTimeout(resolve, 500));
            }
            this.logger.warn(`voice transcript was not processed because channel ${call.channelId} remained busy`);
        }).catch(err => this.logger.error(`voice transcript processing failed: ${err?.message ?? err}`));
    }

    private hasSpeech(monoPcm: Buffer): boolean {
        let peak = 0;
        let squareSum = 0;
        const samples = Math.floor(monoPcm.length / 2);
        for (let offset = 0; offset < samples * 2; offset += 2) {
            const sample = monoPcm.readInt16LE(offset);
            peak = Math.max(peak, Math.abs(sample));
            squareSum += sample * sample;
        }
        return peak >= MIN_SPEECH_PEAK && Math.sqrt(squareSum / Math.max(1, samples)) >= MIN_SPEECH_RMS;
    }

    private createMonoWav(stereoPcm: Buffer): Buffer {
        const inputFrames = Math.floor(stereoPcm.length / 4);
        const outputFrames = Math.floor(inputFrames / 3);
        const monoPcm = Buffer.allocUnsafe(outputFrames * 2);

        for (let outputIndex = 0; outputIndex < outputFrames; outputIndex++) {
            let sum = 0;
            for (let sample = 0; sample < 3; sample++) {
                const inputOffset = (outputIndex * 3 + sample) * 4;
                sum += stereoPcm.readInt16LE(inputOffset);
                sum += stereoPcm.readInt16LE(inputOffset + 2);
            }
            monoPcm.writeInt16LE(Math.round(sum / 6), outputIndex * 2);
        }

        const wav = Buffer.allocUnsafe(44 + monoPcm.length);
        wav.write("RIFF", 0);
        wav.writeUInt32LE(36 + monoPcm.length, 4);
        wav.write("WAVE", 8);
        wav.write("fmt ", 12);
        wav.writeUInt32LE(16, 16);
        wav.writeUInt16LE(1, 20);
        wav.writeUInt16LE(1, 22);
        wav.writeUInt32LE(16_000, 24);
        wav.writeUInt32LE(32_000, 28);
        wav.writeUInt16LE(2, 32);
        wav.writeUInt16LE(16, 34);
        wav.write("data", 36);
        wav.writeUInt32LE(monoPcm.length, 40);
        monoPcm.copy(wav, 44);
        return wav;
    }

    private finishCall(call: ActiveCall, reason: string): void {
        if (this.activeCall !== call) return;
        this.activeCall = undefined;

        if (call.timeout) clearTimeout(call.timeout);
        if (call.emptyCallTimeout) clearTimeout(call.emptyCallTimeout);
        if (call.voiceWebSocket && call.onVoicePacket) {
            call.voiceWebSocket.off("packet", call.onVoicePacket);
        }
        call.connection.receiver.speaking.off("start", call.onSpeaking);
        if (call.connection.state.status !== VoiceConnectionStatus.Destroyed) {
            call.connection.destroy();
        }

        const elapsed = Math.round((Date.now() - call.startedAt) / 1000);
        this.logger.log(`voice call ended (${reason}): ${elapsed}s, ${call.packetsReceived} Opus packets received`);
    }

    private readNumber(name: string, fallback: number, min: number, max = Number.POSITIVE_INFINITY): number {
        const value = Number(process.env[name]);
        return Number.isFinite(value) && value >= min && value <= max ? value : fallback;
    }
}
