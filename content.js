/**
 * content.js
 * Content script for YouTube Music.
 * Monitors song playback, detects changes, and injects a sleek BPM badge.
 */

// Inject styles for the BPM badge
const style = document.createElement('style');
style.textContent = `
  .ytm-bpm-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, rgba(255, 0, 85, 0.2), rgba(136, 0, 255, 0.2));
    color: #ff0055;
    border: 1px solid rgba(255, 0, 85, 0.4);
    padding: 3px 8px;
    border-radius: 20px;
    font-size: 11px;
    font-weight: 700;
    margin-left: 12px;
    vertical-align: middle;
    letter-spacing: 0.5px;
    box-shadow: 0 0 8px rgba(255, 0, 85, 0.15);
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    cursor: pointer;
    font-family: 'Roboto', 'Inter', sans-serif;
    user-select: none;
  }
  
  .ytm-bpm-badge:hover {
    box-shadow: 0 0 15px rgba(255, 0, 85, 0.4);
    transform: scale(1.05);
    background: linear-gradient(135deg, rgba(255, 0, 85, 0.3), rgba(136, 0, 255, 0.3));
  }

  .ytm-bpm-badge.not-found {
    background: rgba(255, 255, 255, 0.05);
    color: #888;
    border: 1px solid rgba(255, 255, 255, 0.1);
    box-shadow: none;
  }

  .ytm-bpm-badge.not-found:hover {
    background: rgba(255, 255, 255, 0.08);
    transform: none;
    box-shadow: none;
  }

  /* Micro-animation for beat indicator */
  .ytm-bpm-badge::before {
    content: "♩";
    margin-right: 4px;
    font-size: 13px;
    display: inline-block;
  }

  @keyframes pulse {
    0% { transform: scale(1); }
    50% { transform: scale(1.15); }
    100% { transform: scale(1); }
  }

  .ytm-bpm-badge:not(.not-found)::before {
    animation: pulse 1.2s infinite ease-in-out;
  }
`;
document.head.appendChild(style);

let currentTitle = "";
let currentArtist = "";
let badgeElement = null;

// Remove any existing badge
function removeBpmBadge() {
  if (badgeElement) {
    badgeElement.remove();
    badgeElement = null;
  }
  const existing = document.getElementById('ytm-bpm-badge');
  if (existing) {
    existing.remove();
  }
}

// Inject BPM badge next to the song title
function injectBpmBadge(bpm) {
  removeBpmBadge();

  const titleEl = document.querySelector('ytmusic-player-bar .title');
  if (!titleEl) return;

  const badge = document.createElement('span');
  badge.id = 'ytm-bpm-badge';
  
  if (bpm === "N/A") {
    badge.className = 'ytm-bpm-badge not-found';
    badge.textContent = 'N/A';
    badge.title = "BPM not found in database";
  } else {
    badge.className = 'ytm-bpm-badge';
    badge.textContent = `${bpm} BPM`;
    badge.title = `Tempo: ${bpm} BPM (Click to search on GetSongBPM)`;
    
    // Add clickable action to open GetSongBPM database for details
    badge.addEventListener('click', (e) => {
      e.stopPropagation();
      const query = encodeURIComponent(`${currentTitle} ${currentArtist}`);
      window.open(`https://getsongbpm.com/search?q=${query}`, '_blank');
    });
  }

  // Insert next to title element
  titleEl.parentNode.insertBefore(badge, titleEl.nextSibling);
  badgeElement = badge;
}

// Check if the current song has changed
function checkSongChange() {
  const titleEl = document.querySelector('ytmusic-player-bar .title');
  const bylineEl = document.querySelector('ytmusic-player-bar .byline');

  if (!titleEl) return;

  const title = titleEl.textContent.trim();
  const bylineText = bylineEl ? bylineEl.textContent.trim() : "";
  
  // Extract artist (usually before the bullet character)
  const artist = bylineText.split('•')[0].trim();

  if (title && (title !== currentTitle || artist !== currentArtist)) {
    currentTitle = title;
    currentArtist = artist;
    console.log(`[YTM BPM] Song changed: "${title}" by "${artist}"`);
    
    // Immediately show loading/remove old badge
    removeBpmBadge();

    // Query the background script for BPM
    chrome.runtime.sendMessage({ action: "getBpm", title, artist }, response => {
      if (chrome.runtime.lastError) {
        console.warn("[YTM BPM] Runtime error:", chrome.runtime.lastError.message);
        return;
      }

      // Ensure we are still on the same song when response returns
      const freshTitleEl = document.querySelector('ytmusic-player-bar .title');
      const freshTitle = freshTitleEl ? freshTitleEl.textContent.trim() : "";
      if (freshTitle !== title) {
        console.log("[YTM BPM] Track changed before API response returned. Skipping badge injection.");
        return;
      }

      if (response && response.success) {
        injectBpmBadge(response.bpm);
      } else {
        console.log(`[YTM BPM] Failed to fetch BPM: ${response ? response.error : 'No response'}`);
        injectBpmBadge("N/A");
      }
    });
  }
}

// Initialize Observer on the YouTube Music Player Bar
function startObserver() {
  const target = document.querySelector('ytmusic-player-bar');
  if (!target) {
    // Player bar not loaded yet, retry
    setTimeout(startObserver, 1000);
    return;
  }

  console.log("[YTM BPM] Active player bar detected. Observing changes...");
  
  // Perform initial check in case page was refreshed while playing
  checkSongChange();

  // Create observer to watch for title / byline modifications
  const observer = new MutationObserver(() => {
    checkSongChange();
  });

  // Start observing
  observer.observe(target, {
    childList: true,
    subtree: true,
    characterData: true
  });
}

// Listen for messages from the extension popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getCurrentSong") {
    const titleEl = document.querySelector('ytmusic-player-bar .title');
    const bylineEl = document.querySelector('ytmusic-player-bar .byline');
    
    if (titleEl) {
      const title = titleEl.textContent.trim();
      const bylineText = bylineEl ? bylineEl.textContent.trim() : "";
      const artist = bylineText.split('•')[0].trim();
      
      // Extract the BPM from our injected badge if it exists
      const badgeEl = document.getElementById('ytm-bpm-badge');
      let bpm = null;
      if (badgeEl) {
        const text = badgeEl.textContent.replace(' BPM', '').trim();
        bpm = text;
      }
      
      sendResponse({ success: true, title, artist, bpm });
    } else {
      sendResponse({ success: false, error: "No active song detected in player bar." });
    }
  }
  return false;
});

// Run script
startObserver();
