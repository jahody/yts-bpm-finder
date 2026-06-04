/**
 * bpmFinder.js
 * Standalone JavaScript utility function for a Chrome Extension to retrieve the BPM of a track.
 * Queries the GetSongBPM API with robust query resolution and fallback matching.
 */

// Helper to clean song title (remove features, official labels, singles, radio edits)
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
 * Retrieves the Beats Per Minute (BPM) for a song by querying the GetSongBPM API.
 * 
 * @param {string} songTitle - The title of the track.
 * @param {string} artistName - The name of the artist.
 * @param {string} apiKey - The GetSongBPM API key.
 * @returns {Promise<number>} Resolves with the BPM value.
 * @throws {Error} Throws if parameters are missing, track is not found, or API error occurs.
 */
async function getBpmForSong(songTitle, artistName, apiKey) {
  if (!songTitle || !artistName) {
    throw new Error("Invalid arguments: songTitle and artistName are required.");
  }
  if (!apiKey) {
    throw new Error("Invalid arguments: apiKey is required.");
  }

  const cTitle = cleanTitle(songTitle);
  const artists = parseArtists(artistName);
  
  if (artists.length === 0) {
    throw new Error("Artist name is missing or invalid.");
  }

  // Attempt 1: Search using type=both with the primary artist
  try {
    const data = await fetchFromGetSongBpm({ type: "both", lookup: `song:${cTitle} artist:${artists[0]}` }, apiKey);
    if (data && data.search && Array.isArray(data.search) && data.search.length > 0) {
      const tempo = parseInt(data.search[0].tempo, 10);
      if (!isNaN(tempo) && tempo > 0) return tempo;
    }
  } catch (err) {
    // Fail silently to proceed to next fallbacks
  }

  // Attempt 2: Clean the primary artist name (remove "The", "A", etc.) and retry
  const cleanedPrimary = cleanArtist(artists[0]);
  if (cleanedPrimary !== artists[0]) {
    try {
      const data = await fetchFromGetSongBpm({ type: "both", lookup: `song:${cTitle} artist:${cleanedPrimary}` }, apiKey);
      if (data && data.search && Array.isArray(data.search) && data.search.length > 0) {
        const tempo = parseInt(data.search[0].tempo, 10);
        if (!isNaN(tempo) && tempo > 0) return tempo;
      }
    } catch (err) {
      // Fail silently to proceed to next fallbacks
    }
  }

  // Attempt 3: Try other alternative/featured artists if present
  if (artists.length > 1) {
    for (let i = 1; i < artists.length; i++) {
      try {
        const data = await fetchFromGetSongBpm({ type: "both", lookup: `song:${cTitle} artist:${artists[i]}` }, apiKey);
        if (data && data.search && Array.isArray(data.search) && data.search.length > 0) {
          const tempo = parseInt(data.search[0].tempo, 10);
          if (!isNaN(tempo) && tempo > 0) return tempo;
        }
      } catch (err) {
        // Fail silently
      }

      const cleanedAlt = cleanArtist(artists[i]);
      if (cleanedAlt !== artists[i]) {
        try {
          const data = await fetchFromGetSongBpm({ type: "both", lookup: `song:${cTitle} artist:${cleanedAlt}` }, apiKey);
          if (data && data.search && Array.isArray(data.search) && data.search.length > 0) {
            const tempo = parseInt(data.search[0].tempo, 10);
            if (!isNaN(tempo) && tempo > 0) return tempo;
          }
        } catch (err) {
          // Fail silently
        }
      }
    }
  }

  // Attempt 4: Song title only search, with manual client-side artist verification
  try {
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
        if (!isNaN(tempo) && tempo > 0) return tempo;
      }
    }
  } catch (err) {
    // Fail silently to throw generic error
  }

  throw new Error(`BPM data was not found in the GetSongBPM payload for "${songTitle}" by ${artistName}.`);
}
