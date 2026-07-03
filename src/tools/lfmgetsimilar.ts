import { tool } from "@openrouter/sdk/lib/tool.js";
import z from "zod";

export const edit = tool({
    name: "lfmgetsimilar",
    description: "get tracks similar to anothber track",
    inputSchema: z.object({
        artist: z.string().describe("artist of the track to look up"),
        track: z.string().describe("track name")
    }),
    outputSchema: z.array(z.object({
        match: z.number(),
        title: z.string(),
        artist: z.string(),
    })),
    execute: async (params: Record<string, unknown>) => {
        const res = await fetch(`http://ws.audioscrobbler.com/2.0/?method=track.getSimilar&artist=${encodeURIComponent(params.artist as string)}&track=${params.track as string}&api_key=${process.env.LASTFM_API_KEY}&format=json`)
        const data: SimilarTracks = await res.json()

        console.log(data)

        return data.similartracks.track.map((t) => ({
            match: t.match,
            title: t.name,
            artist: t.artist.name,
        }))
    }
})

interface SimilarTracks {
    similartracks: {
        track: Track[];
        '@attr': Attributes;
    }
}

interface Attributes {
    artist: string;
    track: string;
}

interface Track {
    name: string;
    playcount: number;
    match: number;
    url: string;
    streamable: Streamable;
    duration: number;
    artist: Artist;
    image: Image[];
    mbid?: string;
}

interface Image {
    '#text': string;
    size: string;
}

interface Artist {
    name: string;
    mbid?: string;
    url: string;
}

interface Streamable {
    '#text': string;
    fulltrack: string;
}