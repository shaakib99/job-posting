import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';

export async function GET(request: NextRequest) {
  const keyword = request.nextUrl.searchParams.get('keyword')?.trim();

  if (keyword) {
    const jobs = db
      .prepare(
        `SELECT jobs.*, sources.name as source_name
         FROM jobs JOIN sources ON jobs.source_id = sources.id
         WHERE jobs.title LIKE ? OR IFNULL(jobs.company, '') LIKE ? OR IFNULL(jobs.location, '') LIKE ?
         ORDER BY COALESCE(jobs.posted_at, jobs.created_at) DESC
         LIMIT 300`
      )
      .all(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);

    return NextResponse.json(jobs);
  }

  const jobs = db
    .prepare(
      `SELECT jobs.*, sources.name as source_name
       FROM jobs JOIN sources ON jobs.source_id = sources.id
       ORDER BY COALESCE(jobs.posted_at, jobs.created_at) DESC
       LIMIT 300`
    )
    .all();

  return NextResponse.json(jobs);
}
