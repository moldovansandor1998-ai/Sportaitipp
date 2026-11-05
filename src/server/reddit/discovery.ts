import "server-only";
import { normalizeDestination, redditSearchSubreddits, redditSubreddit } from "./client";

export type CommunityRule = { name: string; description: string };
export type CommunityCandidate = {
  subreddit: string; title: string; description: string; over18: boolean;
  status: "eligible" | "needs_review" | "blocked"; reason: string;
  rules: CommunityRule[]; checked_at: string;
};
type Community = { name: string; title: string; description: string; over18: boolean };

// Discovery is a suggestion, never permission to publish. Missing, ambiguous, or
// conditional permission must be reviewed by the owner against the live rules.
export function classifyCommunity(community: Community, rules: CommunityRule[], restricted = false) {
  const context = `${community.name} ${community.title} ${community.description}`;
  const text = `${context}\n${rules.map(rule => `${rule.name}. ${rule.description}`).join("\n")}`;
  const block = (reason: string) => ({ status: "blocked" as const, reason });
  if (restricted) return block("Restricted, quarantined, or unavailable community.");
  if (/^(?:relationships?|dating|dating_advice|relationship_advice|sex|sexpartners?|r4r|needafriend)$/i.test(community.name) || /relationship.?advice|dating.?advice|relationship.?support|support.?group|\b(?:advice|support) (?:for|about|on) (?:relationships|dating|breakups)|\b(?:r4r|personals|sexpartner|hookups)\b/i.test(context))
    return block("Advice, support, or personal matchmaking community; not a model publishing destination.");
  const subject = "(?:self[- ]?promo(?:tion)?|promo(?:tion|ting)?|advertis(?:ing|ements?)|commercial|solicitation|selling|external links?|outbound links?|links?|fanvue|onlyfans|AI(?:[- ]generated)?(?: content| models?| images?)?|artificial intelligence)";
  if (new RegExp(`\\b(?:no|without|ban(?:ned)?|prohibit(?:ed)?|forbid(?:den)?)\\s+(?:any\\s+)?${subject}\\b`, "i").test(text) ||
      new RegExp(`\\b${subject}\\b[^.!?\\n]{0,70}\\b(?:not allowed|not permitted|prohibited|forbidden|banned|disallowed|must not|isn't allowed|aren't allowed)\\b`, "i").test(text))
    return block("Community text explicitly prohibits AI, promotion, solicitation, or external links.");
  // Hungarian prohibitions: match the prohibited subject in the same short
  // grammatical phrase, not an unrelated negative sentence elsewhere in a rule.
  const huSubject = "(?:reklám[\\p{L}-]*|önreklám[\\p{L}-]*|promóció[\\p{L}-]*|link[\\p{L}-]*|fanvue(?:-[\\p{L}]+)?|AI(?:-[\\p{L}]+)?|mesterséges\\s+intelligencia[\\p{L}-]*)";
  const huBan = "(?:tilos|nem\\s+(?:engedélyezett|megengedett|lehet))";
  const huBefore = new RegExp(`(?<![\\p{L}])${huBan}\\s+(?:(?:a|az|bármilyen|semmilyen|külső|saját)\\s+){0,3}${huSubject}(?![\\p{L}])`, "iu");
  const huAfter = new RegExp(`(?<![\\p{L}])${huSubject}(?:\\s+(?:tartalom|tartalmak|modellek|képek|linkek|használata|megosztása|közzététele|posztolása|itt|nálunk)){0,3}\\s+${huBan}(?![\\p{L}])`, "iu");
  if (huBefore.test(text) || huAfter.test(text))
    return block("Community text explicitly prohibits AI, promotion, solicitation, or external links.");
  const ruleText = rules.map(rule => `${rule.name}. ${rule.description}`).join("\n");
  const aiAllowed = /\b(?:AI(?:[- ]generated)? (?:models?|content|images?)|artificial intelligence)\s+(?:is |are )?(?:explicitly )?(?:allowed|permitted|welcome)\b/i.test(ruleText);
  const linksAllowed = /\b(?:fanvue(?: links?)?|external links?|outbound links?)\s+(?:is |are )?(?:explicitly )?(?:allowed|permitted|welcome)\b/i.test(ruleText);
  // Conditional and negative wording cannot grant unattended posting permission.
  const conditional = /\b(?:only|except|unless|approval|verified|verification|permission|must|not|never|no|prohibit|ban|forbid|disallow)\b/i.test(ruleText);
  if (aiAllowed && linksAllowed && !conditional)
    return { status: "eligible" as const, reason: "Rules explicitly permit AI content and Fanvue/external links. Owner review is still required before enabling posts." };
  return { status: "needs_review" as const, reason: "Explicit unconditional permission for both AI models and Fanvue/external links could not be verified. Review current community rules." };
}

export function discoveryQueries() {
  return (process.env.REDDIT_DISCOVERY_QUERIES || "AI models|Fanvue|AI model photography")
    .split("|").map(query => query.trim().slice(0, 100)).filter(Boolean).slice(0, 4);
}

/** Read-only authenticated discovery. No account, schedule, or destination changes. */
export async function discoverCommunities(access: string): Promise<CommunityCandidate[]> {
  const found = new Map<string, Community>();
  let incompleteSearch = false;
  let successfulSearches = 0;
  for (const query of discoveryQueries()) {
    try {
      const results = await redditSearchSubreddits(access, query, 12);
      successfulSearches++;
      for (const item of results) {
        const name = normalizeDestination(item.name);
        if (name && !name.startsWith("u_") && found.size < 12) found.set(name, { ...item, name });
      }
    } catch { incompleteSearch = true; }
  }
  if (!successfulSearches) throw new Error("REDDIT_DISCOVERY_SEARCH_FAILED");
  const candidates: CommunityCandidate[] = [];
  const items = [...found.values()];
  for (let i = 0; i < items.length; i += 3) {
    candidates.push(...await Promise.all(items.slice(i, i + 3).map(async community => {
      const base = { subreddit: community.name, title: community.title, description: community.description,
        over18: community.over18, checked_at: new Date().toISOString() };
      try {
        const current = await redditSubreddit(access, community.name);
        const live = { ...community, title: current.title, description: current.description, over18: current.over18 };
        const verdict = classifyCommunity(live, current.rules, current.restricted || current.quarantined || current.submissionType === "link");
        if (incompleteSearch && verdict.status !== "blocked") {
          verdict.status = "needs_review";
          verdict.reason = "Search was incomplete. Review current rules and permissions manually.";
        }
        return { ...base, title: live.title, description: live.description, over18: live.over18, ...verdict, rules: current.rules };
      } catch {
        return { ...base, status: "needs_review" as const, reason: "Current community details or rules could not be retrieved. Posting is not authorized.", rules: [] };
      }
    })));
  }
  return candidates;
}
