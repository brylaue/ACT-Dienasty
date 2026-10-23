import { version } from "#lib/version.js";

export async function GET() {
  return Response.json(version);
}
