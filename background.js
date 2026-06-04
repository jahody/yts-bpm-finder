/**
 * background.js
 * Service worker for the YouTube Music BPM Finder Chrome Extension.
 * Queries the GetSongBPM API for song BPM values with robust fallbacks.
 */

// Simple in-memory cache for BPM values
const bpmCache = new Map();

// Clean song title (remove features, official labels, singles, radio edits)
function cleanTitle(title) {
  if (!title) return "";
  return title
    .replace(/\s*[\(\[][fF]eat\..*?[\)\]]/g, "") 
    .replace(/\s*[\(\[][fF]t\..*?[\)\]]/g, "") 
    .replace(/\s*[\(\[][oO]fficial.*?[\)\]]/i, "") 
    .replace(/\s*[\(\[][lL]yric.*?[\)\]]/i, "") 
    .replace(/\s*-\s*Single$/i, "") 
    .replace(/\s*-\s*Radio Edit$/i, "")
    .trim();
}

// Parse artist names from a potentially joint artist string (split by &, x, feat, etc.)
function parseArtists(artistStr) {
  if (!artistStr) return [];
  const separators = [/\s*&\s*/, /\s*,\s*/, /\s+x\s+/i, /\s+feat\.?\s+/i, /\s+ft\.?\s+/i, /\s+and\s+/i, /\s*\/\s*/];
  let parts = [artistStr];
  for (const sep of separators) {
    let newParts = [];
    for (const p of parts) {
      newParts = newParts.concat(p.split(sep));
    }
    parts = newParts;
  }
  return parts.map(p => p.trim()).filter(p => p.length > 0);
}

// Clean artist name (remove leading articles like "The", "A", "An")
function cleanArtist(artist) {
  if (!artist) return "";
  return artist.replace(/^(the|a|an)\s+/i, "").trim();
}

// Helper to fetch user API key from local storage
function getApiKey() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['getSongBpmKey'], (result) => {
      resolve(result.getSongBpmKey || null);
    });
  });
}

// Helper to query GetSongBPM endpoint
async function fetchFromGetSongBpm(params, apiKey) {
  const queryStr = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");
  const url = `https://api.getsong.co/search/?${queryStr}&api_key=${apiKey}`;
  
  const response = await fetch(url, {
    headers: {
      "Accept": "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`GetSongBPM HTTP error! status: ${response.status}`);
  }

  return response.json();
}

/**
 * Retrieve song metadata including BPM using a multi-step query resolution strategy.
 */
async function fetchGetSongBpm(title, artist, apiKey) {
  const cTitle = cleanTitle(title);
  const artists = parseArtists(artist);
  
  if (artists.length === 0) {
    throw new Error("Artist name is missing or invalid.");
  }

  console.log(`[YTM BPM] Fetching BPM for: "${cTitle}" | Parsed Artists:`, artists);

  // Attempt 1: Search using type=both with the primary artist
  try {
    const data = await fetchFromGetSongBpm({ type: "both", lookup: `song:${cTitle} artist:${artists[0]}` }, apiKey);
    if (data && data.search && Array.isArray(data.search) && data.search.length > 0) {
      const tempo = parseInt(data.search[0].tempo, 10);
      if (!isNaN(tempo) && tempo > 0) {
        console.log(`[YTM BPM] Attempt 1 Success: Resolved ${tempo} BPM`);
        return tempo;
      }
    }
  } catch (err) {
    console.warn("[YTM BPM] Attempt 1 query error:", err.message);
  }

  // Attempt 2: Clean the primary artist name (remove "The", "A", etc.) and retry
  const cleanedPrimary = cleanArtist(artists[0]);
  if (cleanedPrimary !== artists[0]) {
    try {
      const data = await fetchFromGetSongBpm({ type: "both", lookup: `song:${cTitle} artist:${cleanedPrimary}` }, apiKey);
      if (data && data.search && Array.isArray(data.search) && data.search.length > 0) {
        const tempo = parseInt(data.search[0].tempo, 10);
        if (!isNaN(tempo) && tempo > 0) {
          console.log(`[YTM BPM] Attempt 2 (Cleaned Artist) Success: Resolved ${tempo} BPM`);
          return tempo;
        }
      }
    } catch (err) {
      console.warn("[YTM BPM] Attempt 2 query error:", err.message);
    }
  }

  // Attempt 3: Try other alternative/featured artists if present
  if (artists.length > 1) {
    for (let i = 1; i < artists.length; i++) {
      try {
        const data = await fetchFromGetSongBpm({ type: "both", lookup: `song:${cTitle} artist:${artists[i]}` }, apiKey);
        if (data && data.search && Array.isArray(data.search) && data.search.length > 0) {
          const tempo = parseInt(data.search[0].tempo, 10);
          if (!isNaN(tempo) && tempo > 0) {
            console.log(`[YTM BPM] Attempt 3.${i} Success: Resolved ${tempo} BPM`);
            return tempo;
          }
        }
      } catch (err) {
        console.warn(`[YTM BPM] Attempt 3.${i} query error:`, err.message);
      }

      // Try cleaned version of alternative artist
      const cleanedAlt = cleanArtist(artists[i]);
      if (cleanedAlt !== artists[i]) {
        try {
          const data = await fetchFromGetSongBpm({ type: "both", lookup: `song:${cTitle} artist:${cleanedAlt}` }, apiKey);
          if (data && data.search && Array.isArray(data.search) && data.search.length > 0) {
            const tempo = parseInt(data.search[0].tempo, 10);
            if (!isNaN(tempo) && tempo > 0) {
              console.log(`[YTM BPM] Attempt 3.${i} (Cleaned Alt) Success: Resolved ${tempo} BPM`);
              return tempo;
            }
          }
        } catch (err) {
          console.warn(`[YTM BPM] Attempt 3.${i} Cleaned query error:`, err.message);
        }
      }
    }
  }

  // Attempt 4: Song title only search, with manual client-side artist verification
  try {
    console.log(`[YTM BPM] Attempting song-only fallback for: "${cTitle}"`);
    const data = await fetchFromGetSongBpm({ type: "song", lookup: cTitle }, apiKey);
    if (data && data.search && Array.isArray(data.search) && data.search.length > 0) {
      const match = data.search.find(item => {
        if (!item.artist || !item.artist.name) return false;
        const dbArtist = item.artist.name.toLowerCase();
        
        return artists.some(a => {
          const queryArt = a.toLowerCase();
          const cleanQueryArt = cleanArtist(queryArt);
          const cleanDbArtist = cleanArtist(dbArtist);
          
          return queryArt.includes(dbArtist) || 
                 dbArtist.includes(queryArt) || 
                 cleanQueryArt.includes(cleanDbArtist) ||
                 cleanDbArtist.includes(cleanQueryArt);
        });
      });

      if (match) {
        const tempo = parseInt(match.tempo, 10);
        if (!isNaN(tempo) && tempo > 0) {
          console.log(`[YTM BPM] Attempt 4 Success: Match found: "${match.title}" by "${match.artist.name}" -> ${tempo} BPM`);
          return tempo;
        }
      }
    }
  } catch (err) {
    console.warn("[YTM BPM] Attempt 4 query error:", err.message);
  }

  throw new Error("Track not found or BPM missing in GetSongBPM database.");
}

/**
 * Main orchestrator function.
 * Checks the in-memory cache, retrieves the API key, queries the API, and caches the result.
 */
async function getBpmForSong(songTitle, artistName) {
  if (!songTitle || !artistName) {
    throw new Error("Song title and artist name are required.");
  }

  const cacheKey = `${songTitle.toLowerCase().trim()} - ${artistName.toLowerCase().trim()}`;
  if (bpmCache.has(cacheKey)) {
    console.log(`[YTM BPM] Cache hit for: ${cacheKey}`);
    return bpmCache.get(cacheKey);
  }

  const apiKey = await getApiKey();
  if (!apiKey) {
    throw new Error("API Key is missing. Set your key in extension settings.");
  }

  const bpm = await fetchGetSongBpm(songTitle, artistName, apiKey);

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
