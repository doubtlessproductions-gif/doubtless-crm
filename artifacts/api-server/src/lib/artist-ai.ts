import OpenAI from "openai";
import { logger } from "./logger.js";

export interface AiAnalysisResult {
  summary: string;
  brandingScore: number;
  growthScore: number;
  professionalismScore: number;
  leadTier: "hot" | "warm" | "cold" | "inactive";
  recommendations: string[];
}

function getOpenAiClient(): OpenAI {
  const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  const apiKey  = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  if (!baseURL || !apiKey) {
    throw new Error("AI_INTEGRATIONS_OPENAI_BASE_URL and AI_INTEGRATIONS_OPENAI_API_KEY must be set.");
  }
  return new OpenAI({ apiKey, baseURL });
}

export async function generateArtistAnalysis(artist: {
  name: string;
  genre?: string | null;
  bio?: string | null;
  tags?: string[];
  socialLinks?: Record<string, string>;
  streamingLinks?: Record<string, string>;
  labelStatus?: string;
  outreachStatus?: string | null;
  revenuePotential?: string | null;
  followers?: number;
  popularity?: number;
}): Promise<AiAnalysisResult> {
  const socialSummary    = Object.entries(artist.socialLinks ?? {}).map(([k, v]) => `${k}: ${v}`).join(", ") || "none listed";
  const streamingSummary = Object.entries(artist.streamingLinks ?? {}).map(([k, v]) => `${k}: ${v}`).join(", ") || "none listed";

  const followersLine = artist.followers !== undefined
    ? `- Followers: ${artist.followers.toLocaleString()}${artist.popularity !== undefined ? ` (Spotify popularity: ${artist.popularity}/100)` : ""}`
    : "";

  const prompt = `You are an A&R analyst for Doubtless Productions, a music production company. Analyze this artist and return a JSON object.

Artist Profile:
- Name: ${artist.name}
- Genre: ${artist.genre ?? "unknown"}
- Label Status: ${artist.labelStatus ?? "unsigned"}
- Bio: ${artist.bio ?? "none provided"}
- Tags: ${(artist.tags ?? []).join(", ") || "none"}
- Social Links: ${socialSummary}
- Streaming Links: ${streamingSummary}
${followersLine}

Return ONLY a valid JSON object (no markdown, no explanation):
{
  "summary": "2-3 sentence professional artist summary for internal CRM use",
  "brandingScore": <integer 0-100>,
  "growthScore": <integer 0-100>,
  "professionalismScore": <integer 0-100>,
  "leadTier": "<hot|warm|cold|inactive>",
  "recommendations": ["actionable recommendation 1", "recommendation 2", "recommendation 3"]
}

Scoring:
- hot: strong engagement signals, active presence, 70+ scores
- warm: some signals present, room to grow, 40-70 scores
- cold: minimal info, low signals, under 40 scores
- inactive: no presence or clearly inactive`;

  const client = getOpenAiClient();

  try {
    const completion = await client.chat.completions.create({
      model: "gpt-5-mini",
      max_completion_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });

    const raw     = completion.choices[0]?.message?.content ?? "";
    const cleaned = raw.replace(/```json\n?|\n?```/g, "").trim();
    const parsed  = JSON.parse(cleaned) as AiAnalysisResult;

    return {
      summary:              String(parsed.summary ?? ""),
      brandingScore:        Math.min(100, Math.max(0, Number(parsed.brandingScore) || 0)),
      growthScore:          Math.min(100, Math.max(0, Number(parsed.growthScore) || 0)),
      professionalismScore: Math.min(100, Math.max(0, Number(parsed.professionalismScore) || 0)),
      leadTier:             (["hot", "warm", "cold", "inactive"].includes(parsed.leadTier)
        ? parsed.leadTier : "cold") as AiAnalysisResult["leadTier"],
      recommendations: Array.isArray(parsed.recommendations)
        ? parsed.recommendations.slice(0, 5).map(String)
        : [],
    };
  } catch (err) {
    logger.error({ err }, "Artist AI analysis failed");
    throw new Error("AI analysis failed");
  }
}

/**
 * Generate a short (≤ 20-word) outreach hook for a sweep candidate.
 * Uses a cheaper model since this runs for hundreds of candidates.
 */
export async function generateCandidateHook(artist: {
  name: string;
  genres: string[];
  followers?: number;
  popularity?: number;
}): Promise<string> {
  const client = getOpenAiClient();

  const genreStr     = artist.genres.slice(0, 3).join(", ") || "unknown genre";
  const followersStr = artist.followers ? `${artist.followers.toLocaleString()} followers` : "";

  const prompt = `Write a single compelling outreach hook (max 20 words) for an A&R rep reaching out to this artist.
Artist: ${artist.name} | Genre: ${genreStr}${followersStr ? ` | ${followersStr}` : ""}
Return ONLY the hook sentence, no quotes, no explanation.`;

  try {
    const completion = await client.chat.completions.create({
      model: "gpt-5-nano",
      max_completion_tokens: 60,
      messages: [{ role: "user", content: prompt }],
    });
    return (completion.choices[0]?.message?.content ?? "").trim().replace(/^["']|["']$/g, "");
  } catch (err) {
    logger.warn({ err, name: artist.name }, "generateCandidateHook failed");
    return "";
  }
}
