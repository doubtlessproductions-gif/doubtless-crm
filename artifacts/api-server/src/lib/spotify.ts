import { logger } from "./logger.js";

interface TokenCache {
  accessToken: string;
  expiresAt: number;
}

let cache: TokenCache | null = null;

function getCredentials() {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET must be set.");
  }
  return { clientId, clientSecret };
}

async function getAccessToken(): Promise<string> {
  if (cache && Date.now() < cache.expiresAt - 30_000) {
    return cache.accessToken;
  }

  const { clientId, clientSecret } = getCredentials();
  const creds = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${creds}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Spotify token error ${res.status}: ${text}`);
  }

  const data = await res.json() as { access_token: string; expires_in: number };
  cache = {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return cache.accessToken;
}

export interface SpotifyArtist {
  id: string;
  name: string;
  genres: string[];
  popularity: number;
  followers: number;
  imageUrl: string | null;
  profileUrl: string;
  externalUrls: Record<string, string>;
}

function formatFollowers(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

export { formatFollowers };

function normalizeArtist(a: SpotifyArtistRaw): SpotifyArtist {
  return {
    id: a.id,
    name: a.name,
    genres: a.genres ?? [],
    popularity: a.popularity ?? 0,
    followers: a.followers?.total ?? 0,
    imageUrl: a.images?.[0]?.url ?? null,
    profileUrl: a.external_urls?.spotify ?? `https://open.spotify.com/artist/${a.id}`,
    externalUrls: a.external_urls ?? {},
  };
}

interface SpotifyArtistRaw {
  id: string;
  name: string;
  genres?: string[];
  popularity?: number;
  followers?: { total: number };
  images?: { url: string; height: number; width: number }[];
  external_urls?: Record<string, string>;
}

export interface SpotifyTrack {
  id: string;
  name: string;
  popularity: number;
  previewUrl: string | null;
  durationMs: number;
  explicit: boolean;
  externalUrls: Record<string, string>;
  albumName: string | null;
  albumImageUrl: string | null;
}

export async function getSpotifyArtistById(artistId: string): Promise<SpotifyArtist> {
  const token = await getAccessToken();
  const res = await fetch(`https://api.spotify.com/v1/artists/${encodeURIComponent(artistId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Spotify artist fetch error ${res.status}`);
  const a = await res.json() as SpotifyArtistRaw;
  return normalizeArtist(a);
}

export async function getSpotifyTrackById(trackId: string): Promise<SpotifyTrack> {
  const token = await getAccessToken();
  const res = await fetch(`https://api.spotify.com/v1/tracks/${encodeURIComponent(trackId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Spotify track fetch error ${res.status}`);
  const t = await res.json() as {
    id: string; name: string; popularity: number; preview_url: string | null;
    duration_ms: number; explicit: boolean; external_urls: Record<string, string>;
    album?: { name: string; images?: { url: string }[] };
  };
  return {
    id: t.id,
    name: t.name,
    popularity: t.popularity ?? 0,
    previewUrl: t.preview_url ?? null,
    durationMs: t.duration_ms ?? 0,
    explicit: t.explicit ?? false,
    externalUrls: t.external_urls ?? {},
    albumName: t.album?.name ?? null,
    albumImageUrl: t.album?.images?.[0]?.url ?? null,
  };
}

export async function searchSpotifyArtists(
  q: string,
  genre?: string,
  limit = 20,
  offset = 0,
): Promise<{ results: SpotifyArtist[]; total: number; offset: number; limit: number }> {
  const token = await getAccessToken();

  // Spotify supports genre filter by combining it into the query string
  const queryStr = genre ? `${q} genre:${genre}` : q;

  const params = new URLSearchParams({
    q: queryStr,
    type: "artist",
    limit: String(Math.min(50, Math.max(1, limit))),
    offset: String(Math.max(0, offset)),
  });

  const res = await fetch(`https://api.spotify.com/v1/search?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const bodyText = await res.text();
    logger.error({ status: res.status, body: bodyText }, "Spotify search failed");
    throw Object.assign(new Error(`Spotify search error ${res.status}`), {
      status: res.status,
      body: bodyText,
    });
  }

  const data = await res.json() as { artists: { items: SpotifyArtistRaw[]; total: number; limit: number; offset: number } };
  const artists = data.artists ?? { items: [], total: 0, limit: 0, offset: 0 };
  return {
    results: (artists.items ?? []).map(normalizeArtist),
    total: artists.total ?? 0,
    offset: artists.offset ?? offset,
    limit: artists.limit ?? limit,
  };
}
