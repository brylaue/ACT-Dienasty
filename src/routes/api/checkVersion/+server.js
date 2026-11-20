// This site is a heavily edited fork of nmelhado/league-page - upstream releases can't be applied
// to it, so the "update your League Page" banner (driven by upstream's version) would only confuse
// league members. Always "no update"; no upstream call on every page load.
export async function GET() {
  return Response.json(false);
}
