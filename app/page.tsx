'use client';

import { FormEvent, useEffect, useState } from 'react';
import dayjs from 'dayjs';

type Source = {
  id: number;
  name: string;
  source_url: string;
  feed_url: string | null;
  enabled: number;
};

type Job = {
  id: number;
  title: string;
  company: string | null;
  location: string | null;
  apply_url: string;
  posted_at: string | null;
  source_name: string;
};

const emptySource = { name: '', source_url: '', feed_url: '' };

export default function Home() {
  const [sources, setSources] = useState<Source[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [keyword, setKeyword] = useState('');
  const [newSource, setNewSource] = useState(emptySource);
  const [loading, setLoading] = useState(false);

  async function loadSources() {
    const res = await fetch('/api/sources');
    setSources(await res.json());
  }

  async function loadJobs(term = keyword) {
    const query = term ? `?keyword=${encodeURIComponent(term)}` : '';
    const res = await fetch(`/api/jobs${query}`);
    setJobs(await res.json());
  }

  useEffect(() => {
    loadSources();
    loadJobs('');
  }, []);

  async function addSource(e: FormEvent) {
    e.preventDefault();
    await fetch('/api/sources', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...newSource, enabled: true })
    });
    setNewSource(emptySource);
    loadSources();
  }

  async function toggleSource(source: Source) {
    await fetch(`/api/sources/${source.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !source.enabled })
    });
    loadSources();
  }

  async function syncJobs() {
    setLoading(true);
    await fetch('/api/jobs/fetch', { method: 'POST' });
    await loadJobs();
    setLoading(false);
  }

  return (
    <main className="container grid" style={{ gridTemplateColumns: '360px 1fr' }}>
      <section className="card grid" style={{ alignContent: 'start' }}>
        <h2>Job Sources</h2>
        <p style={{ marginTop: -10, opacity: 0.8 }}>Enable/disable and add sources. RSS feeds sync automatically.</p>

        <form onSubmit={addSource} className="grid">
          <input
            placeholder="Source name"
            required
            value={newSource.name}
            onChange={(e) => setNewSource((prev) => ({ ...prev, name: e.target.value }))}
          />
          <input
            placeholder="Career page URL"
            required
            value={newSource.source_url}
            onChange={(e) => setNewSource((prev) => ({ ...prev, source_url: e.target.value }))}
          />
          <input
            placeholder="RSS feed URL (optional)"
            value={newSource.feed_url}
            onChange={(e) => setNewSource((prev) => ({ ...prev, feed_url: e.target.value }))}
          />
          <button type="submit">Add Source</button>
        </form>

        <div style={{ maxHeight: 420, overflowY: 'auto' }}>
          {sources.map((source) => (
            <div key={source.id} style={{ padding: '8px 0', borderBottom: '1px solid #1f2a44' }}>
              <strong>{source.name}</strong>
              <div style={{ fontSize: 12, opacity: 0.8 }}>{source.feed_url ?? 'Manual source (no feed)'}</div>
              <button onClick={() => toggleSource(source)} style={{ marginTop: 6 }}>
                {source.enabled ? 'Disable' : 'Enable'}
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="card grid" style={{ alignContent: 'start' }}>
        <h1 style={{ marginBottom: 4 }}>Job Dashboard</h1>
        <p style={{ marginTop: 0, opacity: 0.8 }}>
          Pulls recent jobs from enabled sources. Click Apply to jump to the original posting.
        </p>

        <div style={{ display: 'flex', gap: 10 }}>
          <input
            style={{ flex: 1 }}
            placeholder="Filter by keyword, company, location"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
          <button onClick={() => loadJobs(keyword)}>Search</button>
          <button onClick={syncJobs}>{loading ? 'Syncing...' : 'Sync Jobs'}</button>
        </div>

        <table>
          <thead>
            <tr>
              <th>Title</th>
              <th>Company/Source</th>
              <th>Location</th>
              <th>Posted</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.id}>
                <td>{job.title}</td>
                <td>{job.company ?? job.source_name}</td>
                <td>{job.location ?? '-'}</td>
                <td>{job.posted_at ? dayjs(job.posted_at).format('YYYY-MM-DD') : '-'}</td>
                <td>
                  <a href={job.apply_url} target="_blank" rel="noreferrer">
                    <button>Apply ↗</button>
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
