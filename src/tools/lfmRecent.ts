import { tool } from "@openrouter/sdk/lib/tool.js";
import z from "zod";

export const edit = tool({
    name: "lfmrecent",
    description: "get a user's recent track listens from last.fm",
    inputSchema: z.object({
        username: z.string().describe("user's last.fm username"),
    }),
    outputSchema: z.array(z.object({
        timestamp: z.date(),
        title: z.string(),
        artist: z.string(),
        album: z.string()
    })),
    execute: async (params: Record<string, unknown>) => {
        const res = await fetch(`http://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks&user=${params.username}&api_key=${process.env.LASTFM_API_KEY}&format=json`)
        const data: RecentTracks = await res.json()

        return data.recenttracks.track.map((t) => ({
            timestamp: t.date ? new Date(parseInt(t.date.uts) * 1000) : new Date(),
            title: t.name,
            artist: t.artist["#text"],
            album: t.album["#text"]
        }))
    }
})

interface RecentTracks {
    recenttracks: {
        track: Track[];
        '@attr': PagnationAttributes;
    };
}


interface PagnationAttributes {
    user: string;
    totalPages: string;
    page: string;
    perPage: string;
    total: string;
}

interface Track<Current extends boolean = boolean> {
    artist: Artist;
    streamable: string;
    image: Image[];
    mbid: string;
    album: Artist;
    name: string;
    '@attr': Current extends true ? {
        nowplaying: string;
    } : undefined
    url: string;
    date?: ScrobbleDate;
}

interface ScrobbleDate {
    uts: string;
    '#text': string;
}

interface Image {
    size: string;
    '#text': string;
}

interface Artist {
    mbid: string;
    '#text': string;
}