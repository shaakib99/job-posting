import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.join(process.cwd(), 'data.sqlite');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    source_url TEXT NOT NULL,
    feed_url TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    company TEXT,
    location TEXT,
    apply_url TEXT NOT NULL,
    posted_at TEXT,
    external_id TEXT,
    raw_json TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(source_id, external_id, apply_url),
    FOREIGN KEY(source_id) REFERENCES sources(id)
  );
`);

const sourceCount = db.prepare('SELECT COUNT(*) as count FROM sources').get() as { count: number };
if (sourceCount.count === 0) {
  const insert = db.prepare(
    'INSERT INTO sources (name, source_url, feed_url, enabled) VALUES (@name, @source_url, @feed_url, @enabled)'
  );

  const defaults = [
    { name: 'LinkedIn', source_url: 'https://www.linkedin.com/jobs', feed_url: null, enabled: 1 },
    { name: 'Indeed RSS', source_url: 'https://www.indeed.com', feed_url: 'https://www.indeed.com/rss?q=software+engineer', enabled: 1 },
    { name: 'BDJobs', source_url: 'https://www.bdjobs.com', feed_url: null, enabled: 1 },
    { name: 'Google Careers', source_url: 'https://www.google.com/about/careers/applications/jobs/results', feed_url: null, enabled: 1 },
    { name: 'Apple Careers', source_url: 'https://jobs.apple.com/en-us/search', feed_url: null, enabled: 1 },
    { name: 'Meta Careers', source_url: 'https://www.metacareers.com/jobs', feed_url: null, enabled: 1 },
    { name: 'NVIDIA Careers', source_url: 'https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite', feed_url: null, enabled: 1 },
    { name: 'TikTok Careers', source_url: 'https://careers.tiktok.com/position', feed_url: null, enabled: 1 },
    { name: 'Samsung Careers', source_url: 'https://www.samsung.com/us/careers', feed_url: null, enabled: 1 },
    { name: 'Cefalo Careers', source_url: 'https://www.cefalo.com/en/career', feed_url: null, enabled: 1 },
    { name: 'Enosis Careers', source_url: 'https://www.enosisbd.com/career', feed_url: null, enabled: 1 }
  ];

  const transaction = db.transaction(() => defaults.forEach((source) => insert.run(source)));
  transaction();
}

export default db;
