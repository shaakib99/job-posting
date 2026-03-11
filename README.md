# Job Posting Dashboard

Next.js + SQLite dashboard for aggregating jobs from editable sources.

## Features
- Manage job sources (career URLs + optional RSS feed URL).
- Sync jobs from enabled RSS sources.
- Keyword filtering on title/company/location.
- One-click **Apply** button opens original job post.
- SQLite for local persistence (`data.sqlite`).

## Run
```bash
npm install
npm run dev
```

Then open `http://localhost:3000`.

## Notes
- Platforms like LinkedIn/Google/Apple often do not provide stable public RSS feeds.
- You can still keep them as manual sources and add feed URLs when available.
- Later migration to MySQL/PostgreSQL can be done by replacing the DB layer in `lib/db.ts`.
