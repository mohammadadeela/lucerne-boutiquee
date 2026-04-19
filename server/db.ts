import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

const url = process.env.DATABASE_URL;

// Enable SSL only for external hosted databases — NOT for Render internal URLs
// (internal Render connections use plain TCP within the private network)
const needsSsl =
  url.includes("neon.tech") ||
  url.includes("supabase.co") ||
  url.includes("railway.app") ||
  url.includes(".render.com") ||
  url.includes("sslmode=require");

export const pool = new Pool({
  connectionString: url,
  ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
});

export const db = drizzle(pool, { schema });
