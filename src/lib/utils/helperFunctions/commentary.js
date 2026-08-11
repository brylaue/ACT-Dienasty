/*
  Loads static/data/commentary.json: AI-written, per-transaction Trade-o-Meter
  verdicts and waiver headlines, baked weekly alongside the rest of the
  league data (see scripts/build-commentary.mjs). Cached for the life of the
  page load - it's one small static file, no need to refetch per component.
*/
let commentaryPromise = null;

export const getCommentary = () => {
  if (commentaryPromise) return commentaryPromise;
  commentaryPromise = fetch('/data/commentary.json')
    .then((res) => (res.ok ? res.json() : { trades: {}, waivers: {} }))
    .catch(() => ({ trades: {}, waivers: {} }));
  return commentaryPromise;
};
