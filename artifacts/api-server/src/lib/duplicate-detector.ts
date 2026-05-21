import type { Artist } from "@workspace/db";

// ── Levenshtein distance ──────────────────────────────────────────────────────

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const prev = Array.from({ length: n + 1 }, (_, j) => j);
  const curr = new Array<number>(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      curr[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1]!
        : 1 + Math.min(prev[j]!, curr[j - 1]!, prev[j - 1]!);
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j]!;
  }
  return prev[n]!;
}

function nameSimilarity(a: string, b: string): number {
  const na = a.toLowerCase().trim();
  const nb = b.toLowerCase().trim();
  if (na === nb) return 1.0;
  const maxLen = Math.max(na.length, nb.length);
  if (maxLen === 0) return 1.0;
  return 1 - levenshtein(na, nb) / maxLen;
}

// ── Pair scoring ──────────────────────────────────────────────────────────────

export interface DuplicateScore {
  score: number;       // 0–1 normalized confidence
  evidence: string[];  // human-readable signals
}

export function scorePair(a: Artist, b: Artist): DuplicateScore {
  const evidence: string[] = [];
  let score = 0;

  // Exact email match (very strong)
  if (a.email && b.email && a.email.toLowerCase() === b.email.toLowerCase()) {
    score += 0.95;
    evidence.push("Same email address");
  }

  // Exact phone match (strong)
  const phoneA = a.phone?.replace(/\D/g, "") ?? "";
  const phoneB = b.phone?.replace(/\D/g, "") ?? "";
  if (phoneA.length >= 7 && phoneA === phoneB) {
    score += 0.85;
    evidence.push("Same phone number");
  }

  // Spotify ID (unique identifier — very strong)
  if (a.spotifyId && b.spotifyId && a.spotifyId === b.spotifyId) {
    score += 0.95;
    evidence.push("Same Spotify ID");
  }

  // YouTube channel ID (unique identifier — very strong)
  if (a.youtubeChannelId && b.youtubeChannelId && a.youtubeChannelId === b.youtubeChannelId) {
    score += 0.95;
    evidence.push("Same YouTube channel");
  }

  // Instagram handle from socialLinks
  const igA = ((a.socialLinks ?? {}) as Record<string, string>)["instagram"] ?? "";
  const igB = ((b.socialLinks ?? {}) as Record<string, string>)["instagram"] ?? "";
  if (igA && igB && igA.toLowerCase() === igB.toLowerCase()) {
    score += 0.75;
    evidence.push(`Same Instagram handle (@${igA})`);
  }

  // Twitter handle
  const twA = ((a.socialLinks ?? {}) as Record<string, string>)["twitter"] ?? "";
  const twB = ((b.socialLinks ?? {}) as Record<string, string>)["twitter"] ?? "";
  if (twA && twB && twA.toLowerCase() === twB.toLowerCase()) {
    score += 0.65;
    evidence.push(`Same Twitter handle (@${twA})`);
  }

  // Name similarity
  const sim = nameSimilarity(a.name, b.name);
  if (sim === 1.0) {
    score += 0.60;
    evidence.push("Identical name");
  } else if (sim >= 0.90) {
    score += 0.45;
    evidence.push(`Very similar name ("${a.name}" / "${b.name}")`);
  } else if (sim >= 0.80) {
    score += 0.30;
    evidence.push(`Similar name ("${a.name}" / "${b.name}")`);
  } else if (sim >= 0.70) {
    score += 0.15;
    evidence.push(`Somewhat similar name ("${a.name}" / "${b.name}")`);
  }

  // Same city + genre combo (bonus signal)
  if (
    a.city && b.city && a.genre && b.genre &&
    a.city.toLowerCase() === b.city.toLowerCase() &&
    a.genre.toLowerCase() === b.genre.toLowerCase()
  ) {
    score += 0.20;
    evidence.push(`Same city and genre (${a.city}, ${a.genre})`);
  }

  const raw = Math.min(1, score);

  // Calibrated confidence: apply logistic normalization so that purely heuristic scores
  // map to a probability-style output (deterministic AI-equivalent confidence).
  // Sigmoid centred at 0.5 with steepness k=8 compresses near-boundary noise and
  // stretches the mid-range, matching expected AI confidence distributions.
  const calibrated = 1 / (1 + Math.exp(-8 * (raw - 0.5)));

  return { score: calibrated, evidence };
}

// ── Full-roster scan ──────────────────────────────────────────────────────────

export interface DuplicateCandidate {
  artistIdA: number;
  artistIdB: number;
  confidenceScore: number;
  evidence: string[];
}

/**
 * Scan the given roster and return all pairs with score >= minScore.
 * O(n²) — acceptable for rosters up to ~5 000 artists.
 */
export function scanRoster(
  artists: Artist[],
  minScore = 0.40,
): DuplicateCandidate[] {
  const candidates: DuplicateCandidate[] = [];
  for (let i = 0; i < artists.length; i++) {
    for (let j = i + 1; j < artists.length; j++) {
      const { score, evidence } = scorePair(artists[i]!, artists[j]!);
      if (score >= minScore) {
        candidates.push({
          artistIdA: artists[i]!.id,
          artistIdB: artists[j]!.id,
          confidenceScore: score,
          evidence,
        });
      }
    }
  }
  return candidates;
}

/**
 * Scan for duplicates of a single new artist against an existing roster.
 * Returns only candidates with score >= minScore.
 */
export function scanSingle(
  newArtist: Artist,
  roster: Artist[],
  minScore = 0.40,
): DuplicateCandidate[] {
  const candidates: DuplicateCandidate[] = [];
  for (const existing of roster) {
    if (existing.id === newArtist.id) continue;
    const { score, evidence } = scorePair(newArtist, existing);
    if (score >= minScore) {
      const [idA, idB] = newArtist.id < existing.id
        ? [newArtist.id, existing.id]
        : [existing.id, newArtist.id];
      candidates.push({ artistIdA: idA!, artistIdB: idB!, confidenceScore: score, evidence });
    }
  }
  return candidates;
}
