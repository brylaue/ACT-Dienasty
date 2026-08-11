import { get } from "svelte/store";
import { players } from "$lib/stores";
import { browser } from "$app/environment";

export const loadPlayers = async (servFetch, refresh = false) => {
  if (get(players)[1426]) {
    return {
      players: get(players),
      stale: false,
    };
  }

  const smartFetch = servFetch ?? fetch;

  const now = Math.round(new Date().getTime() / 1000);
  let playersInfo = null;
  let expiration = null;
  if (browser) {
    playersInfo = JSON.parse(localStorage.getItem("playersInfo"));
    expiration = parseInt(localStorage.getItem("expiration"));
  }

  if (
    playersInfo &&
    playersInfo[1426] &&
    expiration &&
    now > expiration &&
    !refresh
  ) {
    return {
      players: playersInfo,
      stale: true,
    };
  }

  if (!playersInfo || !expiration || now > expiration) {
    let res;
    let lastErr;
    // the player DB fetch is large; retry a couple of times before giving up
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        res = await smartFetch(`/api/fetch_players_info`, { compress: true });
        if (res.ok) break;
      } catch (err) {
        lastErr = err;
        res = null;
      }
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
    if (!res || !res.ok) {
      // fall back to a stale local copy if we have one - old player names
      // beat an error screen
      if (playersInfo && playersInfo[1426]) {
        return { players: playersInfo, stale: true };
      }
      throw new Error(
        `Failed to load player database${lastErr ? `: ${lastErr.message}` : ""}`,
      );
    }
    const data = await res.json();

    if (browser) {
      localStorage.setItem("playersInfo", JSON.stringify(data));

      const ts = Math.round(new Date().getTime() / 1000);
      const newExpiration = ts + 24 * 3600;

      localStorage.setItem("expiration", newExpiration);

      players.update(() => data);
    }

    return {
      players: data,
      stale: false,
    };
  }
  players.update(() => playersInfo);
  return {
    players: playersInfo,
    stale: false,
  };
};
