/*
  Waiver Wire Post: one-line comedic headlines for waiver moves.
  Seeded by transaction ID so each move keeps its joke forever.
*/

const hashString = (str) => {
  let h = 0;
  for (let i = 0; i < String(str).length; i++) {
    h = (h * 31 + String(str).charCodeAt(i)) >>> 0;
  }
  return h;
};

const SWAP = [
  "🗞️ {T} waive {D}, citing \u201ccreative differences.\u201d {A} welcomed aboard.",
  "🗞️ {D} out, {A} in. {T} call it \u201ca vision thing.\u201d",
  "🗞️ BREAKING: {T} drop {D} like a bad habit and pick up {A} like a new one.",
  "🗞️ {T} swap {D} for {A}. {D}'s agent was notified via group chat.",
  "🗞️ {T} announce a bold new direction: {A}. {D} was not consulted.",
];

const ADD = [
  "🗞️ {T} sign {A}. Sources describe the locker room mood as \u201ccautiously optimistic.\u201d",
  "🗞️ {T} land {A} and immediately declare the waiver wire \u201cwon.\u201d",
  "🗞️ {A} joins {T}, who insist this was the plan all along.",
  "🗞️ {T} add {A}. Analysts are calling it \u201ca move that happened.\u201d",
];

const DROP = [
  "🗞️ {T} release {D}, thanking them for \u201cthe memories. Mostly the bad ones.\u201d",
  "🗞️ {D} granted their unconditional release from {T}. Godspeed.",
  "🗞️ {T} part ways with {D}. It's not you, {D}... okay, it's a little you.",
  "🗞️ {T} waive {D} to spend more time with players who score points.",
];

const joinNames = (names) => {
  if (names.length <= 1) return names[0] || "";
  if (names.length == 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
};

export const waiverHeadline = (transaction, players, teamName) => {
  const adds = [];
  const drops = [];
  let bid = null;
  for (const move of transaction.moves) {
    const cell = move[0];
    if (!cell || typeof cell !== "object") continue;
    const p = players?.[cell.player];
    const name = p ? `${p.fn} ${p.ln}` : "a mystery player";
    if (cell.type == "Added") {
      adds.push(name);
      if (cell.bid) bid = cell.bid;
    } else if (cell.type == "Dropped") {
      drops.push(name);
    }
  }
  if (!adds.length && !drops.length) return null;

  const pool = adds.length && drops.length ? SWAP : adds.length ? ADD : DROP;
  const seed = hashString(transaction.id);
  let line = pool[seed % pool.length]
    .replace(/\{T\}/g, teamName)
    .replace(/\{A\}/g, joinNames(adds))
    .replace(/\{D\}/g, joinNames(drops));

  // FAAB color commentary
  if (bid != null && bid > 0) {
    if (bid >= 40) {
      line += ` The $${bid} FAAB bill has been forwarded to ownership.`;
    } else if (bid >= 15) {
      line += ` Price tag: $${bid} FAAB.`;
    } else {
      line += ` Acquired for $${bid} FAAB — the fantasy equivalent of couch change.`;
    }
  }
  return line;
};
