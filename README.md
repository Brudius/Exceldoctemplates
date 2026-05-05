# Daily 3D Print Product Ideas Email

A Node.js script that runs daily, scans Reddit for unmet needs, uses Claude AI to identify the top 3 viable 3D printable product opportunities, and sends a formatted HTML email via Resend.

---

## How It Works

1. **Reddit** – Searches 7 subreddits (`r/3Dprinting`, `r/functionalprint`, `r/organization`, `r/DIY`, `r/malelivingspace`, `r/homelab`, `r/woodworking`) for posts from the last 24 hours containing phrases like "wish someone made", "can't find a", "does anyone make", etc.
2. **Claude AI** – Passes the top 20 posts to `claude-sonnet-4-5` and asks it to identify the 3 most viable 3D printable Etsy product opportunities.
3. **Resend** – Formats the analysis as a clean HTML email and delivers it to your inbox.

---

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

Copy the example file and fill in your credentials:

```bash
cp .env.example .env
```

Open `.env` and set:

| Variable | How to get it |
|---|---|
| `REDDIT_CLIENT_ID` | Go to [reddit.com/prefs/apps](https://www.reddit.com/prefs/apps), create a **script** app |
| `REDDIT_CLIENT_SECRET` | Same page as above |
| `REDDIT_USERNAME` | Your Reddit username |
| `REDDIT_PASSWORD` | Your Reddit password |
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com/) |
| `RESEND_API_KEY` | [resend.com](https://resend.com/) – free tier is fine |
| `TO_EMAIL` | The email address to send ideas to |

> **Resend note:** On the free tier, you can only send from `onboarding@resend.dev` (the default) or a domain you've verified. Add your domain in the Resend dashboard if you want a custom sender.

### 3. Run Manually

```bash
node dailyIdeas.js
```

---

## Scheduling (Windows Task Scheduler)

1. Open **Task Scheduler** → Create Basic Task
2. **Trigger:** Daily, at your preferred time
3. **Action:** Start a program
   - Program: `node`  
   - Arguments: `C:\path\to\project\dailyIdeas.js`  
   - Start in: `C:\path\to\project`
4. Make sure Node.js is in your system PATH, or use the full path to `node.exe`

### Alternative: Using a `.bat` file

Create `run.bat` in the project folder:

```bat
@echo off
cd /d C:\path\to\project
node dailyIdeas.js >> logs\output.log 2>&1
```

Then point Task Scheduler at the `.bat` file.

---

## Scheduling (Linux/macOS – cron)

```bash
# Run every day at 8 AM
0 8 * * * cd /path/to/project && node dailyIdeas.js >> /path/to/project/logs/output.log 2>&1
```

Add with `crontab -e`.

---

## Project Structure

```
.
├── dailyIdeas.js      # Main script
├── .env.example       # Environment variable template
├── .env               # Your credentials (never commit this!)
├── package.json
└── README.md
```
