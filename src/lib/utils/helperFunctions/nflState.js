import { dedupe } from "./multiPromise";
import { get } from "svelte/store";
import { nflState } from "#lib/stores.js";
import {
  handleApiError,
  handleFetchError,
  safeJsonParse,
} from "#lib/utils/errorHandler.js";

const _getNflState = async () => {
  if (get(nflState).season) {
    return get(nflState);
  }

  try {
    const res = await handleFetchError(
      `https://api.sleeper.app/v1/state/nfl`,
      new Error("NFL state fetch failed"),
    );
    if (res.error) {
      throw new Error("Failed to fetch NFL state");
    }

    const data = await safeJsonParse(res, "NFL state");
    if (data.error) {
      throw new Error("Failed to parse NFL state");
    }

    if (res.ok) {
      nflState.update(() => data);
      return data;
    } else {
      throw new Error(data.message || "NFL state fetch failed");
    }
  } catch (error) {
    return handleApiError(error, "getNflState", null);
  }
};
export const getNflState = dedupe(_getNflState);
