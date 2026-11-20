export const waitForAll = async (...ps) => {
  return Promise.all(ps);
};

// One fetch per resource at a time: the home page mounts several widgets that each ask for the
// same league data on load, and every one used to walk the whole league chain itself (~200 Sleeper
// requests, most of them duplicates). Callers asking while a load is in flight share its promise;
// once it settles the helper's own store cache takes over.
export const dedupe = (fn) => {
  const inflight = new Map();
  return (...args) => {
    const key = JSON.stringify(args.map((a) => (typeof a === "function" ? "fn" : a ?? null)));
    if (inflight.has(key)) return inflight.get(key);
    const p = Promise.resolve().then(() => fn(...args)).finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  };
};
