import { NextResponse } from 'next/server'

/** The application process can serve requests even if the database is unavailable. */
export function GET() {
  return NextResponse.json({ status: 'alive' })
}
