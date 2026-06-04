/**
 * background.js
 * Service worker for the YouTube Music BPM Finder Chrome Extension.
 * Queries the GetSongBPM API for song BPM values.
 */

// Simple in-memory cache for BPM values
const bpmCache = new Map();

// Helper to clean search terms (remove features, official video suffixes, etc.)
function cleanSearchTerm(term) {
  if (!term) return "";
  return term
    .replace(/\s*[\(\[][fF]eat\..*?[\)\]]/g, "") // remove (feat. ...) or [feat. ...]
    .replace(/\s*[\(\[][oO]fficial.*?[\)\]]/i, "") // remove (Official Audio), [Official Video]
    .replace(/\s*[\(\[][lL]yric.*?[\)\]]/i, "") // remove (Lyric Video), [Lyrics]
    .replace(/\s*-\s*Single$/i, "") // remove - Single
    .trim();
}

// Helper to fetch user API key from local storage
function getApiKey() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['getSongBpmKey'], (result) => {
      resolve(result.getSongBpmKey || null);
    });
  });
}

// Generic helper to fetch JSON
async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      "Accept": "application/json"
    }
  });

  if (!response.ok) {
    const err = new Error(`HTTP error! status: ${response.status}`);
    err.status = response.status;
    throw err;
  }

  return response.json();
}

/**
 * Query GetSongBPM API to retrieve song metadata including BPM.
 */
async function fetchGetSongBpm(title, artist, apiKey) {
  const url = `https://api.getsong.co/search/?type=both&lookup=song:${encodeURIComponent(title)} artist:${encodeURIComponent(artist)}&api_key=${apiKey}`;
  console.log("Querying GetSongBPM API for:", title, "by", artist);
  
  const data = await fetchJson(url);
  
  if (Array.isArray(data) && data.length > 0) {
    const item = data[0];
    if (item.bpm) {
      const parsed = parseInt(item.bpm, 10);
      if (!isNaN(parsed) && parsed > 0) {
        return parsed;
      }
    }
  }
  throw new Error("Track not found or BPM missing in GetSongBPM database.");
}

/**
 * Main orchestrator function.
 * Checks for GetSongBPM API key, then fetches BPM from the API.
 */
async function getBpmForSong(songTitle, artistName) {
  if (!songTitle || !artistName) {
    throw new Error("Song title and artist name are required.");
  }

  const cacheKey = `${songTitle.toLowerCase().trim()} - ${artistName.toLowerCase().trim()}`;
  if (bpmCache.has(cacheKey)) {
    return bpmCache.get(cacheKey);
  }

  const cleanTitle = cleanSearchTerm(songTitle);
  const cleanArtist = cleanSearchTerm(artistName);

  const apiKey = await getApiKey();
  if (!apiKey) {
    throw new Error("API Key is missing. Set your key in extension settings.");
  }

  const bpm = await fetchGetSongBpm(cleanTitle, cleanArtist, apiKey);

  // Save to cache
  bpmCache.set(cacheKey, bpm);
  return bpm;
}

// Listen for messages from the content script or popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getBpm") {
    const { title, artist } = request;
    
    getBpmForSong(title, artist)
      .then(bpm => {
        sendResponse({ success: true, bpm });
      })
      .catch(err => {
        sendResponse({ success: false, error: err.message });
      });

    // Keep response channel open for async callback
    return true;
  }
});
