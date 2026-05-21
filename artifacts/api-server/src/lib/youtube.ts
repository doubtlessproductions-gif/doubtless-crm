import { logger } from "./logger.js";

function getApiKey(): string {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) throw new Error("YOUTUBE_API_KEY must be set.");
  return key;
}

export interface YoutubeChannel {
  id: string;
  name: string;
  description: string;
  subscriberCount: number;
  videoCount: number;
  thumbnailUrl: string | null;
  profileUrl: string;
  topicCategories: string[];
  customUrl: string | null;
}

interface YTSearchItem {
  id: { channelId?: string };
  snippet: {
    channelId?: string;
    title: string;
    description: string;
    thumbnails?: {
      medium?: { url: string };
      default?: { url: string };
    };
  };
}

interface YTChannelItem {
  id: string;
  snippet: {
    title: string;
    description: string;
    thumbnails?: {
      medium?: { url: string };
      default?: { url: string };
    };
    customUrl?: string;
  };
  statistics: {
    subscriberCount?: string;
    videoCount?: string;
  };
  topicDetails?: {
    topicCategories?: string[];
  };
}

function cleanTopicCategories(urls: string[]): string[] {
  return urls.map(u => {
    const parts = u.split("/");
    return decodeURIComponent(parts[parts.length - 1] ?? "").replace(/_/g, " ");
  });
}

export interface YoutubeVideoStats {
  id: string;
  title: string;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  publishedAt: string;
  thumbnailUrl: string | null;
  videoUrl: string;
}

export async function getYoutubeChannelById(channelId: string): Promise<YoutubeChannel> {
  const apiKey = getApiKey();
  const params = new URLSearchParams({ part: "snippet,statistics,topicDetails", id: channelId, key: apiKey });
  const res = await fetch(`https://www.googleapis.com/youtube/v3/channels?${params}`);
  if (!res.ok) throw new Error(`YouTube channel fetch error ${res.status}`);
  const data = await res.json() as { items?: YTChannelItem[] };
  const c = data.items?.[0];
  if (!c) throw new Error("Channel not found");
  return {
    id: c.id,
    name: c.snippet.title,
    description: c.snippet.description ?? "",
    subscriberCount: parseInt(c.statistics?.subscriberCount ?? "0", 10) || 0,
    videoCount: parseInt(c.statistics?.videoCount ?? "0", 10) || 0,
    thumbnailUrl: c.snippet.thumbnails?.medium?.url ?? c.snippet.thumbnails?.default?.url ?? null,
    profileUrl: `https://www.youtube.com/channel/${c.id}`,
    topicCategories: cleanTopicCategories(c.topicDetails?.topicCategories ?? []),
    customUrl: c.snippet.customUrl ?? null,
  };
}

export async function getYoutubeVideoById(videoId: string): Promise<YoutubeVideoStats> {
  const apiKey = getApiKey();
  const params = new URLSearchParams({ part: "snippet,statistics", id: videoId, key: apiKey });
  const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?${params}`);
  if (!res.ok) throw new Error(`YouTube video fetch error ${res.status}`);
  const data = await res.json() as {
    items?: Array<{
      id: string;
      snippet: { title: string; publishedAt: string; thumbnails?: { medium?: { url: string }; default?: { url: string } } };
      statistics: { viewCount?: string; likeCount?: string; commentCount?: string };
    }>;
  };
  const v = data.items?.[0];
  if (!v) throw new Error("Video not found");
  return {
    id: v.id,
    title: v.snippet.title,
    viewCount: parseInt(v.statistics.viewCount ?? "0", 10) || 0,
    likeCount: parseInt(v.statistics.likeCount ?? "0", 10) || 0,
    commentCount: parseInt(v.statistics.commentCount ?? "0", 10) || 0,
    publishedAt: v.snippet.publishedAt,
    thumbnailUrl: v.snippet.thumbnails?.medium?.url ?? v.snippet.thumbnails?.default?.url ?? null,
    videoUrl: `https://www.youtube.com/watch?v=${v.id}`,
  };
}

export async function searchYoutubeChannels(
  q: string,
  limit = 20,
  pageToken?: string,
): Promise<{ results: YoutubeChannel[]; nextPageToken: string | null; totalResults: number }> {
  const apiKey = getApiKey();
  const maxResults = Math.min(50, Math.max(1, limit));

  // Step 1: Search for channels
  const searchParamsObj: Record<string, string> = {
    part: "snippet",
    q,
    type: "channel",
    maxResults: String(maxResults),
    key: apiKey,
  };
  if (pageToken) searchParamsObj["pageToken"] = pageToken;

  const searchParams = new URLSearchParams(searchParamsObj);

  const searchRes = await fetch(
    `https://www.googleapis.com/youtube/v3/search?${searchParams}`,
  );

  if (!searchRes.ok) {
    logger.error({ status: searchRes.status }, "YouTube search failed");
    throw new Error(`YouTube search error ${searchRes.status}`);
  }

  const searchData = await searchRes.json() as {
    items?: YTSearchItem[];
    nextPageToken?: string;
    pageInfo?: { totalResults?: number };
  };
  const items = searchData.items ?? [];
  const nextPageToken = searchData.nextPageToken ?? null;
  const totalResults = searchData.pageInfo?.totalResults ?? 0;

  if (items.length === 0) return { results: [], nextPageToken: null, totalResults };

  const channelIds = items
    .map(i => i.id?.channelId ?? i.snippet?.channelId)
    .filter((id): id is string => !!id);

  if (channelIds.length === 0) return { results: [], nextPageToken: null, totalResults };

  // Step 2: Enrich with channel statistics
  const channelParams = new URLSearchParams({
    part: "snippet,statistics,topicDetails",
    id: channelIds.join(","),
    key: apiKey,
  });

  const channelRes = await fetch(
    `https://www.googleapis.com/youtube/v3/channels?${channelParams}`,
  );

  if (!channelRes.ok) {
    logger.error({ status: channelRes.status }, "YouTube channels fetch failed");
    throw new Error(`YouTube channels error ${channelRes.status}`);
  }

  const channelData = await channelRes.json() as { items?: YTChannelItem[] };
  const channels = channelData.items ?? [];

  return {
    results: channels.map(c => ({
      id: c.id,
      name: c.snippet.title,
      description: c.snippet.description ?? "",
      subscriberCount: parseInt(c.statistics?.subscriberCount ?? "0", 10) || 0,
      videoCount: parseInt(c.statistics?.videoCount ?? "0", 10) || 0,
      thumbnailUrl:
        c.snippet.thumbnails?.medium?.url ??
        c.snippet.thumbnails?.default?.url ??
        null,
      profileUrl: `https://www.youtube.com/channel/${c.id}`,
      topicCategories: cleanTopicCategories(c.topicDetails?.topicCategories ?? []),
      customUrl: c.snippet.customUrl ?? null,
    })),
    nextPageToken,
    totalResults,
  };
}
