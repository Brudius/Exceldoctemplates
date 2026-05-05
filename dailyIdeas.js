require("dotenv").config();

const Anthropic = require("@anthropic-ai/sdk");
const { Resend } = require("resend");
const fetch = require("node-fetch");

// ─── Configuration ────────────────────────────────────────────────────────────

const SUBREDDITS = [
  "3Dprinting",
  "functionalprint",
  "organization",
  "DIY",
  "malelivingspace",
  "homelab",
  "woodworking",
];

const SEARCH_PHRASES = [
  "wish someone made",
  "can't find a",
  "cant find a",
  "does anyone make",
  "looking for a",
  "need a holder for",
  "need a mount for",
];

const MAX_RESULTS = 20;

// ─── Reddit Auth ──────────────────────────────────────────────────────────────

async function getRedditToken() {
  const credentials = Buffer.from(
    `${process.env.REDDIT_CLIENT_ID}:${process.env.REDDIT_CLIENT_SECRET}`
  ).toString("base64");

  const response = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "DailyProductIdeas/1.0 (by /u/product_ideas_bot)",
    },
    body: new URLSearchParams({
      grant_type: "password",
      username: process.env.REDDIT_USERNAME,
      password: process.env.REDDIT_PASSWORD,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Reddit auth failed (${response.status}): ${text}`);
  }

  const data = await response.json();
  return data.access_token;
}

// ─── Reddit Search ────────────────────────────────────────────────────────────

async function searchReddit(token, query, subreddit) {
  const url = new URL(`https://oauth.reddit.com/r/${subreddit}/search`);
  url.searchParams.set("q", query);
  url.searchParams.set("restrict_sr", "true");
  url.searchParams.set("sort", "new");
  url.searchParams.set("t", "day");
  url.searchParams.set("limit", "10");
  url.searchParams.set("type", "link");

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": "DailyProductIdeas/1.0 (by /u/product_ideas_bot)",
    },
  });

  if (!response.ok) {
    console.warn(
      `  Warning: search failed for r/${subreddit} "${query}" (${response.status})`
    );
    return [];
  }

  const data = await response.json();
  return (data?.data?.children || []).map((child) => ({
    subreddit: child.data.subreddit,
    title: child.data.title,
    selftext: child.data.selftext || "",
    url: `https://www.reddit.com${child.data.permalink}`,
    score: child.data.score,
    created_utc: child.data.created_utc,
  }));
}

async function collectRedditPosts() {
  console.log("🔑 Authenticating with Reddit...");
  const token = await getRedditToken();

  console.log("🔍 Searching Reddit posts...");
  const allResults = [];
  const seen = new Set();

  for (const subreddit of SUBREDDITS) {
    for (const phrase of SEARCH_PHRASES) {
      try {
        const posts = await searchReddit(token, phrase, subreddit);
        for (const post of posts) {
          const key = post.url;
          if (!seen.has(key)) {
            seen.add(key);
            allResults.push(post);
          }
        }
      } catch (err) {
        console.warn(`  Warning: error searching r/${subreddit}: ${err.message}`);
      }

      // Respect Reddit's rate limit (60 requests/minute for OAuth)
      await sleep(1100);

      if (allResults.length >= MAX_RESULTS * 3) break;
    }
    if (allResults.length >= MAX_RESULTS * 3) break;
  }

  // Sort by score, take top MAX_RESULTS
  allResults.sort((a, b) => b.score - a.score);
  const top = allResults.slice(0, MAX_RESULTS);

  console.log(`  Found ${top.length} posts to analyze.`);
  return top;
}

// ─── Claude Analysis ──────────────────────────────────────────────────────────

function buildRedditSummary(posts) {
  if (posts.length === 0) return "No posts found in the last 24 hours.";

  return posts
    .map(
      (p, i) =>
        `[${i + 1}] r/${p.subreddit} | Score: ${p.score}\nTitle: ${p.title}\n${
          p.selftext ? `Body: ${p.selftext.slice(0, 400)}` : ""
        }\nURL: ${p.url}`
    )
    .join("\n\n---\n\n");
}

async function analyzeWithClaude(posts) {
  console.log("🤖 Analyzing posts with Claude...");
  const client = new Anthropic();
  const redditSummary = buildRedditSummary(posts);

  const prompt = `You are a product researcher helping identify viable 3D printable product opportunities for an Etsy seller.

Below are Reddit posts from the last 24 hours where people expressed unmet needs or searched for physical products they can't find.

${redditSummary}

Based on these posts, identify the TOP 3 most viable 3D printable product opportunities. For each opportunity, provide:

1. **Product Name** – A clear, marketable name
2. **Problem It Solves** – 1-2 sentences describing the pain point
3. **Target Buyer** – Who would purchase this (be specific: hobbyist, homeowner, gamer, etc.)
4. **Estimated Etsy Demand** – Low / Medium / High, with a one-sentence justification
5. **Source Post** – The Reddit post(s) that inspired this idea (title + URL)

Focus on products that are:
- Feasible to print on a home FDM printer
- Likely to sell at $10–$50 on Etsy
- Solving a real, recurring problem (not too niche)
- Not already saturated on Etsy

Format your response as three clearly separated cards. Use plain text formatting since this will be embedded in an HTML email.`;

  const message = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 2000,
    messages: [{ role: "user", content: prompt }],
  });

  return message.content[0].text;
}

// ─── Email Formatting ─────────────────────────────────────────────────────────

function formatAsHtml(analysisText, posts, runDate) {
  const dateStr = runDate.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  // Convert the plain text analysis into basic HTML (bold headers, paragraphs)
  const analysisHtml = analysisText
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/^---+$/gm, '<hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0;">')
    .replace(/\n\n/g, "</p><p>")
    .replace(/\n/g, "<br>")
    .replace(/^/, "<p>")
    .replace(/$/, "</p>");

  const postLinksHtml = posts
    .slice(0, 5)
    .map(
      (p) =>
        `<li><a href="${p.url}" style="color:#6366f1;text-decoration:none;">r/${p.subreddit}: ${escapeHtml(p.title.slice(0, 80))}${p.title.length > 80 ? "…" : ""}</a></li>`
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Daily 3D Print Product Ideas – ${dateStr}</title>
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#6366f1 0%,#8b5cf6 100%);padding:36px 40px;text-align:center;">
              <p style="margin:0 0 6px;color:rgba(255,255,255,0.8);font-size:13px;text-transform:uppercase;letter-spacing:1.5px;">Daily Brief</p>
              <h1 style="margin:0;color:#ffffff;font-size:26px;font-weight:700;">3D Print Product Ideas</h1>
              <p style="margin:10px 0 0;color:rgba(255,255,255,0.85);font-size:14px;">${dateStr}</p>
            </td>
          </tr>

          <!-- Intro -->
          <tr>
            <td style="padding:32px 40px 0;">
              <p style="margin:0;color:#64748b;font-size:14px;line-height:1.7;">
                Scanned <strong>${posts.length} Reddit posts</strong> across 
                r/3Dprinting, r/functionalprint, r/organization, r/DIY, r/malelivingspace, r/homelab, and r/woodworking 
                for unmet needs from the last 24 hours. Here are today's top opportunities:
              </p>
            </td>
          </tr>

          <!-- Analysis -->
          <tr>
            <td style="padding:28px 40px;">
              <div style="color:#1e293b;font-size:15px;line-height:1.8;">
                ${analysisHtml}
              </div>
            </td>
          </tr>

          <!-- Source Posts -->
          <tr>
            <td style="padding:0 40px 32px;">
              <div style="background:#f1f5f9;border-radius:8px;padding:20px 24px;">
                <p style="margin:0 0 12px;color:#475569;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.8px;">Top Source Posts</p>
                <ul style="margin:0;padding-left:18px;color:#475569;font-size:13px;line-height:2;">
                  ${postLinksHtml}
                </ul>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f8fafc;padding:24px 40px;text-align:center;border-top:1px solid #e2e8f0;">
              <p style="margin:0;color:#94a3b8;font-size:12px;line-height:1.6;">
                Generated automatically by your Daily Product Ideas script.<br>
                Powered by Reddit API · Claude AI · Resend
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ─── Send Email ────────────────────────────────────────────────────────────────

async function sendEmail(htmlContent, runDate) {
  console.log("📧 Sending email via Resend...");
  const resend = new Resend(process.env.RESEND_API_KEY);

  const dateStr = runDate.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  const { data, error } = await resend.emails.send({
    from: "Daily Ideas <onboarding@resend.dev>",
    to: [process.env.TO_EMAIL],
    subject: `🖨️ 3D Print Ideas for ${dateStr}`,
    html: htmlContent,
  });

  if (error) {
    throw new Error(`Resend error: ${JSON.stringify(error)}`);
  }

  console.log(`  Email sent! Message ID: ${data.id}`);
  return data;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function validateEnv() {
  const required = [
    "REDDIT_CLIENT_ID",
    "REDDIT_CLIENT_SECRET",
    "REDDIT_USERNAME",
    "REDDIT_PASSWORD",
    "ANTHROPIC_API_KEY",
    "RESEND_API_KEY",
    "TO_EMAIL",
  ];

  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}\n` +
        `Copy .env.example to .env and fill in your credentials.`
    );
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=".repeat(50));
  console.log("  Daily 3D Print Product Ideas");
  console.log(`  ${new Date().toISOString()}`);
  console.log("=".repeat(50));

  validateEnv();

  const runDate = new Date();

  // Step 1: Collect Reddit posts
  const posts = await collectRedditPosts();

  if (posts.length === 0) {
    console.log("⚠️  No posts found. Sending a notice email...");
    const html = formatAsHtml(
      "No matching Reddit posts were found in the last 24 hours. Try again tomorrow!",
      [],
      runDate
    );
    await sendEmail(html, runDate);
    return;
  }

  // Step 2: Analyze with Claude
  const analysis = await analyzeWithClaude(posts);

  // Step 3: Format and send email
  const html = formatAsHtml(analysis, posts, runDate);
  await sendEmail(html, runDate);

  console.log("\n✅ Done! Check your inbox.");
  console.log("=".repeat(50));
}

main().catch((err) => {
  console.error("\n❌ Fatal error:", err.message);
  process.exit(1);
});
