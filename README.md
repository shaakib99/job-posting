# Job Posting Dashboard

Next.js + SQLite dashboard for aggregating jobs from editable sources.

## Why it was showing empty jobs
The previous sync logic silently ignored source fetch errors, and many default career pages do not provide public RSS feeds. That meant sync could run but insert 0 rows with no visible reason.

This version fixes that by:
- showing per-source sync status/error in the UI,
- supporting JSON job APIs via `feed_url` format `json:https://...`,
- seeding a working JSON source (`Arbeitnow API`) so first sync can return jobs.

## Features
- Manage job sources (career URLs + RSS/JSON feed URL).
- Sync jobs from enabled sources.
- Keyword filtering on title/company/location.
- One-click **Apply** button opens original job post.
- SQLite for local persistence (`data.sqlite`).

## Prerequisites
- Node.js 18+ (Node.js 20 recommended)
- npm 9+

## How to run
```bash
git clone https://github.com/shaakib99/job-posting.git
cd job-posting
npm config set registry https://registry.npmjs.org/
npm install
npm run dev
```

Open `http://localhost:3000`, then click **Sync Jobs**.

## Adding sources
- RSS source: put RSS URL directly in feed URL.
- JSON API source: use `json:https://api.example.com/jobs` in feed URL.
- No feed URL means manual source only (no automated sync).

## Notes
- Platforms like LinkedIn/Google/Apple often do not provide stable public RSS feeds.
- You can keep them as manual sources or connect them through supported feeds/APIs.
- Later migration to MySQL/PostgreSQL can be done by replacing `lib/db.ts`.
