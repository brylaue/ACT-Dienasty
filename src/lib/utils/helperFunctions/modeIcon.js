/*
  Builds the /static icon filename for a manager's "mode" (Win Now, Rebuild,
  Survive + Vibes, etc). Vercel's static file routing doesn't reliably serve
  a literal "+" in a URL path (it gets treated like query-string encoding
  and mismatches the real filename), even though it works fine locally in
  dev - so "+" gets swapped for "and" here, and the matching static file
  must be named the same way (spaces are fine - see Win Now.png, Rebuild.png).
  If a future mode name introduces some other special character, extend this
  function rather than encoding the raw mode string directly.
*/
export const modeIconSrc = (mode) =>
  `/${mode.replaceAll(" + ", " and ").replaceAll(" ", "%20")}.png`;
