/**
 * popup.js
 * Browser action popup script.
 * Controls currently playing song queries, manual searches, API key settings, and history caching.
 */

document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const currentTitleEl = document.getElementById('current-title');
  const currentArtistEl = document.getElementById('current-artist');
  const currentBpmValueEl = document.getElementById('current-bpm-value');
  const bpmRingEl = document.querySelector('.bpm-ring');

  const btnSettings = document.getElementById('btn-settings');
  const settingsDrawer = document.getElementById('settings-drawer');
  const inputApiKey = document.getElementById('input-api-key');
  const btnSaveSettings = document.getElementById('btn-save-settings');

  const searchForm = document.getElementById('search-form');
  const inputTitle = document.getElementById('input-title');
  const inputArtist = document.getElementById('input-artist');

  const resultCard = document.getElementById('search-result-card');
  const resultTrackInfoEl = document.getElementById('result-track-info');
  const resultBpmEl = document.getElementById('result-bpm');
  const closeResultBtn = document.getElementById('close-result');

  const historyListEl = document.getElementById('history-list');

  // Initialize
  checkActiveSong();
  loadHistory();
  loadSettings();

  // Settings Drawer Toggle
  btnSettings.addEventListener('click', () => {
    settingsDrawer.classList.toggle('collapsed');
  });

  // Save Settings Click Handler
  btnSaveSettings.addEventListener('click', () => {
    const apiKey = inputApiKey.value.trim();
    
    chrome.storage.local.set({ getSongBpmKey: apiKey || null }, () => {
      // Provide visual feedback for saving
      const originalText = btnSaveSettings.textContent;
      btnSaveSettings.textContent = 'Saved!';
      btnSaveSettings.style.background = 'rgba(0, 255, 128, 0.15)';
      btnSaveSettings.style.color = '#00ff80';
      btnSaveSettings.style.border = '1px solid rgba(0, 255, 128, 0.3)';

      setTimeout(() => {
        btnSaveSettings.textContent = originalText;
        btnSaveSettings.style.background = '';
        btnSaveSettings.style.color = '';
        btnSaveSettings.style.border = '';
      }, 1500);

      // Re-trigger song check to query using the newly configured API key
      checkActiveSong();
    });
  });

  // Search form submit listener
  searchForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const title = inputTitle.value.trim();
    const artist = inputArtist.value.trim();

    if (!title || !artist) return;

    // Show loading state in manual result card
    resultCard.classList.remove('hidden');
    resultCard.style.borderColor = 'rgba(255, 0, 85, 0.3)';
    resultCard.style.background = 'linear-gradient(135deg, rgba(255, 0, 85, 0.03) 0%, rgba(255, 255, 255, 0.02) 100%)';
    resultTrackInfoEl.textContent = `${title} - ${artist}`;
    resultBpmEl.textContent = 'Searching...';
    resultBpmEl.style.background = 'rgba(255, 255, 255, 0.08)';
    resultBpmEl.style.color = '#fff';
    resultBpmEl.style.borderColor = 'rgba(255, 255, 255, 0.15)';

    chrome.runtime.sendMessage({ action: "getBpm", title, artist }, (response) => {
      if (chrome.runtime.lastError) {
        showErrorResult('Connection error.');
        return;
      }

      if (response && response.success) {
        showSuccessResult(title, artist, response.bpm);
        saveToHistory(title, artist, response.bpm);
      } else {
        showErrorResult(response ? response.error : 'BPM not found.');
      }
    });
  });

  // Close manual result card listener
  closeResultBtn.addEventListener('click', () => {
    resultCard.classList.add('hidden');
  });

  // Checks the current song playing on YTM via content script query
  function checkActiveSong() {
    chrome.tabs.query({ url: "*://music.youtube.com/*" }, (tabs) => {
      if (!tabs || tabs.length === 0) {
        setNoActiveSong();
        return;
      }

      const activeTab = tabs[0];
      chrome.tabs.sendMessage(activeTab.id, { action: "getCurrentSong" }, (response) => {
        if (chrome.runtime.lastError || !response || !response.success) {
          setNoActiveSong();
          return;
        }

        // Update popup currently playing track
        currentTitleEl.textContent = response.title;
        currentArtistEl.textContent = response.artist;
        
        if (response.bpm && response.bpm !== "N/A" && response.bpm !== "null") {
          currentBpmValueEl.textContent = response.bpm;
          bpmRingEl.style.animation = `pulse-ring ${60 / parseFloat(response.bpm)}s infinite ease-in-out`;
        } else if (response.bpm === "N/A") {
          currentBpmValueEl.textContent = "N/A";
          bpmRingEl.style.animation = 'none';
        } else {
          // Song changed but background query hasn't finished yet in content script
          currentBpmValueEl.textContent = "...";
          bpmRingEl.style.animation = 'pulse-ring 1.5s infinite ease-in-out';
          
          // Re-fetch directly via background script to double-check
          chrome.runtime.sendMessage({ action: "getBpm", title: response.title, artist: response.artist }, (bgResponse) => {
            if (bgResponse && bgResponse.success) {
              currentBpmValueEl.textContent = bgResponse.bpm;
              bpmRingEl.style.animation = `pulse-ring ${60 / parseFloat(bgResponse.bpm)}s infinite ease-in-out`;
            } else {
              currentBpmValueEl.textContent = "N/A";
              bpmRingEl.style.animation = 'none';
            }
          });
        }
      });
    });
  }

  function setNoActiveSong() {
    currentTitleEl.textContent = "No Active Song";
    currentArtistEl.textContent = "Play a song on YouTube Music";
    currentBpmValueEl.textContent = "--";
    bpmRingEl.style.animation = 'none';
  }

  function showSuccessResult(title, artist, bpm) {
    resultCard.style.borderColor = 'rgba(0, 255, 128, 0.3)';
    resultCard.style.background = 'linear-gradient(135deg, rgba(0, 255, 128, 0.03) 0%, rgba(255, 255, 255, 0.02) 100%)';
    resultBpmEl.textContent = `${bpm} BPM`;
    resultBpmEl.style.background = 'rgba(0, 255, 128, 0.15)';
    resultBpmEl.style.color = '#00ff80';
    resultBpmEl.style.borderColor = 'rgba(0, 255, 128, 0.3)';
  }

  function showErrorResult(errorMsg) {
    resultBpmEl.textContent = 'N/A';
    resultBpmEl.style.background = 'rgba(255, 255, 255, 0.05)';
    resultBpmEl.style.color = '#888';
    resultBpmEl.style.borderColor = 'rgba(255, 255, 255, 0.15)';
    
    // Log details in title hover
    resultTrackInfoEl.title = errorMsg;
  }

  // Settings configuration
  function loadSettings() {
    chrome.storage.local.get(['getSongBpmKey'], (result) => {
      if (result.getSongBpmKey) {
        inputApiKey.value = result.getSongBpmKey;
      }
    });
  }

  // Storage / History Logic
  function loadHistory() {
    chrome.storage.local.get(['bpmHistory'], (result) => {
      const history = result.bpmHistory || [];
      renderHistory(history);
    });
  }

  function saveToHistory(title, artist, bpm) {
    chrome.storage.local.get(['bpmHistory'], (result) => {
      let history = result.bpmHistory || [];
      
      // Filter out duplicate entries of the same song
      history = history.filter(item => 
        !(item.title.toLowerCase() === title.toLowerCase() && 
          item.artist.toLowerCase() === artist.toLowerCase())
      );

      // Add to front of queue
      history.unshift({ title, artist, bpm, timestamp: Date.now() });

      // Limit to 5 history items
      if (history.length > 5) {
        history.pop();
      }

      chrome.storage.local.set({ bpmHistory: history }, () => {
        renderHistory(history);
      });
    });
  }

  function renderHistory(history) {
    historyListEl.innerHTML = '';

    if (history.length === 0) {
      const emptyLi = document.createElement('li');
      emptyLi.className = 'empty-history';
      emptyLi.textContent = 'No search history yet.';
      historyListEl.appendChild(emptyLi);
      return;
    }

    history.forEach(item => {
      const li = document.createElement('li');
      li.className = 'history-item';

      const metaDiv = document.createElement('div');
      metaDiv.className = 'history-meta';

      const titleDiv = document.createElement('div');
      titleDiv.className = 'history-title';
      titleDiv.textContent = item.title;
      titleDiv.title = item.title;

      const artistDiv = document.createElement('div');
      artistDiv.className = 'history-artist';
      artistDiv.textContent = item.artist;
      artistDiv.title = item.artist;

      metaDiv.appendChild(titleDiv);
      metaDiv.appendChild(artistDiv);

      const bpmDiv = document.createElement('div');
      bpmDiv.className = 'history-bpm';
      bpmDiv.textContent = `${item.bpm} BPM`;

      li.appendChild(metaDiv);
      li.appendChild(bpmDiv);
      historyListEl.appendChild(li);
    });
  }
});
