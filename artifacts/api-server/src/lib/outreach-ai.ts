import OpenAI from "openai";
import { logger } from "./logger.js";

function getOpenAiClient(): OpenAI {
  const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  const apiKey  = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  if (!baseURL || !apiKey) {
    throw new Error("AI_INTEGRATIONS_OPENAI_BASE_URL and AI_INTEGRATIONS_OPENAI_API_KEY must be set.");
  }
  return new OpenAI({ apiKey, baseURL });
}

export type OutreachMessageType = "dm" | "email" | "proposal" | "recommendation";

const TYPE_DESCRIPTIONS: Record<OutreachMessageType, string> = {
  dm:             "casual direct message (DM) for social media outreach",
  email:          "professional email to initiate a business relationship",
  proposal:       "formal booking/collaboration proposal with deal structure",
  recommendation: "personalized service recommendation explaining what we can offer them",
};

export async function generateOutreachMessage(artist: {
  name: string;
  genre?: string | null;
  bio?: string | null;
  tags?: string[];
  city?: string | null;
  state?: string | null;
  outreachStatus?: string | null;
  followersEstimate?: string | null;
  engagementLevel?: string | null;
  revenuePotential?: string | null;
  labelStatus?: string;
  streamingLinks?: Record<string, string>;
  socialLinks?: Record<string, string>;
}, type: OutreachMessageType, contextNotes?: string): Promise<{ subject: string; body: string }> {

  const socialSummary = Object.entries(artist.socialLinks ?? {})
    .map(([k, v]) => `${k}: ${v}`).join(", ") || "none listed";
  const streamingSummary = Object.entries(artist.streamingLinks ?? {})
    .map(([k, v]) => `${k}: ${v}`).join(", ") || "none listed";

  const prompt = `You are an experienced A&R outreach specialist at a music production company called Doubtless Productions. 
Draft a ${TYPE_DESCRIPTIONS[type]} for the following artist. 

Artist Profile:
- Name: ${artist.name}
- Genre: ${artist.genre ?? "not specified"}
- Location: ${[artist.city, artist.state].filter(Boolean).join(", ") || "not specified"}
- Bio: ${artist.bio ?? "not provided"}
- Tags/Keywords: ${(artist.tags ?? []).join(", ") || "none"}
- Followers Estimate: ${artist.followersEstimate ?? "unknown"}
- Engagement Level: ${artist.engagementLevel ?? "unknown"}
- Revenue Potential: ${artist.revenuePotential ?? "unknown"}
- Label Status: ${artist.labelStatus ?? "unsigned"}
- Streaming Links: ${streamingSummary}
- Social Links: ${socialSummary}
${contextNotes ? `\nAdditional Context / Staff Notes:\n${contextNotes}` : ""}

Return ONLY a valid JSON object (no markdown, no explanation):
{
  "subject": "<concise subject line — for DMs this can be a short opener, for emails/proposals a professional subject>",
  "body": "<the full message body — personalized, professional, and appropriate for the message type>"
}

Guidelines:
- DMs: Keep under 150 words, casual but professional, reference their music/style specifically
- Emails: 200-350 words, professional greeting, clear value proposition, specific CTA
- Proposals: 300-500 words, structured with what we offer, terms overview, next steps
- Recommendations: 200-300 words, focus on specific services that fit their profile, include examples
- Always personalize using actual artist details — never use generic placeholders
- Sign off as "The Doubtless Productions Team"`;

  const client = getOpenAiClient();

  try {
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      max_completion_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = completion.choices[0]?.message?.content ?? "";
    const cleaned = raw.replace(/```json\n?|\n?```/g, "").trim();
    const parsed = JSON.parse(cleaned) as { subject: string; body: string };

    return {
      subject: String(parsed.subject ?? ""),
      body: String(parsed.body ?? ""),
    };
  } catch (err) {
    logger.error({ err }, "Outreach AI generation failed");
    throw new Error("AI generation failed");
  }
}
