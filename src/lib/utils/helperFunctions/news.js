import { get } from "svelte/store";
import { news } from "$lib/stores";
import { dynasty } from "$lib/utils/leagueInfo";

const REDDIT_DYNASTY = "https://www.reddit.com/r/DynastyFF/new.json";
const REDDIT_FANTASY = "https://www.reddit.com/r/fantasyfootball/new.json";
const SERVER_API = "/api/fetch_serverside_news";

export const getNews = async (servFetch, bypass = false) => {
  if (get(news)[0] && !bypass) {
    return { articles: get(news), fresh: false };
  }
  const smartFetch = servFetch ?? fetch;
  const newsSources = [smartFetch(SERVER_API, { compress: true })];
  if (dynasty) {
    newsSources.push(getFeed(REDDIT_DYNASTY, processReddit));
  } else {
    newsSources.push(getFeed(REDDIT_FANTASY, processReddit));
  }

  // Each source fails independently: one dead feed (Reddit throttles
  // automated requests often) should cost us that feed's articles, not
  // the whole page. The old `const [a, b] = await ...catch(console.error)`
  // destructured undefined on any rejection and crashed the page with
  // "(intermediate value) is not iterable".
  const results = await Promise.allSettled(newsSources);

  let serverData = [];
  if (results[0].status === "fulfilled" && results[0].value) {
    serverData = await results[0].value.json().catch((err) => {
      console.error(err);
      return [];
    });
  }
  if (!Array.isArray(serverData)) serverData = [];

  let reddit = [];
  if (results[1]?.status === "fulfilled" && Array.isArray(results[1].value)) {
    reddit = results[1].value;
  }

  const articles = [...reddit, ...serverData].sort((a, b) =>
    a.ts < b.ts ? 1 : -1,
  );
  news.update(() => articles);

  return { articles, fresh: true };
};

const getFeed = async (feed, callback) => {
  const res = await fetch(feed, { compress: true }).catch((err) => {
    console.error(err);
    return null;
  });
  if (!res) return [];

  const data = await res.json().catch((err) => {
    console.error(err);
    return null;
  });

  if (res.ok && data && data.data) {
    return callback(data.data);
  } else {
    console.error(data);
    return [];
  }
};

const processReddit = (rawArticles) => {
  const bannedAuthors = ["AutoModerator", "FFBot", "Brookskbrothers", "FTAKJ"];
  const bannedIcons = ["", "self", "thumbnail", "default"];
  let finalArticles = [];
  const children = rawArticles.children;
  for (const rawArticle of children) {
    const data = rawArticle.data;
    if (bannedAuthors.includes(data.author)) {
      continue;
    }
    const ts = data.created_utc * 1000;
    const d = new Date(ts);
    const icon = !bannedIcons.includes(data.thumbnail)
      ? data.thumbnail
      : `newsIcons/${data.subreddit}.png`;
    const date = stringDate(d);
    let article = `<a href="${data.url}" class="body-link">${data.url}</a>`;
    if (data.selftext_html) {
      article = decodeHTML(data.selftext_html);
    }
    if (data.secure_media_embed?.content) {
      decodeHTML(data.secure_media_embed.content);
    }
    finalArticles.push({
      title: data.title,
      article,
      link: `https://www.reddit.com${data.permalink}`,
      author: `${data.subreddit_name_prefixed} - u/${data.author}`,
      ts,
      date,
      icon,
    });
  }
  return finalArticles;
};

var htmlEntities = {
  nbsp: " ",
  cent: "¢",
  pound: "£",
  yen: "¥",
  euro: "€",
  copy: "©",
  reg: "®",
  lt: "<",
  gt: ">",
  quot: '"',
  amp: "&",
  apos: "'",
};

function decodeHTML(str) {
  return str.replace(/\&([^;]+);/g, function (entity, entityCode) {
    let match;

    if (entityCode in htmlEntities) {
      return htmlEntities[entityCode];
      /*eslint no-cond-assign: 0*/
    } else if ((match = entityCode.match(/^#x([\da-fA-F]+)$/))) {
      return String.fromCharCode(parseInt(match[1], 16));
      /*eslint no-cond-assign: 0*/
    } else if ((match = entityCode.match(/^#(\d+)$/))) {
      return String.fromCharCode(~~match[1]);
    } else {
      return entity;
    }
  });
}

export const stringDate = (d) => {
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()} ${d.getHours() % 12}:${(d.getMinutes() < 10 ? "0" : "") + d.getMinutes()}${d.getHours() / 12 >= 1 ? "PM" : "AM"}`;
};
