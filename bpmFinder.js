/**
 * bpmFinder.js
 * Standalone JavaScript utility function for a Chrome Extension to retrieve the BPM of a track.
 * Queries the GetSongBPM API.
 */

// Helper to clean search queries
function cleanSearchQuery(term) {
  if (!term) return "";
  return term
    .replace(/\s*[\(\[][fF]eat\..*?[\)\]]/g, "") // remove (feat. ...) or [feat. ...]
    .replace(/\s*[\(\[][oO]fficial.*?[\)\]]/i, "") // remove (Official Audio), [Official Video]
    .replace(/\s*[\(\[][lL]yric.*?[\)\]]/i, "") // remove (Lyric Video), [Lyrics]
    .replace(/\s*-\s*Single$/i, "") // remove - Single
    .trim();
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

  const cleanTitle = cleanSearchQuery(songTitle);
  const cleanArtist = cleanSearchQuery(artistName);

  const url = `https://api.getsong.co/search/?type=both&lookup=song:${encodeURIComponent(cleanTitle)} artist:${encodeURIComponent(cleanArtist)}&api_key=${apiKey}`;

  const response = await fetch(url, {
    headers: {
      "Accept": "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`GetSongBPM API error! Status: ${response.status}`);
  }

  const data = await response.json();

  if (Array.isArray(data) && data.length > 0) {
    const item = data[0];
    if (item.bpm) {
      const parsed = parseInt(item.bpm, 10);
      if (!isNaN(parsed) && parsed > 0) {
        return parsed;
      }
    }
  }

  throw new Error(`BPM data was not found in the GetSongBPM payload for "${songTitle}" by ${artistName}.`);
}
