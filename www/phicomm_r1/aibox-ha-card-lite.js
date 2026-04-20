// ═══════════════════════════════════════════════════════════════════
// Aibox Ha Lite Card — Media-only (derived from aibox-ha-card.js)
// Chỉ giữ tab Media: waveform, seek, controls, volume, search,
// playlist, multiroom sync bar + volume sliders
// ═══════════════════════════════════════════════════════════════════

const DEFAULTS = {
  host: "", ws_port: 8082, speaker_port: 8080, http_port: 8081,
  custom_ws_url: "",
  custom_speaker_ws_url: "",
  tunnel_host: "", tunnel_port: 443, tunnel_path: "/",
  speaker_tunnel_host: "", speaker_tunnel_port: 443, speaker_tunnel_path: "/",
  mode: "auto", title: "AI BOX Media",
  rooms: null,
  default_tab: "media", show_background: true,
  reconnect_ms: 1500, connect_timeout_ms: 2500,
  sync_send_song: true,
  auto_sync_delay_ms: 5000,
  sync_pause_ms: 400,
  sync_resume_delay_ms: 3000,
};

const VOICES = {1:'Ngọc Anh',2:'Minh Anh',3:'Khánh An',4:'Bảo Ngọc',5:'Thanh Mai',6:'Hà My',7:'Thùy Dung',8:'Diệu Linh',9:'Lan Anh',10:'Ngọc Hà',11:'Mai Anh',12:'Bảo Châu',13:'Tú Linh',14:'An Nhiên',15:'Minh Khang',16:'Hoàng Nam',17:'Gia Huy',18:'Đức Anh',19:'Quang Minh',20:'Bảo Long',21:'Hải Đăng',22:'Tuấn Kiệt',23:'Nhật Minh',24:'Anh Dũng',25:'Trung Kiên',26:'Khánh Duy',27:'Phúc An',28:'Thành Đạt',29:'Hữu Phước',30:'Thiên Ân'};
const VFILES = {1:'ngocanh',2:'minhanh',3:'khanhan',4:'baongoc',5:'thanhmai',6:'hamy',7:'thuydung',8:'dieulinh',9:'lananh',10:'ngocha',11:'maianh',12:'baochau',13:'tulinh',14:'annhien',15:'minhkhang',16:'hoangnam',17:'giahuy',18:'ducanh',19:'quangminh',20:'baolong',21:'haidang',22:'tuankiet',23:'nhatminh',24:'anhdung',25:'trungkien',26:'khanhduy',27:'phucan',28:'thanhdat',29:'huuphuoc',30:'thienan'};
const VBASE = 'https://r1.truongblack.me/download/';

const ROOM_COLORS = ['#a78bfa','#34d399','#fb923c','#f472b6','#38bdf8','#facc15','#4ade80','#e879f9'];

class PhicommR1LiteCard extends HTMLElement {
  static getStubConfig() { return { mode: "auto", title: "AI BOX Media", rooms: [] }; }
  static getConfigElement() { return null; }

  _lsKey(k) { return `r1lite_${(this._config?.title||'card').replace(/\W+/g,'_')}_${k}`; }
  _lsGet(k) { try { const v = localStorage.getItem(this._lsKey(k)); return v !== null ? JSON.parse(v) : null; } catch { return null; } }
  _lsSet(k, v) { try { localStorage.setItem(this._lsKey(k), JSON.stringify(v)); } catch {} }

  setConfig(config) {
    if (!config) throw new Error("Thiếu cấu hình");
    this._config = { ...DEFAULTS, ...(config || {}) };

    this._rooms = Array.isArray(this._config.rooms) && this._config.rooms.length
      ? this._config.rooms.map((r, i) => ({
          name: r.name || `Loa ${i + 1}`,
          host: (r.host || "").trim() || window.location.hostname,
          tunnel_host: (r.tunnel_host || "").trim(),
          tunnel_port: Number(r.tunnel_port || 443),
          tunnel_path: (r.tunnel_path || "/").trim() || "/",
          custom_ws_url: (r.custom_ws_url || "").trim(),
          speaker_tunnel_host: (r.speaker_tunnel_host || "").trim(),
          speaker_tunnel_port: Number(r.speaker_tunnel_port || 443),
          speaker_tunnel_path: (r.speaker_tunnel_path || "/").trim() || "/",
          custom_speaker_ws_url: (r.custom_speaker_ws_url || "").trim(),
        }))
      : null;

    if (this._rooms) {
      if (this._currentRoomIdx === undefined) {
        const savedIdx = this._lsGet('roomIdx');
        this._currentRoomIdx = (savedIdx !== null && savedIdx >= 0 && savedIdx < this._rooms.length) ? savedIdx : 0;
      }
    }
    this._applyRoomToConfig();

    if (this._inited) {
      this._switching = true;
      this._syncGen++;
      this._syncInProgress = false;
      this._disconnectAllMulti();
      if (this._ws) { try { this._ws.onclose = null; this._ws.onerror = null; this._ws.close(); } catch(_) {} }
      if (this._spkWs) { try { this._spkWs.onclose = null; this._spkWs.onerror = null; this._spkWs.close(); } catch(_) {} }
      clearTimeout(this._reconnectTimer); clearTimeout(this._connectTimeout);
      clearTimeout(this._spkReconnect); clearTimeout(this._autoSyncTimer);
      clearTimeout(this._volSendTimer); clearTimeout(this._volLockTimer);
      clearTimeout(this._toastTimer); clearInterval(this._retryCountdownTimer);
      clearInterval(this._progressInterval); this._progressInterval = null;
      this._clearAllRoomVolTimers();
    }

    this._ws = null; this._wsConnected = false;
    this._spkWs = null; this._spkHb = null; this._spkEqHb = null; this._spkReconnect = null;
    this._switching = false;
    this._lastZingSongId = "";
    this._nowPlaying = { source:null, songId:"", videoId:"", url:"", title:"", artist:"", thumb:"", position:0, duration:0, isPlaying:false };
    this._reconnectTimer = null; this._connectTimeout = null; this._toastTimer = null;
    this._retryCountdownTimer = null; this._volSendTimer = null; this._volLockTimer = null;
    this._waveRaf = null; this._progressInterval = null;

    this._syncRoomIdxs = new Set();
    this._multiWs = {};
    this._roomVolumes = {};
    this._autoSync = false;
    this._autoSyncTimer = null;
    this._autoSyncDoneForSong = false;
    this._lastSyncSongTitle = "";
    this._syncInProgress = false;
    this._syncSuppressUntil = 0;
    this._volSyncGuardUntil = 0;
    this._posSyncGuardUntil = 0;
    this._syncGen = 0;
    this._syncSettingsOpen = false;
    this._pendingRoomCmd = null;
    this._pendingNextTitle = null;
    this._songCache = [];
    this._activePlaylistId = null;

    this._state = {
      media: { source: null, isPlaying: false, title: "Không có nhạc", artist: "---",
        thumb: "", position: 0, duration: 0, autoNext: true, repeat: false, shuffle: false,
        url: "", videoId: "", songId: "" },
      volume: 0,
      playlists: [], playlistSongs: [],
    };

    this._activeSearchTab = 'songs';
    this._volDragging = false;
    this._offline = false; this._retryIn = 0; this._failCount = 0; this._dropCount = 0;
    this._waveBars = null; this._waveBalls = null; this._waveStyle = 'ball';

    if (this._rooms) {
      const savedSync = this._lsGet('syncIdxs');
      if (Array.isArray(savedSync)) {
        savedSync.forEach(i => {
          if (typeof i === 'number' && i >= 0 && i < this._rooms.length && i !== (this._currentRoomIdx||0))
            this._syncRoomIdxs.add(i);
        });
      }
      const savedAuto = this._lsGet('autoSync');
      if (savedAuto) this._autoSync = true;
    }

    if (this._inited) { this._render(); this._bind(); this._connectWsAuto(); }
  }

  _clearAllRoomVolTimers() {
    if (!this._rooms) return;
    this._rooms.forEach((_, i) => {
      if (this[`_rvTimer_${i}`]) { clearTimeout(this[`_rvTimer_${i}`]); this[`_rvTimer_${i}`] = null; }
      this[`_rvGuardUntil_${i}`] = 0;
    });
  }

  _applyRoomToConfig() {
    if (this._rooms) {
      const r = this._rooms[this._currentRoomIdx || 0];
      this._host = r.host;
      this._roomTunnelHost = r.tunnel_host; this._roomTunnelPort = r.tunnel_port; this._roomTunnelPath = r.tunnel_path;
      this._roomCustomWsUrl = r.custom_ws_url || "";
      this._roomSpkTunnelHost = r.speaker_tunnel_host; this._roomSpkTunnelPort = r.speaker_tunnel_port; this._roomSpkTunnelPath = r.speaker_tunnel_path;
      this._roomCustomSpkWsUrl = r.custom_speaker_ws_url || "";
    } else {
      this._host = (this._config.host || "").trim() || window.location.hostname;
      this._roomTunnelHost = (this._config.tunnel_host || "").trim();
      this._roomTunnelPort = Number(this._config.tunnel_port || 443);
      this._roomTunnelPath = (this._config.tunnel_path || "/").trim() || "/";
      this._roomCustomWsUrl = (this._config.custom_ws_url || "").trim();
      this._roomSpkTunnelHost = (this._config.speaker_tunnel_host || "").trim();
      this._roomSpkTunnelPort = Number(this._config.speaker_tunnel_port || 443);
      this._roomSpkTunnelPath = (this._config.speaker_tunnel_path || "/").trim() || "/";
      this._roomCustomSpkWsUrl = (this._config.custom_speaker_ws_url || "").trim();
    }
  }

  _switchRoom(idx) {
    if (!this._rooms || idx === this._currentRoomIdx) return;
    clearTimeout(this._reconnectTimer); clearTimeout(this._connectTimeout);
    clearTimeout(this._spkReconnect); clearInterval(this._retryCountdownTimer);
    clearInterval(this._progressInterval); this._progressInterval = null;
    this._clearAllRoomVolTimers();
    this._reconnectTimer = null; this._connectTimeout = null; this._spkReconnect = null; this._retryCountdownTimer = null;
    this._pendingRoomCmd = null; this._pendingNextTitle = null;
    this._currentRoomIdx = idx;
    this._lsSet('roomIdx', idx);
    this._applyRoomToConfig();
    this._state.media = { source: null, isPlaying: false, title: "Không có nhạc", artist: "---", thumb: "", position: 0, duration: 0, autoNext: true, repeat: false, shuffle: false, url: "", videoId: "", songId: "" };
    this._state.volume = 0;
    this._lastZingSongId = "";
    this._nowPlaying = { source:null, songId:"", videoId:"", url:"", title:"", artist:"", thumb:"", position:0, duration:0, isPlaying:false };

    this._switching = true;
    this._syncGen++;
    this._syncInProgress = false;
    this._disconnectAllMulti();
    this._closeWs();
    this._switching = false;
    this._offline = false; this._failCount = 0; this._dropCount = 0; this._retryIn = 0;
    this._waveBars = null; this._waveBalls = null;
    this._render(); this._bind();
    this._setConnDot(false); this._setConnText("WS");
    this._toast("🏠 " + this._rooms[idx].name, "success");
    setTimeout(() => {
      this._switching = false;
      this._syncRoomIdxs.forEach(sidx => { if (sidx !== this._currentRoomIdx) this._connectMultiRoom(sidx); });
      this._connectWsAuto();
    }, 120);
  }

  // ─── NowPlaying Cache ──────────────────────────────────────────────
  _updateNowPlayingCache() {
    const m = this._state.media;
    if (!m.isPlaying && m.title === "Không có nhạc") { this._resetNowPlayingCache(); return; }
    this._nowPlaying = {
      source: m.source || null, songId: m.songId || (m.source === "zing" ? this._lastZingSongId : ""),
      videoId: m.videoId || "", url: m.url || "", title: m.title || "", artist: m.artist || "",
      thumb: m.thumb || "", position: m.position || 0, duration: m.duration || 0, isPlaying: m.isPlaying,
    };
  }
  _resetNowPlayingCache() {
    this._nowPlaying = { source:null, songId:"", videoId:"", url:"", title:"", artist:"", thumb:"", position:0, duration:0, isPlaying:false };
  }
  _extractYtVideoId(thumbnailUrl) {
    if (!thumbnailUrl) return null;
    const m = thumbnailUrl.match(/ytimg\.com\/vi\/([^/?#]+)/);
    return m ? m[1] : null;
  }
  _lookupSongByTitle(title) {
    if (!title) return null;
    const norm = t => (t || "").toLowerCase().replace(/\s+/g, " ").trim();
    return this._songCache.find(s => norm(s.title) === norm(title)) || null;
  }
  _buildPlayCmdFromCache(cache) {
    if (!cache) return null;
    if (cache.source === "zing" && cache.songId)
      return { action: "play_zing", song_id: cache.songId, title: cache.title, artist: cache.artist, thumbnail_url: cache.thumb };
    if (cache.videoId)
      return { action: "play_song", video_id: cache.videoId, title: cache.title, artist: cache.artist, thumbnail_url: cache.thumb };
    if (cache.url)
      return { action: "play_url", url: cache.url, title: cache.title, artist: cache.artist, thumbnail_url: cache.thumb };
    return null;
  }

  // ─── Multiroom WS Pool ────────────────────────────────────────────
  _buildMultiRoomWsUrl(idx) {
    const room = this._rooms[idx]; if (!room) return "";
    const mode = (this._config.mode || "auto").toLowerCase();
    const https = this._isHttps();
    const _customUrl = () => this._resolveCustomWsUrl(room.custom_ws_url || "", room.host);
    const _tunnelUrl = () => {
      const th = room.tunnel_host; if (!th) return "";
      const tp = room.tunnel_port || 443; const tpath = room.tunnel_path || "/";
      let url = `wss://${th}${tp === 443 ? "" : ":" + tp}${tpath.startsWith("/") ? tpath : "/" + tpath}`;
      if (room.host) url += (url.includes("?") ? "&" : "?") + "ip=" + encodeURIComponent(room.host);
      return url;
    };
    const _lanUrl = () => (https ? "" : `ws://${room.host}:${this._config.ws_port}`);
    if (https) { const c = _customUrl(); if (c) return c; }
    if (mode === "lan") return _lanUrl();
    if (mode === "tunnel") return _tunnelUrl();
    return https ? _tunnelUrl() : _lanUrl();
  }

  _buildMultiRoomSpkUrl(idx) {
    const room = this._rooms[idx]; if (!room) return "";
    const mode = (this._config.mode || "auto").toLowerCase();
    const https = this._isHttps();
    const _customUrl = () => this._resolveCustomWsUrl(room.custom_speaker_ws_url || "", room.host);
    const _tunnelUrl = () => {
      const th = room.speaker_tunnel_host; if (!th) return "";
      const tp = room.speaker_tunnel_port || 443; const tpath = room.speaker_tunnel_path || "/";
      let url = `wss://${th}${tp === 443 ? "" : ":" + tp}${tpath.startsWith("/") ? tpath : "/" + tpath}`;
      if (room.host) url += (url.includes("?") ? "&" : "?") + "ip=" + encodeURIComponent(room.host);
      return url;
    };
    const _lanUrl = () => (https ? "" : `ws://${room.host}:${this._config.speaker_port || 8080}`);
    if (https) { const c = _customUrl(); if (c) return c; }
    if (mode === "lan") return _lanUrl();
    if (mode === "tunnel") return _tunnelUrl();
    return https ? _tunnelUrl() : _lanUrl();
  }

  _connectMultiRoom(idx, pendingCmd = null) {
    if (!this._rooms || idx === this._currentRoomIdx) return;
    const existing = this._multiWs[idx];
    if (existing) {
      if (existing.ws?.readyState === 0 || existing.ws?.readyState === 1) {
        if (pendingCmd) {
          if (existing.ws.readyState === 1) existing.ws.send(JSON.stringify(pendingCmd));
          else existing._pendingCmd = pendingCmd;
        }
        return;
      }
      this._disconnectMultiRoom(idx);
    }
    const entry = { ws: null, spkWs: null, reconnectTimer: null, connected: false, pollTimer: null, _pendingCmd: pendingCmd };
    this._multiWs[idx] = entry;

    const attachSpkHandlers = (ws) => {
      ws.onopen = () => { if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'get_info' })); };
      ws.onerror = () => {};
      ws.onmessage = (ev) => {
        try {
          const d = JSON.parse(ev.data);
          let s = d;
          if (typeof d.data === "string") { try { s = JSON.parse(d.data); } catch { s = d; } } else if (d.data) { s = d.data; }
          const vol = s.vol !== undefined ? Number(s.vol) : null;
          if (vol !== null && vol !== this._roomVolumes[idx]) {
            if (this[`_rvGuardUntil_${idx}`] && Date.now() < this[`_rvGuardUntil_${idx}`]) return;
            this._roomVolumes[idx] = vol;
            const sl = this.querySelector(`.room-vol-slider[data-rvidx="${idx}"]`);
            if (sl) { sl.value = vol; const lbl = this.querySelector(`#rvl_${idx}`); if (lbl) lbl.textContent = vol; }
          }
        } catch(_) {}
      };
      ws.onclose = () => {
        if (entry.spkWs === ws) entry.spkWs = null;
        if (this._syncRoomIdxs.has(idx) && !this._switching) {
          entry.spkReconnectTimer = setTimeout(() => {
            entry.spkReconnectTimer = null;
            if (!this._syncRoomIdxs.has(idx) || this._switching) return;
            const url2 = this._buildMultiRoomSpkUrl(idx); if (!url2) return;
            try { const newSpk = new WebSocket(url2); entry.spkWs = newSpk; attachSpkHandlers(newSpk); } catch(_) {}
          }, 3500 + Math.random() * 2500);
        }
      };
    };

    const wsUrl = this._buildMultiRoomWsUrl(idx);
    if (wsUrl) {
      try {
        const ws = new WebSocket(wsUrl);
        entry.ws = ws;
        ws.onopen = () => {
          entry.connected = true;
          entry.pollTimer = setInterval(() => { if (ws.readyState === 1) ws.send(JSON.stringify({ action: 'get_info' })); }, 5000);
          ws.send(JSON.stringify({ action: 'get_info' }));
          const cmdToSend = entry._pendingCmd || this._buildPlayCmdFromCache(this._nowPlaying);
          if (cmdToSend) {
            setTimeout(() => { if (ws.readyState === 1) ws.send(JSON.stringify(cmdToSend)); entry._pendingCmd = null; }, 300);
          } else {
            entry._pendingCmd = null;
            ws.send(JSON.stringify({ action: 'get_playback_state' }));
          }
          setTimeout(() => { if (ws.readyState === 1) this._sendVolumeToRoom(idx, this._state.volume); }, 500);
          delete this._roomVolumes[idx];
          this[`_rvGuardUntil_${idx}`] = 0;
          this._toast(`🔗 ${this._rooms[idx].name} linked`, "success");
          this._renderSyncBar(); this._renderRoomVolumeSliders();
        };
        ws.onclose = () => {
          entry.connected = false;
          if (entry.pollTimer) { clearInterval(entry.pollTimer); entry.pollTimer = null; }
          this._renderSyncBar(); this._renderRoomVolumeSliders();
          if (this._syncRoomIdxs.has(idx) && !this._switching) {
            entry.reconnectTimer = setTimeout(() => {
              delete this._multiWs[idx];
              if (this._syncRoomIdxs.has(idx)) this._connectMultiRoom(idx);
            }, 3000 + Math.random() * 3000);
          }
        };
        ws.onerror = () => {};
        ws.onmessage = (ev) => {
          try {
            const d = JSON.parse(ev.data);
            const vol = (() => {
              if (d.type === "volume_state" && d.volume !== undefined) return Number(d.volume);
              if (d.type === "get_info" && d.data) { const v = d.data.vol !== undefined ? d.data.vol : d.data.volume; if (v !== undefined) return Number(v); }
              if (d.type === "playback_state" && d.volume !== undefined) return Number(d.volume);
              if (d.vol !== undefined) return Number(d.vol);
              if (d.volume !== undefined) return Number(d.volume);
              return null;
            })();
            if (vol !== null && vol !== this._roomVolumes[idx]) {
              if (this[`_rvGuardUntil_${idx}`] && Date.now() < this[`_rvGuardUntil_${idx}`]) return;
              this._roomVolumes[idx] = vol;
              const sl = this.querySelector(`.room-vol-slider[data-rvidx="${idx}"]`);
              if (sl) { sl.value = vol; const lbl = this.querySelector(`#rvl_${idx}`); if (lbl) lbl.textContent = vol; }
            }
            if (d.type === "playback_state" && d.title) {
              if (!this._roomPlayback) this._roomPlayback = {};
              this._roomPlayback[idx] = { title: d.title || "", artist: d.artist || d.channel || "", thumb: d.thumbnail_url || "", isPlaying: !!d.is_playing, source: d.source || "youtube" };
              const badge = this.querySelector(`.sync-room-badge[data-srbidx="${idx}"]`);
              if (badge && d.title) badge.title = d.title;
            }
          } catch(_) {}
        };
      } catch(_) {}
    }

    const spkUrl = this._buildMultiRoomSpkUrl(idx);
    if (spkUrl) {
      try { const spkWs = new WebSocket(spkUrl); entry.spkWs = spkWs; attachSpkHandlers(spkWs); spkWs.onerror = () => {}; } catch(_) {}
    }
    this._renderSyncBar(); this._renderRoomVolumeSliders();
  }

  _disconnectMultiRoom(idx) {
    const entry = this._multiWs[idx]; if (!entry) return;
    clearTimeout(entry.reconnectTimer); clearTimeout(entry.spkReconnectTimer);
    if (entry.pollTimer) { clearInterval(entry.pollTimer); entry.pollTimer = null; }
    try { if (entry.ws) { entry.ws.onclose = null; entry.ws.onerror = null; entry.ws.onmessage = null; entry.ws.close(); } } catch(_) {}
    try { if (entry.spkWs) { entry.spkWs.onclose = null; entry.spkWs.onerror = null; entry.spkWs.close(); } } catch(_) {}
    delete this._multiWs[idx];
  }

  _disconnectAllMulti() { Object.keys(this._multiWs).forEach(idx => this._disconnectMultiRoom(parseInt(idx))); }
  _getSyncTargets() { if (!this._rooms) return []; return Array.from(this._syncRoomIdxs).filter(i => i !== this._currentRoomIdx); }
  _sendToRoom(idx, obj) { const entry = this._multiWs[idx]; if (entry?.ws?.readyState === 1) entry.ws.send(JSON.stringify(obj)); }
  _sendSpkToRoom(idx, obj) { const entry = this._multiWs[idx]; if (entry?.spkWs?.readyState === 1) entry.spkWs.send(JSON.stringify(obj)); else this._sendToRoom(idx, obj); }

  _broadcastCmd(obj) {
    if (this._ws?.readyState === 1) this._ws.send(JSON.stringify(obj));
    const a = obj?.action;
    const targets = this._getSyncTargets();
    if (a === "play_song" || a === "play_zing" || a === "play_url" || a === "playlist_play") {
      this._pendingRoomCmd = "broadcast"; this._pendingNextTitle = null;
      targets.forEach((idx, i) => { setTimeout(() => { if (this._switching) return; this._sendToRoom(idx, obj); }, i * 300); });
    } else {
      targets.forEach(idx => this._sendToRoom(idx, obj));
    }
  }

  _broadcastSpkCmd(obj) { this._sendSpk(obj); this._getSyncTargets().forEach(idx => this._sendSpkToRoom(idx, obj)); }

  _sendVolumeToRoom(idx, vol) {
    if (idx === this._currentRoomIdx) { this._sendVolume(vol); return; }
    const entry = this._multiWs[idx]; if (!entry) return;
    if (entry.spkWs?.readyState === 1) {
      entry.spkWs.send(JSON.stringify({ type: "set_vol", vol }));
      entry.spkWs.send(JSON.stringify({ type: "send_message", what: 4, arg1: 5, arg2: vol }));
    }
    if (entry.ws?.readyState === 1) {
      entry.ws.send(JSON.stringify({ action: "set_volume", value: vol }));
      entry.ws.send(JSON.stringify({ action: "set_volume", volume: vol }));
      entry.ws.send(JSON.stringify({ type: "set_vol", vol }));
      entry.ws.send(JSON.stringify({ type: "send_message", what: 4, arg1: 5, arg2: vol }));
    }
  }

  _triggerMasterNext() {
    this._pendingRoomCmd = "next"; this._pendingNextTitle = null;
    this._getSyncTargets().forEach(idx => this._sendToRoom(idx, { action: "stop" }));
    this._send({ action: "next" });
    this._sendSpk({ type: 'send_message', what: 65536, arg1: 0, arg2: 1, obj: 'next' });
  }

  _triggerMasterPrev() {
    this._pendingRoomCmd = "prev"; this._pendingNextTitle = null;
    this._getSyncTargets().forEach(idx => this._sendToRoom(idx, { action: "stop" }));
    this._send({ action: "prev" });
    this._sendSpk({ type: 'send_message', what: 65536, arg1: 0, arg2: 1, obj: 'pre' });
  }

  // ─── Sync Playback ────────────────────────────────────────────────
  _syncPlaybackTime(silent = false) {
    const targets = this._getSyncTargets();
    if (!targets.length) { if (!silent) this._toast("Chưa chọn phòng để đồng bộ", "error"); return; }
    if (this._syncInProgress) return;
    this._syncInProgress = true;
    const PAUSE_SETTLE = this._config.sync_pause_ms, SEEK_SETTLE = 700, RESUME_DELAY = this._config.sync_resume_delay_ms;
    const pos = this._state.media.position;
    const wasPlaying = this._state.media.isPlaying;
    const roomNames = targets.map(i => this._rooms[i].name).join(", ");
    const gen = ++this._syncGen;
    const aborted = () => gen !== this._syncGen || this._switching;

    if (!silent) this._toast(`⏱ Đang sync → ${roomNames}... (pause 3s)`, "");
    else this._toast(`⏱ Auto-sync → ${roomNames}... (pause 3s)`, "");

    clearInterval(this._progressInterval); this._progressInterval = null;
    this._broadcastCmd({ action: "pause" });
    this._broadcastSpkCmd({ type: "send_message", what: 65536, arg1: 0, arg2: 0, obj: "pause" });

    setTimeout(() => {
      if (aborted()) { this._syncInProgress = false; return; }
      this._send({ action: "seek", position: pos });
      targets.forEach(idx => this._sendToRoom(idx, { action: "seek", position: pos }));
      setTimeout(() => {
        if (aborted()) { if (wasPlaying) { this._broadcastCmd({ action: "resume" }); this._startProgressTick(); } this._syncInProgress = false; return; }
        if (!wasPlaying) { if (!silent) this._toast(`✅ Sync xong ${this._fmtTime(pos)} → ${roomNames}`, "success"); this._syncInProgress = false; this._renderSyncBar(); return; }
        this._syncSuppressUntil = Date.now() + 8000;
        this._broadcastCmd({ action: "resume" });
        this._startProgressTick();
        this._volSyncGuardUntil = Date.now() + 3000;
        this._posSyncGuardUntil = Date.now() + 2000;
        if (!silent) this._toast(`✅ Sync xong → ${roomNames}`, "success");
        this._syncInProgress = false;
        this._renderSyncBar();
      }, SEEK_SETTLE + RESUME_DELAY);
    }, PAUSE_SETTLE);
  }

  _scheduleAutoSync() {
    if (!this._autoSync) return;
    if (!this._getSyncTargets().length) return;
    if (Date.now() < this._syncSuppressUntil) return;
    const songTitle = this._state.media.title;
    if (this._autoSyncDoneForSong && this._lastSyncSongTitle === songTitle) return;
    clearTimeout(this._autoSyncTimer);
    this._autoSyncTimer = setTimeout(() => {
      if (this._state.media.isPlaying && this._getSyncTargets().length && !this._syncInProgress) {
        const currentTitle = this._state.media.title;
        if (this._autoSyncDoneForSong && this._lastSyncSongTitle === currentTitle) return;
        this._autoSyncDoneForSong = true;
        this._lastSyncSongTitle = currentTitle;
        this._syncPlaybackTime(true);
      }
    }, this._config.auto_sync_delay_ms);
  }

  _toggleAutoSync() {
    this._autoSync = !this._autoSync;
    this._lsSet('autoSync', this._autoSync);
    clearTimeout(this._autoSyncTimer); this._autoSyncTimer = null;
    if (this._autoSync) {
      this._toast(`🔄 Auto-sync BẬT — sync sau ${(this._config.auto_sync_delay_ms/1000).toFixed(1)}s/bài`, "success");
      if (this._state.media.isPlaying) this._scheduleAutoSync();
    } else {
      this._autoSyncDoneForSong = false;
      this._toast("⏹ Auto-sync TẮT", "");
    }
    this._renderSyncBar();
  }

  _renderSyncBar() {
    const bar = this.querySelector("#syncBar"); if (!bar) return;
    if (!this._rooms || this._rooms.length < 2 || this._getSyncTargets().length === 0) { bar.style.display = "none"; return; }
    const targets = this._getSyncTargets();
    bar.innerHTML = `
      <div class="sync-bar-inner">
        <div class="sync-bar-left">
          <span class="sync-bar-label">🔗 SYNC</span>
          ${targets.map(idx => {
            const entry = this._multiWs[idx];
            const ok = entry?.connected;
            const rp = this._roomPlayback?.[idx];
            const songTip = rp?.title ? `${rp.title}${rp.isPlaying ? ' ▶' : ' ⏸'}` : "";
            return `<span class="sync-room-badge ${ok ? 'ok' : 'pending'}" data-srbidx="${idx}" title="${this._esc(songTip)}">${this._esc(this._rooms[idx].name)}${rp?.isPlaying ? ' ▶' : ''}</span>`;
          }).join('')}
        </div>
        <div class="sync-bar-right">
          <button class="sync-btn${this._syncInProgress ? ' sync-btn-busy' : ''}" id="btnSyncNow" ${this._syncInProgress ? 'disabled' : ''}>${this._syncInProgress ? '⌛ Syncing...' : '⏱ Sync Now'}</button>
          <button class="sync-btn ${this._autoSync ? 'sync-auto-on' : ''}" id="btnAutoSync">${this._autoSync ? '🔄 Auto ON' : '🔄 Auto'}</button>
          <button class="sync-btn" id="btnSyncSettings">⚙</button>
        </div>
      </div>
      <div id="syncSettingsPanel" class="${this._syncSettingsOpen ? '' : 'hidden'}" style="border-top:1px solid rgba(139,92,246,.15);margin-top:6px;padding-top:8px">
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <div style="flex:1;min-width:120px"><div style="font-size:9px;color:rgba(226,232,240,.45);margin-bottom:3px">⏳ Chờ trước auto-sync</div><div style="display:flex;align-items:center;gap:5px"><input type="range" id="slAutoDelay" min="1000" max="15000" step="500" value="${this._config.auto_sync_delay_ms}" style="flex:1;height:4px" /><span id="autoDelayVal" style="font-size:10px;color:#a78bfa;min-width:32px;text-align:right">${(this._config.auto_sync_delay_ms/1000).toFixed(1)}s</span></div></div>
          <div style="flex:1;min-width:120px"><div style="font-size:9px;color:rgba(226,232,240,.45);margin-bottom:3px">⏸ Pause settle</div><div style="display:flex;align-items:center;gap:5px"><input type="range" id="slPauseMs" min="100" max="2000" step="100" value="${this._config.sync_pause_ms}" style="flex:1;height:4px" /><span id="pauseMsVal" style="font-size:10px;color:#a78bfa;min-width:32px;text-align:right">${this._config.sync_pause_ms}ms</span></div></div>
          <div style="flex:1;min-width:120px"><div style="font-size:9px;color:rgba(226,232,240,.45);margin-bottom:3px">▶ Resume delay</div><div style="display:flex;align-items:center;gap:5px"><input type="range" id="slResumeDelay" min="500" max="8000" step="500" value="${this._config.sync_resume_delay_ms}" style="flex:1;height:4px" /><span id="resumeDelayVal" style="font-size:10px;color:#a78bfa;min-width:32px;text-align:right">${(this._config.sync_resume_delay_ms/1000).toFixed(1)}s</span></div></div>
        </div>
      </div>`;
    bar.querySelector("#btnSyncNow").onclick = () => this._syncPlaybackTime(false);
    bar.querySelector("#btnAutoSync").onclick = () => this._toggleAutoSync();
    bar.querySelector("#btnSyncSettings").onclick = () => { this._syncSettingsOpen = !this._syncSettingsOpen; this._renderSyncBar(); };
    const slAD = bar.querySelector("#slAutoDelay"); if (slAD) slAD.oninput = () => { this._config.auto_sync_delay_ms = parseInt(slAD.value); const v = bar.querySelector("#autoDelayVal"); if (v) v.textContent = (this._config.auto_sync_delay_ms/1000).toFixed(1) + "s"; };
    const slP = bar.querySelector("#slPauseMs"); if (slP) slP.oninput = () => { this._config.sync_pause_ms = parseInt(slP.value); const v = bar.querySelector("#pauseMsVal"); if (v) v.textContent = this._config.sync_pause_ms + "ms"; };
    const slR = bar.querySelector("#slResumeDelay"); if (slR) slR.oninput = () => { this._config.sync_resume_delay_ms = parseInt(slR.value); const v = bar.querySelector("#resumeDelayVal"); if (v) v.textContent = (this._config.sync_resume_delay_ms/1000).toFixed(1) + "s"; };
    bar.style.display = "";
  }

  _renderRoomVolumeSliders() {
    const container = this.querySelector("#roomVolumes"); if (!container) return;
    if (!this._rooms || this._rooms.length < 2 || this._getSyncTargets().length === 0) { container.style.display = "none"; return; }
    const allRooms = [this._currentRoomIdx, ...this._getSyncTargets()];
    container.style.display = "";
    container.innerHTML = allRooms.map((idx) => {
      const room = this._rooms[idx];
      const color = ROOM_COLORS[idx % ROOM_COLORS.length];
      const isMaster = idx === this._currentRoomIdx;
      const vol = isMaster ? this._state.volume : (this._roomVolumes[idx] ?? 7);
      return `<div class="room-vol-row" data-rvidx="${idx}">
        <span class="room-vol-dot" style="background:${color}"></span>
        <span class="room-vol-name" style="color:${color}">${this._esc(room.name)}${isMaster ? ' ★' : ''}</span>
        <input type="range" class="room-vol-slider" min="0" max="15" value="${vol}" data-rvidx="${idx}" style="--rv-color:${color}" />
        <span class="room-vol-label" id="rvl_${idx}">${vol}</span>
      </div>`;
    }).join('');
    container.querySelectorAll(".room-vol-slider").forEach(sl => {
      sl.oninput = () => {
        const ridx = parseInt(sl.dataset.rvidx); const v = parseInt(sl.value);
        const lbl = container.querySelector(`#rvl_${ridx}`); if (lbl) lbl.textContent = v;
        if (ridx === this._currentRoomIdx) {
          this._state.volume = v; this._volDragging = true;
          clearTimeout(this._volSendTimer); this._volSendTimer = setTimeout(() => this._broadcastVolume(v), 100);
          clearTimeout(this._volLockTimer); this._volLockTimer = setTimeout(() => { this._volDragging = false; }, 2000);
        } else {
          this._roomVolumes[ridx] = v;
          clearTimeout(this[`_rvTimer_${ridx}`]);
          this[`_rvTimer_${ridx}`] = setTimeout(() => { this[`_rvTimer_${ridx}`] = null; this._sendVolumeToRoom(ridx, v); }, 100);
        }
      };
      sl.onchange = () => {
        const ridx = parseInt(sl.dataset.rvidx); const v = parseInt(sl.value);
        if (ridx === this._currentRoomIdx) {
          this._state.volume = v; this._broadcastVolume(v);
          clearTimeout(this._volLockTimer); this._volLockTimer = setTimeout(() => { this._volDragging = false; }, 2000);
        } else {
          this._roomVolumes[ridx] = v;
          clearTimeout(this[`_rvTimer_${ridx}`]); this[`_rvTimer_${ridx}`] = null;
          this._sendVolumeToRoom(ridx, v);
        }
      };
    });
  }

  _renderRoomPills() {
    const bar = this.querySelector("#roomBar"); if (!bar || !this._rooms) return;
    bar.querySelectorAll(".room-pill").forEach((pill, i) => pill.classList.toggle("active", i === (this._currentRoomIdx || 0)));
    bar.querySelectorAll(".sync-cb").forEach(cb => { const idx = parseInt(cb.dataset.sidx); cb.checked = this._syncRoomIdxs.has(idx); });
    this._updateRoomPillState();
  }

  // ─── WS Connection ────────────────────────────────────────────────
  set hass(h) { this._hass = h; if (!this._inited) { this._inited = true; this._render(); this._bind(); this._connectWsAuto(); } }

  connectedCallback() {
    if (this._inited) this._connectWsAuto();
    if (!this._visHandler) {
      this._visHandler = () => {
        if (!document.hidden && this._wsConnected && this._state.media.isPlaying) {
          this._send({ action: 'get_playback_state' });
        }
      };
      document.addEventListener('visibilitychange', this._visHandler);
    }
  }

  disconnectedCallback() {
    this._closeWs(); this._disconnectAllMulti();
    clearInterval(this._progressInterval); this._progressInterval = null;
    clearTimeout(this._autoSyncTimer); clearTimeout(this._volSendTimer); clearTimeout(this._volLockTimer);
    clearTimeout(this._toastTimer); this._clearAllRoomVolTimers();
    this._pendingNextTitle = null; this._syncInProgress = false; this._syncGen++;
    if (this._visHandler) { document.removeEventListener('visibilitychange', this._visHandler); this._visHandler = null; }
  }

  getCardSize() { return 7; }
  _isHttps() { return window.location.protocol === "https:"; }
  _resolveCustomWsUrl(raw, targetHost = this._host) {
    const s = String(raw || "").trim(); if (!s) return "";
    const host = targetHost || "";
    let out = s.replaceAll("{ip}", encodeURIComponent(host)).replaceAll("{host}", encodeURIComponent(host));
    if (out.startsWith("/")) { const scheme = this._isHttps() ? "wss" : "ws"; out = `${scheme}://${window.location.host}${out}`; }
    return out;
  }
  _lanWsUrl() { return `ws://${this._host}:${this._config.ws_port}`; }
  _customWsUrl() { return this._resolveCustomWsUrl(this._roomCustomWsUrl || this._config.custom_ws_url || "", this._host); }
  _customSpkWsUrl() { return this._resolveCustomWsUrl(this._roomCustomSpkWsUrl || this._config.custom_speaker_ws_url || "", this._host); }
  _tunnelWsUrl() {
    const host = this._roomTunnelHost; if (!host) return "";
    const port = this._roomTunnelPort; const path = this._roomTunnelPath;
    const base = `wss://${host}${port === 443 ? "" : ":" + port}${path.startsWith("/") ? path : "/" + path}`;
    const ip = this._host;
    if (ip) return base + (base.includes("?") ? "&" : "?") + "ip=" + encodeURIComponent(ip);
    return base;
  }

  _buildCandidates() {
    const mode = (this._config.mode || "auto").toLowerCase();
    const https = this._isHttps(); const list = [];
    if (mode === "lan") {
      if (https) { const c = this._customWsUrl(); if (c) list.push({ url: c, label: "CUSTOM WSS" }); const t = this._tunnelWsUrl(); if (t) list.push({ url: t, label: "TUNNEL WSS" }); }
      else { list.push({ url: this._lanWsUrl(), label: "LAN WS" }); }
    } else if (mode === "tunnel") {
      const t = this._tunnelWsUrl(); if (t) list.push({ url: t, label: "TUNNEL WSS" });
    } else {
      if (https) { const c = this._customWsUrl(); if (c) list.push({ url: c, label: "CUSTOM WSS" }); const t = this._tunnelWsUrl(); if (t) list.push({ url: t, label: "TUNNEL WSS" }); }
      else { list.push({ url: this._lanWsUrl(), label: "LAN WS" }); }
    }
    return list;
  }

  _connectWsAuto() {
    if (this._switching) return;
    if (this._ws && (this._ws.readyState === 0 || this._ws.readyState === 1)) return;
    clearTimeout(this._reconnectTimer);
    const candidates = this._buildCandidates();
    if (!candidates.length) { this._wsConnected = false; this._setConnDot(false); this._setOffline(true, 0, 1, 1); return; }
    this._doTry(candidates, 0, 1);
  }

  _doTry(candidates, idx, attempt) {
    const MAX_PER_URL = 3;
    clearTimeout(this._reconnectTimer);
    if (this._switching) return;
    if (this._ws && (this._ws.readyState === 0 || this._ws.readyState === 1)) return;
    const c = candidates[idx];
    const total = candidates.length * MAX_PER_URL;
    const doneSoFar = idx * MAX_PER_URL + (attempt - 1);
    this._setOffline(true, this._config.reconnect_ms, doneSoFar, total);
    this._tryOnce(c.url, c.label).then(ok => {
      if (ok) return;
      const newDone = doneSoFar + 1;
      if (attempt < MAX_PER_URL) {
        this._setOffline(true, this._config.reconnect_ms, newDone, total);
        this._reconnectTimer = setTimeout(() => this._doTry(candidates, idx, attempt + 1), this._config.reconnect_ms);
      } else if (idx + 1 < candidates.length) {
        this._setOffline(true, this._config.reconnect_ms, newDone, total);
        this._reconnectTimer = setTimeout(() => this._doTry(candidates, idx + 1, 1), this._config.reconnect_ms);
      } else {
        this._wsConnected = false; this._setConnDot(false); this._setConnText("WS");
        this._toast("Thiết bị offline!", "error"); this._setOffline(true, 0, newDone, total);
      }
    });
  }

  _tryOnce(url, label) {
    return new Promise(resolve => {
      let connected = false, settled = false;
      const finish = (val) => { if (settled) return; settled = true; clearTimeout(this._connectTimeout); resolve(val); };
      const capturedHost = this._host;
      let ws;
      try { ws = new WebSocket(url); } catch (_) { finish(false); return; }
      this._ws = ws;
      this._connectTimeout = setTimeout(() => { if (!connected) { try { ws.close(); } catch(_) {} finish(false); } }, this._config.connect_timeout_ms);
      ws.onopen = () => {
        if (this._host !== capturedHost || this._switching) { try { ws.close(); } catch(_) {} finish(false); return; }
        connected = true; this._dropCount = 0; this._wsConnected = true;
        if (this._syncInProgress) { this._syncInProgress = false; this._syncGen++; }
        this._setConnDot(true); this._setConnText(label); this._setOffline(false);
        this._toast("Đã kết nối: " + label, "success");
        this._requestInitial(); finish(true);
      };
      ws.onclose = () => {
        if (!connected) { this._ws = null; finish(false); }
        else {
          if (this._switching) return;
          this._wsConnected = false; this._setConnDot(false); this._setConnText("WS");
          if (this._syncInProgress) { this._syncInProgress = false; this._syncGen++; this._renderSyncBar(); }
          clearInterval(this._progressInterval); this._progressInterval = null;
          clearTimeout(this._reconnectTimer);
          const MAX_DROP = 3; this._dropCount = (this._dropCount || 0) + 1;
          if (this._dropCount >= MAX_DROP) {
            this._dropCount = 0; this._toast("Thiết bị offline!", "error"); this._setOffline(true, 0, MAX_DROP, MAX_DROP);
          } else {
            this._setOffline(true, this._config.reconnect_ms, this._dropCount, MAX_DROP);
            this._reconnectTimer = setTimeout(() => this._connectWsAuto(), this._config.reconnect_ms);
          }
        }
      };
      ws.onerror = () => {};
      ws.onmessage = ev => { if (this._host === capturedHost && !this._switching) this._handleMsg(ev.data); };
    });
  }

  _closeWs() {
    clearTimeout(this._reconnectTimer); clearTimeout(this._connectTimeout);
    clearInterval(this._retryCountdownTimer); this._retryCountdownTimer = null;
    clearInterval(this._progressInterval); this._progressInterval = null;
    this._stopWaveform();
    if (this._ws) { try { this._ws.onclose = null; } catch(_) {} try { this._ws.onerror = null; } catch(_) {} try { this._ws.onmessage = null; } catch(_) {} try { this._ws.close(); } catch(_) {} this._ws = null; }
    this._wsConnected = false; this._setConnDot(false);
    this._closeSpkWs();
  }

  _send(obj) {
    if (this._ws?.readyState === 1) this._ws.send(JSON.stringify(obj));
    const a = obj?.action;
    if (a === "next" || a === "prev") this._pendingRoomCmd = a;
  }

  _spkWsUrl() { return `ws://${this._host}:${this._config.speaker_port || 8080}`; }
  _spkTunnelWsUrl() {
    const host = this._roomSpkTunnelHost; if (!host) return "";
    const port = this._roomSpkTunnelPort; const path = this._roomSpkTunnelPath;
    const base = `wss://${host}${port === 443 ? "" : ":" + port}${path.startsWith("/") ? path : "/" + path}`;
    const ip = this._host;
    if (ip) return base + (base.includes("?") ? "&" : "?") + "ip=" + encodeURIComponent(ip);
    return base;
  }

  _connectSpkWs() {
    if (this._switching) return;
    if (this._spkWs && (this._spkWs.readyState === 0 || this._spkWs.readyState === 1)) return;
    const https = this._isHttps(); let url;
    if (https) { url = this._customSpkWsUrl() || this._spkTunnelWsUrl(); if (!url) return; }
    else { url = this._spkWsUrl(); }
    const capturedHost = this._host;
    try {
      this._spkWs = new WebSocket(url);
      this._spkWs.onopen = () => {
        if (this._host !== capturedHost || this._switching) { try { this._spkWs.close(); } catch(_) {} return; }
        this._startSpkHeartbeat();
      };
      this._spkWs.onmessage = ev => { if (this._host === capturedHost && !this._switching) this._handleSpkMsg(ev.data); };
      this._spkWs.onclose = () => {
        this._stopSpkHeartbeat(); clearTimeout(this._spkReconnect);
        if (!this._switching && this._host === capturedHost) this._spkReconnect = setTimeout(() => this._connectSpkWs(), 3000);
      };
      this._spkWs.onerror = () => {};
    } catch(_) {}
  }

  _closeSpkWs() {
    this._stopSpkHeartbeat(); clearTimeout(this._spkReconnect); this._spkReconnect = null;
    if (this._spkWs) { try { this._spkWs.onclose = null; } catch(_) {} try { this._spkWs.onerror = null; } catch(_) {} try { this._spkWs.onmessage = null; } catch(_) {} try { this._spkWs.close(); } catch(_) {} this._spkWs = null; }
  }

  _startSpkHeartbeat() {
    this._stopSpkHeartbeat();
    if (this._spkWs?.readyState === 1) { this._spkWs.send(JSON.stringify({ type: 'get_info' })); }
    this._spkHb = setInterval(() => { if (this._spkWs?.readyState === 1) this._spkWs.send(JSON.stringify({ type: 'get_info' })); }, 2000);
  }
  _stopSpkHeartbeat() {
    if (this._spkHb) { clearInterval(this._spkHb); this._spkHb = null; }
    if (this._spkEqHb) { clearInterval(this._spkEqHb); this._spkEqHb = null; }
  }

  _sendSpk(obj) { if (this._spkWs?.readyState === 1) this._spkWs.send(JSON.stringify(obj)); else this._send(obj); }
  _sendVolume(vol) {
    if (this._spkWs?.readyState === 1) {
      this._spkWs.send(JSON.stringify({ type: "set_vol", vol }));
      this._spkWs.send(JSON.stringify({ type: "send_message", what: 4, arg1: 5, arg2: vol }));
      return;
    }
    this._send({ type: "set_vol", vol });
    this._send({ type: "send_message", what: 4, arg1: 5, arg2: vol });
    this._send({ action: "set_volume", value: vol });
    this._send({ action: "set_volume", volume: vol });
  }
  _broadcastVolume(vol) {
    this._sendVolume(vol);
    this._getSyncTargets().forEach(idx => {
      this._sendVolumeToRoom(idx, vol);
      this._roomVolumes[idx] = vol;
      this[`_rvGuardUntil_${idx}`] = Date.now() + 3000;
      const sl = this.querySelector(`.room-vol-slider[data-rvidx="${idx}"]`); if (sl) sl.value = vol;
      const lbl = this.querySelector(`#rvl_${idx}`); if (lbl) lbl.textContent = vol;
    });
  }

  _handleSpkMsg(raw) {
    let d; try { d = JSON.parse(raw); } catch { return; }
    let s;
    if (typeof d.data === "string") { try { s = JSON.parse(d.data); } catch { s = d; } } else { s = d.data || d; }
    if (!this._volDragging && !(this._volSyncGuardUntil && Date.now() < this._volSyncGuardUntil)) {
      const vol = s.vol !== undefined ? Number(s.vol) : null;
      if (vol !== null && vol !== this._state.volume) {
        this._state.volume = vol; this._renderVolume();
        const masterSlider = this.querySelector(`.room-vol-slider[data-rvidx="${this._currentRoomIdx}"]`);
        if (masterSlider) { masterSlider.value = vol; const lbl = this.querySelector(`#rvl_${this._currentRoomIdx}`); if (lbl) lbl.textContent = vol; }
      }
    }
  }

  _requestInitial() {
    if (!this._wsConnected) return;
    if (!this._spkWs || this._spkWs.readyState > 1) this._connectSpkWs(); else this._startSpkHeartbeat();
    if (this._syncRoomIdxs.size > 0) {
      this._syncRoomIdxs.forEach(sidx => { if (sidx !== this._currentRoomIdx) this._connectMultiRoom(sidx); });
      setTimeout(() => { this._renderSyncBar(); this._renderRoomVolumeSliders(); }, 300);
    }
    this._send({ action: 'get_info' });
    this._startProgressTick();
    this._startWaveform();
  }

  _startProgressTick() {
    clearInterval(this._progressInterval);
    let lastTick = performance.now();
    this._progressInterval = setInterval(() => {
      const now = performance.now();
      const elapsed = now - lastTick; lastTick = now;
      const m = this._state.media;
      if (!m.isPlaying || m.duration <= 0 || this._syncInProgress) return;
      const delta = Math.round(elapsed / 1000);
      if (delta > 0 && m.position + delta <= m.duration) { m.position += delta; this._updateProgressOnly(); }
    }, 1000);
  }

  _startWaveform() {
    this._stopWaveform();
    const BAR_COUNT = 25, MAX_H = 72;
    const cur = new Float32Array(BAR_COUNT).fill(3), vel = new Float32Array(BAR_COUNT).fill(0);
    const envelope = Float32Array.from({length: BAR_COUNT}, (_, i) => { const d = Math.abs(i / (BAR_COUNT - 1) - 0.5); return 0.15 + 0.85 * Math.exp(-Math.pow(d / 0.35, 2)); });
    let w1 = 0, w2 = 0, w3 = 0, beatAmp = 0, beatTgt = 0;
    let bpm = 118 + Math.random() * 30, frameSinceBeat = 0, lastTs = 0;
    const peak = new Float32Array(BAR_COUNT).fill(3), pvel = new Float32Array(BAR_COUNT).fill(0);
    const lockAt = new Float32Array(BAR_COUNT).fill(0), locked = new Uint8Array(BAR_COUNT).fill(0);
    let rafId = null, waveRunning = true;

    const tick = (ts) => {
      if (!waveRunning) return;
      rafId = requestAnimationFrame(tick);
      const dt = Math.min((ts - (lastTs || ts)) / 16.67, 3); lastTs = ts;
      const isPlaying = this._state.media.isPlaying; const curMode = this._waveStyle || 'ball';
      w1 += 0.0045 * dt; w2 += 0.010 * dt; w3 += 0.0065 * dt;
      const fpb = (60 / bpm) * 60; frameSinceBeat += dt;
      if (frameSinceBeat >= fpb) { frameSinceBeat -= fpb; beatTgt = isPlaying ? (0.6 + Math.random() * 0.4) : 0; bpm += (Math.random() - 0.5) * 2; bpm = Math.max(22, Math.min(42, bpm)); }
      beatAmp += (beatTgt - beatAmp) * 0.08 * dt; beatTgt *= Math.pow(0.82, dt);
      for (let i = 0; i < BAR_COUNT; i++) {
        const env = envelope[i], x = i / (BAR_COUNT - 1), travelOffset = x * Math.PI * 3.5;
        const s1 = Math.sin(w1 * 2 * Math.PI + travelOffset) * 0.5 + 0.5;
        const s2 = Math.sin(w2 * 2 * Math.PI + travelOffset * 1.7) * 0.3 + 0.3;
        const s3 = Math.abs(Math.sin(w3 * 2 * Math.PI + travelOffset * 0.8));
        const beatPulse = beatAmp * (0.6 + 0.4 * Math.sin(w1 * Math.PI * 4));
        const tgt = 4 + (s1 * 0.45 + s2 * 0.30 + s3 * 0.15 + beatPulse * 0.40) * env * MAX_H;
        if (curMode === 'classic') {
          vel[i] = vel[i] * 0.68 + (tgt - cur[i]) * 0.26 * dt; cur[i] = Math.max(2, Math.min(MAX_H, cur[i] + vel[i]));
        } else {
          vel[i] = vel[i] * 0.68 + (tgt - cur[i]) * 0.26 * dt; const newH = Math.max(0, Math.min(MAX_H, cur[i] + vel[i]));
          if (peak[i] > 3) { pvel[i] += 0.018 * dt; peak[i] = Math.max(3, peak[i] - pvel[i]); }
          if (locked[i]) { cur[i] = 0; if (peak[i] <= 6) { locked[i] = 0; lockAt[i] = 0; } }
          else { cur[i] = newH; if (cur[i] >= peak[i] && cur[i] > 8) { peak[i] = cur[i]; pvel[i] = 0; lockAt[i] = cur[i]; locked[i] = 1; cur[i] = 0; } }
        }
      }
      const bars = this._waveBars, balls = this._waveBalls;
      if (!bars || bars.length !== BAR_COUNT) { const wv = this.querySelector('#waveform'); if (wv) { this._waveBars = wv.querySelectorAll('.wv-bar'); this._waveBalls = wv.querySelectorAll('.wv-ball'); } return; }
      for (let i = 0; i < BAR_COUNT; i++) { bars[i].style.height = cur[i] + 'px'; if (balls && balls[i]) balls[i].style.bottom = peak[i] + 'px'; }
    };

    const wv = this.querySelector('#waveform');
    if (wv) { this._waveBars = wv.querySelectorAll('.wv-bar'); this._waveBalls = wv.querySelectorAll('.wv-ball'); }
    this._waveStop = () => { waveRunning = false; if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; } };
    rafId = requestAnimationFrame(tick);
    this._waveRaf = rafId;
  }

  _stopWaveform() {
    if (this._waveStop) { this._waveStop(); this._waveStop = null; }
    if (this._waveRaf) { cancelAnimationFrame(this._waveRaf); this._waveRaf = null; }
    this._waveBars = null; this._waveBalls = null;
  }

  _toggleWaveStyle() {
    this._waveStyle = (this._waveStyle || 'ball') === 'ball' ? 'classic' : 'ball';
    const wv = this.querySelector('#waveform');
    if (wv) {
      let html = '';
      for (let i = 0; i < 25; i++) {
        html += this._waveStyle === 'classic'
          ? `<div class="wv-col"><div class="wv-ball" style="display:none"></div><div class="wv-bar"></div></div>`
          : `<div class="wv-col"><div class="wv-ball"></div><div class="wv-bar"></div></div>`;
      }
      wv.innerHTML = html;
      this._waveBars = wv.querySelectorAll('.wv-bar'); this._waveBalls = wv.querySelectorAll('.wv-ball');
    }
    const btn = this.querySelector('#btnWaveStyle'); if (btn) btn.textContent = this._waveStyle === 'classic' ? '≡' : '⚬';
    this._toast(this._waveStyle === 'classic' ? '≡ Classic bars' : '⚬ Peak ball', 'success');
  }

  _fmtTime(s) { s = Math.max(0, Math.floor(Number(s || 0))); return `${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`; }
  _esc(s) { return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }

  _setConnDot(on) { const d = this.querySelector("#connDot"); if (d) d.classList.toggle("on", !!on); }
  _setConnText(t) { const el = this.querySelector("#connText"); if (el) el.textContent = t || "WS"; }

  _setOffline(offline, retryMs = 0, done = 0, total = 0) {
    this._offline = offline; this._offlineDone = done; this._offlineTotal = total;
    clearInterval(this._retryCountdownTimer); this._retryCountdownTimer = null;
    this._updateRoomPillState();
    const overlay = this.querySelector("#offlineOverlay"); if (!overlay) return;
    if (!offline) { overlay.style.display = "none"; return; }
    overlay.style.display = "flex";
    this._retryIn = Math.ceil(retryMs / 1000);
    this._renderOfflineOverlay(overlay);
    if (retryMs > 0) {
      this._retryCountdownTimer = setInterval(() => {
        this._retryIn = Math.max(0, this._retryIn - 1);
        const ov = this.querySelector("#offlineOverlay"); if (ov) this._renderOfflineOverlay(ov);
        if (this._retryIn <= 0) { clearInterval(this._retryCountdownTimer); this._retryCountdownTimer = null; }
      }, 1000);
    }
  }

  _renderOfflineOverlay(overlay) {
    const roomName = this._rooms ? this._rooms[this._currentRoomIdx || 0]?.name || "Thiết bị" : (this._config.title || "Thiết bị");
    const host = this._host || "", done = this._offlineDone || 0, total = this._offlineTotal || 0;
    const isPermanent = total > 0 && done >= total;
    const progressBar = total > 0 ? `<div style="width:160px;height:4px;background:rgba(148,163,184,.15);border-radius:999px;margin:6px auto 0"><div style="height:100%;width:${Math.round(done/total*100)}%;background:${isPermanent?'#ef4444':'#a78bfa'};border-radius:999px;transition:width .3s"></div></div><div style="font-size:10px;color:rgba(226,232,240,.4);margin-top:3px">${done}/${total} lần thử</div>` : '';
    overlay.innerHTML = `<div class="offline-box"><div class="offline-icon">${isPermanent ? "🔌" : "📡"}</div><div class="offline-title" style="color:${isPermanent ? "#fca5a5" : "#fcd34d"}">${isPermanent ? "Thiết bị offline" : "Đang kết nối lại..."}</div><div class="offline-room">${this._esc(roomName)}</div><div class="offline-host">${this._esc(host)}</div>${progressBar}<div class="offline-retry" style="margin-top:6px">${isPermanent ? `<span style="color:rgba(226,232,240,.45);font-size:11px">Đã thử hết ${total} lần</span>` : (this._retryIn > 0 ? `Thử lại sau <b>${this._retryIn}s</b>` : `Đang thử kết nối...`)}</div><button class="offline-btn" id="btnOfflineRetry">🔄 Thử lại</button></div>`;
    const btn = overlay.querySelector("#btnOfflineRetry");
    if (btn) btn.onclick = () => { clearTimeout(this._reconnectTimer); clearInterval(this._retryCountdownTimer); this._retryCountdownTimer = null; this._offlineDone = 0; this._offlineTotal = 0; this._dropCount = 0; this._connectWsAuto(); };
  }

  _updateRoomPillState() {
    if (!this._rooms) return;
    const bar = this.querySelector("#roomBar"); if (!bar) return;
    bar.querySelectorAll(".room-pill").forEach((pill, i) => {
      const isActive = i === (this._currentRoomIdx || 0);
      pill.classList.toggle("active", isActive);
      pill.classList.toggle("offline", isActive && this._offline);
    });
  }

  _toast(msg, type = "") {
    const el = this.querySelector("#toast"); if (!el) return;
    el.textContent = msg; el.className = `toast on${type ? " " + type : ""}`;
    clearTimeout(this._toastTimer); this._toastTimer = setTimeout(() => { if (el) el.className = "toast"; }, 2200);
  }

  // ─── Render ───────────────────────────────────────────────────────
  _render() {
    let wvContent = '';
    for (let i = 0; i < 25; i++) wvContent += `<div class="wv-col"><div class="wv-ball"></div><div class="wv-bar"></div></div>`;

    this.innerHTML = `
<ha-card>
<div class="wrap">
  <div class="header">
    <div class="brand"><div class="badge-icon">🎵</div><span class="title-text">${this._esc(this._config.title)}</span></div>
    <div class="conn-row"><div class="dot" id="connDot"></div><span class="conn-label" id="connText">WS</span></div>
  </div>

  ${this._rooms ? `
  <div class="room-bar" id="roomBar">
    ${this._rooms.map((r, i) => {
      const isActive = i === (this._currentRoomIdx || 0);
      const isSynced = this._syncRoomIdxs.has(i);
      const color = ROOM_COLORS[i % ROOM_COLORS.length];
      return `<div class="room-pill-group">
        <button class="room-pill ${isActive ? 'active' : ''}" data-ridx="${i}" style="${isActive ? `--pill-color:${color}` : ''}">
          <span class="room-pill-dot" style="${isActive ? `background:${color};box-shadow:0 0 6px ${color}60` : ''}"></span>
          <span>${this._esc(r.name)}</span>
        </button>
        ${!isActive ? `<label class="sync-cb-label${isSynced ? ' synced' : ''}" title="Broadcast sang ${this._esc(r.name)}">
          <input type="checkbox" class="sync-cb" data-sidx="${i}"${isSynced ? ' checked' : ''} />
          <span class="sync-cb-icon">${isSynced ? '🔗' : '⭕'}</span>
        </label>` : `<span class="sync-active-mark" style="color:${color}">★</span>`}
      </div>`;
    }).join('')}
  </div>` : ''}

  <div class="body">
    <div class="offline-overlay" id="offlineOverlay" style="display:none"></div>

    ${this._rooms && this._rooms.length > 1 ? `<div class="sync-bar" id="syncBar" style="display:none"></div>` : ''}
    ${this._rooms && this._rooms.length > 1 ? `<div class="room-volumes" id="roomVolumes" style="display:none"></div>` : ''}

    <div class="media-card">
      <div class="mc-header">
        <div class="mc-info">
          <div class="mc-title" id="mediaTitle">Không có nhạc</div>
          <div class="mc-artist" id="mediaArtist">---</div>
        </div>
        <div class="mc-badges">
          <span class="mc-source" id="sourceLabel">IDLE</span>
          <button class="mc-icon-btn" id="btnRepeat" title="Repeat">↻</button>
          <button class="mc-icon-btn" id="btnShuffle" title="Shuffle">⇄</button>
        </div>
      </div>
      <div class="mc-vis" id="mcVis">
        <div class="mc-bg" id="mcBg"></div>
        <div class="mc-top">
          <div class="mc-thumb-wrap">
            <img id="mediaThumb" class="mc-thumb" style="display:none" />
            <div id="thumbFallback" class="mc-thumb-fb">🎵</div>
          </div>
          <div class="waveform-wrap" id="waveformWrap" style="display:none">
            <button class="wv-style-btn" id="btnWaveStyle" title="Đổi kiểu hiệu ứng">⚬</button>
            <div class="waveform" id="waveform">${wvContent}</div>
          </div>
        </div>
        <div class="mc-seek-wrap">
          <div class="mc-seek-row">
            <span class="time-txt" id="posText">0:00</span>
            <div class="mc-seek-bar" id="seekWrap">
              <div class="mc-seek-fill" id="seekBar"></div>
              <div class="mc-seek-thumb" id="seekThumb"></div>
            </div>
            <span class="time-txt right" id="durText">0:00</span>
          </div>
        </div>
      </div>
      <div class="media-controls">
        <button class="ctrl-btn" id="btnPrev">⏮</button>
        <button class="ctrl-btn play" id="btnPlayPause">▶</button>
        <button class="ctrl-btn stop" id="btnStop">■</button>
        <button class="ctrl-btn" id="btnNext">⏭</button>
      </div>
      <div class="vol-row">
        <span class="vol-icon">🔊</span>
        <input type="range" id="volSlider" min="0" max="15" value="0" />
        <span class="vol-label" id="volLabel">Mức 0</span>
      </div>
    </div>

    <div class="search-tabs">
      <button class="stab active" data-stab="songs">Songs</button>
      <button class="stab" data-stab="playlist">Playlist</button>
      <button class="stab" data-stab="zing">Zing MP3</button>
      <button class="stab" data-stab="playlists">≡ Playlists</button>
    </div>
    <div class="search-row" id="searchBox">
      <input class="search-inp" id="searchInp" placeholder="Tìm bài hát..." autocomplete="off" />
      <button class="search-btn" id="searchBtn">🔍</button>
    </div>
    <div id="plMgr" style="display:none">
      <div style="display:flex;gap:4px;margin-bottom:6px">
        <button class="form-btn sm" id="btnPlCreate">+ Tạo playlist</button>
        <button class="form-btn sm" id="btnPlRefresh">🔄</button>
      </div>
      <div id="plList"></div>
      <div id="plSongs" style="display:none;margin-top:6px"></div>
    </div>
    <div id="searchResults" class="search-results"></div>
  </div>

  <div class="toast" id="toast"></div>
</div>
</ha-card>

<style>
*{box-sizing:border-box;margin:0;padding:0}
ha-card{border-radius:20px;overflow:hidden;font-family:'Segoe UI',system-ui,sans-serif}
.wrap{background:radial-gradient(ellipse 120% 60% at 50% 0%,rgba(109,40,217,.28),transparent 65%),linear-gradient(180deg,#0a0f1e,#060912);border:1px solid rgba(109,40,217,.2);padding:14px 14px 10px;position:relative;-webkit-tap-highlight-color:transparent}
.header{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
.brand{display:flex;align-items:center;gap:9px}
.badge-icon{width:34px;height:34px;border-radius:10px;background:linear-gradient(135deg,rgba(109,40,217,.4),rgba(67,20,120,.4));border:1px solid rgba(139,92,246,.35);display:grid;place-items:center;font-size:16px}
.title-text{font-weight:900;font-size:16px;color:#e2e8f0;letter-spacing:.5px}
.conn-row{display:flex;align-items:center;gap:7px}
.dot{width:9px;height:9px;border-radius:50%;background:rgba(239,68,68,.9);box-shadow:0 0 8px rgba(239,68,68,.4);transition:all .3s}
.dot.on{background:rgba(34,197,94,.9);box-shadow:0 0 10px rgba(34,197,94,.5)}
.conn-label{font-size:12px;color:rgba(226,232,240,.6)}
.room-bar{display:flex;gap:5px;overflow-x:auto;padding:0 0 8px;scrollbar-width:none;-webkit-overflow-scrolling:touch;margin-bottom:4px;align-items:flex-end}
.room-bar::-webkit-scrollbar{display:none}
.room-pill-group{display:flex;flex-direction:column;align-items:center;gap:3px;flex-shrink:0}
.room-pill{display:flex;align-items:center;gap:5px;padding:6px 12px;border-radius:999px;cursor:pointer;font-size:13px;font-weight:700;white-space:nowrap;border:1px solid rgba(148,163,184,.18);background:rgba(2,6,23,.4);color:rgba(226,232,240,.6);transition:all .18s}
.room-pill:hover{background:rgba(109,40,217,.2);border-color:rgba(139,92,246,.25);color:#c4b5fd}
.room-pill.active{background:linear-gradient(135deg,rgba(109,40,217,.45),rgba(91,33,182,.4));border-color:rgba(139,92,246,.5);color:#fff;box-shadow:0 2px 14px rgba(109,40,217,.3)}
.room-pill-dot{width:6px;height:6px;border-radius:50%;background:rgba(148,163,184,.4);transition:all .2s;flex-shrink:0}
.room-pill.offline{background:rgba(239,68,68,.15);border-color:rgba(239,68,68,.35);color:rgba(252,165,165,.9)}
.sync-active-mark{font-size:10px;line-height:1}
.sync-cb-label{display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all .15s;user-select:none}
.sync-cb-label input[type=checkbox]{position:absolute;opacity:0;width:0;height:0;pointer-events:none}
.sync-cb-icon{font-size:13px;line-height:1;transition:transform .15s}
.sync-cb-label:hover .sync-cb-icon{transform:scale(1.2)}
.sync-cb-label.synced .sync-cb-icon{filter:drop-shadow(0 0 4px rgba(34,197,94,.6))}
.sync-bar{border-radius:12px;background:linear-gradient(135deg,rgba(6,9,18,.7),rgba(2,6,23,.8));border:1px solid rgba(139,92,246,.2);padding:8px 12px;margin-bottom:8px}
.sync-bar-inner{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}
.sync-bar-left{display:flex;align-items:center;gap:6px;flex-wrap:wrap;flex:1;min-width:0}
.sync-bar-label{font-size:10px;font-weight:900;color:rgba(139,92,246,.9);letter-spacing:1px;flex-shrink:0}
.sync-room-badge{font-size:10px;font-weight:700;padding:2px 8px;border-radius:999px;white-space:nowrap}
.sync-room-badge.ok{background:rgba(34,197,94,.15);border:1px solid rgba(34,197,94,.35);color:#86efac}
.sync-room-badge.pending{background:rgba(234,179,8,.1);border:1px solid rgba(234,179,8,.25);color:#fbbf24;animation:syncPending 1.5s ease-in-out infinite}
@keyframes syncPending{0%,100%{opacity:1}50%{opacity:.5}}
.sync-bar-right{display:flex;align-items:center;gap:6px;flex-shrink:0}
.sync-btn{padding:5px 10px;border-radius:8px;cursor:pointer;font-size:10px;font-weight:700;border:1px solid rgba(139,92,246,.3);background:rgba(109,40,217,.25);color:#c4b5fd;transition:all .15s;white-space:nowrap}
.sync-btn:hover{background:rgba(109,40,217,.5)}
.sync-auto-on{background:linear-gradient(135deg,rgba(34,197,94,.3),rgba(21,128,61,.25));border-color:rgba(34,197,94,.4);color:#86efac;animation:autoSyncPulse 2s ease-in-out infinite}
@keyframes autoSyncPulse{0%,100%{box-shadow:0 0 0 0 rgba(34,197,94,.3)}50%{box-shadow:0 0 8px 3px rgba(34,197,94,.2)}}
.sync-btn-busy{opacity:.6;cursor:not-allowed!important}
.room-volumes{border-radius:12px;background:rgba(2,6,23,.5);border:1px solid rgba(139,92,246,.15);padding:8px 12px;margin-bottom:8px}
.room-vol-row{display:flex;align-items:center;gap:8px;margin-bottom:5px}
.room-vol-row:last-child{margin-bottom:0}
.room-vol-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0}
.room-vol-name{font-size:12px;font-weight:700;min-width:64px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex-shrink:0}
.room-vol-row input[type=range]{flex:1;-webkit-appearance:none;height:4px;border-radius:999px;outline:none;cursor:pointer;background:rgba(148,163,184,.18)}
.room-vol-row input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:13px;height:13px;border-radius:50%;background:var(--rv-color,#7c3aed);border:2px solid rgba(255,255,255,.3);cursor:pointer}
.room-vol-label{font-size:12px;color:rgba(226,232,240,.6);min-width:18px;text-align:right;font-family:monospace}
.body{overflow:hidden;position:relative}
.offline-overlay{position:absolute;inset:0;z-index:50;background:rgba(6,9,18,.92);border-radius:12px;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px)}
.offline-box{text-align:center;padding:24px 20px;display:flex;flex-direction:column;align-items:center;gap:8px}
.offline-icon{font-size:40px;animation:offBlink 1.5s ease-in-out infinite}
@keyframes offBlink{0%,100%{opacity:1}50%{opacity:.3}}
.offline-title{font-size:16px;font-weight:900;letter-spacing:.5px}
.offline-room{font-size:13px;font-weight:700;color:#e2e8f0}
.offline-host{font-size:10px;color:rgba(226,232,240,.4);font-family:monospace}
.offline-retry{font-size:12px;color:rgba(226,232,240,.6);margin-top:4px}
.offline-retry b{color:#fbbf24}
.offline-btn{margin-top:8px;padding:10px 24px;border-radius:12px;cursor:pointer;font-size:12px;font-weight:700;border:1px solid rgba(139,92,246,.4);background:linear-gradient(135deg,rgba(109,40,217,.5),rgba(91,33,182,.4));color:#fff}
.media-card{border-radius:16px;overflow:hidden;border:1px solid rgba(148,163,184,.12);background:linear-gradient(180deg,rgba(30,20,60,.9),rgba(10,15,30,.95));padding:14px;margin-bottom:12px}
.mc-header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px}
.mc-info{flex:1;min-width:0}
.mc-title{font-size:15px;font-weight:900;color:#f1f5f9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mc-artist{font-size:11px;color:rgba(226,232,240,.55);margin-top:2px}
.mc-badges{display:flex;align-items:center;gap:6px;flex-shrink:0}
.mc-source{font-size:9px;padding:3px 8px;border-radius:6px;background:rgba(109,40,217,.3);border:1px solid rgba(139,92,246,.3);color:#c4b5fd;font-weight:800;letter-spacing:1px}
.mc-icon-btn{width:28px;height:28px;border-radius:50%;border:1px solid rgba(148,163,184,.15);background:transparent;color:rgba(226,232,240,.5);cursor:pointer;font-size:13px;display:grid;place-items:center;transition:all .15s}
.mc-icon-btn:hover{background:rgba(109,40,217,.2)}.mc-icon-btn.active-btn{color:#86efac;border-color:rgba(34,197,94,.3)}
.mc-vis{position:relative;border-radius:14px;overflow:hidden;margin-bottom:0;border:1px solid rgba(139,92,246,.2);background:linear-gradient(135deg,#0c0618 0%,#12082a 100%);display:flex;flex-direction:column}
.mc-bg{position:absolute;inset:0;z-index:0;background-size:cover;background-position:center;filter:blur(18px) brightness(.75) saturate(1.5);transform:scale(1.25);opacity:0;transition:opacity .6s ease}
.mc-bg.show{opacity:1}
.mc-vis::after{content:'';position:absolute;inset:0;z-index:1;background:linear-gradient(to bottom,rgba(4,2,12,.05) 0%,rgba(4,2,12,.25) 100%);pointer-events:none}
.mc-top{display:flex;align-items:center;gap:11px;padding:12px 14px;position:relative;z-index:2;flex:1;flex-direction:row-reverse}
.mc-thumb-wrap{width:72px;height:72px;border-radius:50%;overflow:hidden;flex-shrink:0;border:2.5px solid rgba(139,92,246,.55);box-shadow:0 0 20px rgba(109,40,217,.5);position:relative}
.mc-thumb{width:100%;height:100%;object-fit:cover}
.mc-thumb.spin{animation:sp 12s linear infinite}@keyframes sp{to{transform:rotate(360deg)}}
.mc-thumb-fb{width:100%;height:100%;display:grid;place-items:center;background:rgba(109,40,217,.18);font-size:28px}
.waveform-wrap{display:flex;flex-direction:column;align-items:flex-start;flex:1;height:72px;overflow:hidden;position:relative;z-index:2}
.waveform{display:flex;align-items:flex-end;justify-content:space-evenly;flex:1;width:100%}
.wv-style-btn{flex-shrink:0;width:28px;height:28px;border-radius:50%;border:1px solid rgba(139,92,246,.45);background:rgba(109,40,217,.25);color:rgba(167,139,250,.95);cursor:pointer;font-size:14px;display:grid;place-items:center;align-self:flex-start;margin:0 0 4px 2px;transition:all .15s;padding:0;line-height:1}
.wv-style-btn:hover{background:rgba(109,40,217,.5)}
.wv-col{display:flex;flex-direction:column;align-items:center;justify-content:flex-end;position:relative;flex:1;height:100%}
.wv-bar{width:3px;flex-shrink:0;background:linear-gradient(to top,rgba(88,28,220,.7),rgba(167,139,250,.9));border-radius:2px 2px 1px 1px;will-change:height;height:3px;opacity:.9}
.wv-ball{position:absolute;bottom:3px;width:5px;height:5px;border-radius:50%;background:#c4b5fd;box-shadow:0 0 4px rgba(167,139,250,.8);left:50%;transform:translateX(-50%);transition:bottom 0.05s linear;pointer-events:none}
.mc-seek-wrap{position:relative;z-index:2;padding:4px 12px 10px 12px;flex-shrink:0}
.mc-seek-row{display:flex;align-items:center;gap:7px}
.mc-seek-bar{flex:1;height:3px;border-radius:2px;background:rgba(255,255,255,.12);cursor:pointer;position:relative;overflow:visible}
.mc-seek-fill{height:100%;background:linear-gradient(to right,#6d28d9,#a78bfa);border-radius:2px;transition:width .4s linear;pointer-events:none}
.mc-seek-thumb{position:absolute;top:50%;right:calc(100% - var(--spct,0%));transform:translate(50%,-50%);width:11px;height:11px;border-radius:50%;background:#c4b5fd;box-shadow:0 0 6px rgba(167,139,250,.7);opacity:0;transition:opacity .15s;pointer-events:none}
.mc-seek-bar:hover .mc-seek-thumb{opacity:1}
@media(hover:none){.mc-seek-thumb{opacity:1!important}}
.time-txt{font-size:12px;color:rgba(226,232,240,.55);min-width:32px;font-family:monospace}
.time-txt.right{text-align:right}
.media-controls{display:flex;align-items:center;justify-content:center;gap:10px;margin-bottom:14px}
.ctrl-btn{width:38px;height:38px;border-radius:50%;border:1px solid rgba(148,163,184,.15);background:rgba(2,6,23,.4);color:rgba(226,232,240,.8);cursor:pointer;font-size:14px;display:grid;place-items:center;transition:all .15s}
.ctrl-btn:hover{background:rgba(109,40,217,.3);border-color:rgba(139,92,246,.3)}
.ctrl-btn.play{width:52px;height:52px;font-size:20px;background:linear-gradient(135deg,#7c3aed,#5b21b6);border:1px solid rgba(139,92,246,.5);box-shadow:0 4px 20px rgba(109,40,217,.4);color:#fff}
.ctrl-btn.stop{background:rgba(239,68,68,.15);border-color:rgba(239,68,68,.25);color:rgba(239,68,68,.9)}
.ctrl-btn.active-btn{background:rgba(34,197,94,.15);border-color:rgba(34,197,94,.3);color:rgba(34,197,94,.9)}
.vol-row{display:flex;align-items:center;gap:8px;margin-top:10px;padding:0 2px}
.vol-icon{font-size:12px;color:rgba(226,232,240,.6)}
.vol-label{font-size:12px;color:rgba(226,232,240,.5);min-width:50px;text-align:right}
input[type=range]{flex:1;-webkit-appearance:none;height:5px;border-radius:999px;background:rgba(148,163,184,.2);outline:none;cursor:pointer}
input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:14px;height:14px;border-radius:50%;background:#7c3aed;border:2px solid rgba(167,139,250,.5);cursor:pointer}
.search-tabs{display:flex;gap:2px;margin-bottom:8px;border-bottom:1px solid rgba(148,163,184,.12);padding-bottom:6px}
.stab{padding:5px 10px;cursor:pointer;font-size:13px;font-weight:700;color:rgba(226,232,240,.5);background:transparent;border:none;border-bottom:2px solid transparent;transition:all .15s}
.stab.active{color:#a78bfa;border-bottom-color:#7c3aed}
.search-row{display:flex;gap:8px;margin-bottom:8px}
.search-inp{flex:1;background:rgba(2,6,23,.5);border:1px solid rgba(148,163,184,.18);border-radius:12px;padding:9px 12px;color:#e2e8f0;font-size:12px;outline:none}
.search-inp:focus{border-color:rgba(139,92,246,.5)}
.search-btn{padding:9px 14px;border-radius:12px;cursor:pointer;background:linear-gradient(135deg,#7c3aed,#5b21b6);border:1px solid rgba(139,92,246,.4);color:#fff;font-size:14px}
.search-results{max-height:180px;overflow-y:auto}
.search-results::-webkit-scrollbar{width:4px}.search-results::-webkit-scrollbar-thumb{background:rgba(139,92,246,.3);border-radius:999px}
.result-item{display:flex;align-items:center;gap:8px;padding:7px 8px;border-radius:10px;cursor:pointer;border:1px solid transparent;transition:all .15s;margin-bottom:4px}
.result-item:hover{background:rgba(109,40,217,.2);border-color:rgba(139,92,246,.2)}
.result-thumb{width:36px;height:36px;border-radius:8px;object-fit:cover;background:rgba(109,40,217,.2);flex-shrink:0;font-size:16px;display:grid;place-items:center}
.result-info{flex:1;min-width:0}
.result-title{font-size:13px;font-weight:700;color:#e2e8f0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.result-sub{font-size:11px;color:rgba(226,232,240,.5)}
.result-btns{display:flex;gap:4px;flex-shrink:0}
.rbtn{padding:5px 10px;border-radius:8px;cursor:pointer;font-size:11px;font-weight:700;border:none;transition:all .15s}
.rbtn-play{background:linear-gradient(135deg,#7c3aed,#5b21b6);color:#fff;border:1px solid rgba(139,92,246,.4)}
.rbtn-play:hover{box-shadow:0 2px 10px rgba(109,40,217,.4)}
.form-btn{padding:9px 16px;border-radius:10px;cursor:pointer;font-size:13px;font-weight:700;border:1px solid rgba(139,92,246,.3);background:rgba(109,40,217,.3);color:#c4b5fd}
.form-btn.sm{padding:6px 11px;font-size:12px}
.form-btn.danger{background:rgba(239,68,68,.15);border-color:rgba(239,68,68,.25);color:rgba(252,165,165,.9)}
.form-btn.green{background:rgba(34,197,94,.15);border-color:rgba(34,197,94,.3);color:#86efac}
.pl-item{display:flex;align-items:center;justify-content:space-between;padding:8px 10px;border-radius:10px;border:1px solid rgba(148,163,184,.1);background:rgba(2,6,23,.25);margin-bottom:5px}
.pl-name{font-size:11px;font-weight:700;color:#e2e8f0;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pl-count{font-size:9px;color:rgba(226,232,240,.45);margin-left:8px}
.pl-btns{display:flex;gap:3px;margin-left:8px}
.modal-overlay{position:fixed;top:0;left:0;right:0;bottom:0;z-index:200;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:16px}
.modal-box{background:linear-gradient(180deg,#0f172a,#0a0f1e);border:1px solid rgba(139,92,246,.2);border-radius:18px;padding:18px;max-width:320px;width:100%;max-height:85vh;overflow-y:auto}
.modal-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}
.modal-head h3{font-size:14px;font-weight:900;color:#e2e8f0}
.modal-close{background:none;border:none;color:rgba(226,232,240,.5);cursor:pointer;font-size:18px;padding:4px}
.form-inp{width:100%;background:rgba(2,6,23,.4);border:1px solid rgba(148,163,184,.15);border-radius:10px;padding:9px 11px;color:#e2e8f0;font-size:13px;outline:none}
.form-inp:focus{border-color:rgba(139,92,246,.4)}
.toast{position:fixed;z-index:9999;left:50%;transform:translateX(-50%);bottom:16px;background:rgba(2,6,23,.9);border:1px solid rgba(148,163,184,.2);color:#e2e8f0;padding:9px 14px;border-radius:12px;font-size:11px;opacity:0;pointer-events:none;transition:opacity .18s,transform .18s;white-space:nowrap}
.toast.on{opacity:1;transform:translateX(-50%) translateY(-6px)}
.toast.success{border-color:rgba(34,197,94,.3);color:#86efac}
.toast.error{border-color:rgba(239,68,68,.3);color:#fca5a5}
.hidden{display:none!important}
@media(max-width:480px){.wrap{padding:10px 10px 8px}.title-text{font-size:14px}.mc-thumb-wrap{width:60px;height:60px}.waveform-wrap{height:60px!important}.mc-title{font-size:13px}.ctrl-btn{width:34px;height:34px;font-size:13px}.ctrl-btn.play{width:46px;height:46px;font-size:18px}.search-results{max-height:140px}}
</style>`;

    this._setConnDot(this._wsConnected);
    if (this._rooms) this._renderRoomPills();
    if (this._offline) this._setOffline(true, this._retryIn * 1000);
    this._renderMedia(); this._renderVolume();
    setTimeout(() => { this._renderSyncBar(); this._renderRoomVolumeSliders(); }, 0);
  }

  _bind() {
    if (this._rooms) {
      this.querySelectorAll(".room-pill").forEach(pill => { pill.onclick = () => this._switchRoom(parseInt(pill.dataset.ridx)); });
      this.querySelectorAll(".sync-cb").forEach(cb => {
        cb.onchange = () => {
          const idx = parseInt(cb.dataset.sidx);
          if (cb.checked) {
            this._syncRoomIdxs.add(idx);
            let pendingCmd = null;
            const m = this._state.media;
            if (m.isPlaying && this._config.sync_send_song !== false) {
              const zingSongId = m.songId || (m.source === "zing" ? this._lastZingSongId : "");
              if (m.source === "zing" && zingSongId) pendingCmd = { action: "play_zing", song_id: zingSongId };
              else if (m.videoId) pendingCmd = { action: "play_song", video_id: m.videoId };
              else if (m.url) pendingCmd = { action: "play_url", url: m.url, title: m.title, artist: m.artist, thumbnail_url: m.thumb };
              if (!pendingCmd) pendingCmd = this._buildPlayCmdFromCache(this._nowPlaying);
            }
            this._connectMultiRoom(idx, pendingCmd);
            if (pendingCmd) { setTimeout(() => { if (this._syncRoomIdxs.has(idx) && this._state.media.isPlaying) { this._autoSyncDoneForSong = false; this._lastSyncSongTitle = ""; this._scheduleAutoSync(); } }, 4000); }
            const label = cb.closest('.sync-cb-label');
            if (label) { label.classList.add('synced'); const icon = label.querySelector('.sync-cb-icon'); if (icon) icon.textContent = '🔗'; }
            this._toast(`🔗 Broadcast → ${this._rooms[idx].name}`, "success");
          } else {
            this._syncRoomIdxs.delete(idx);
            this._disconnectMultiRoom(idx);
            const label = cb.closest('.sync-cb-label');
            if (label) { label.classList.remove('synced'); const icon = label.querySelector('.sync-cb-icon'); if (icon) icon.textContent = '⭕'; }
            this._toast(`⭕ Bỏ broadcast ${this._rooms[idx].name}`, "");
          }
          this._lsSet('syncIdxs', Array.from(this._syncRoomIdxs));
          this._renderSyncBar(); this._renderRoomVolumeSliders();
        };
      });
    }

    const on = (sel, fn, cb) => { const el = this.querySelector(sel); if (!el) return; if (fn) el.onclick = fn; if (cb) cb(el); };

    on("#btnWaveStyle", () => this._toggleWaveStyle());
    on("#seekWrap", null, el => {
      const doSeek = (clientX) => {
        const m = this._state.media; if (!m.duration) return;
        const r = el.getBoundingClientRect();
        const pos = Math.floor(m.duration * Math.max(0, Math.min(1, (clientX - r.left) / r.width)));
        m.position = pos;
        this._broadcastCmd({ action: "seek", position: pos });
        this._updateProgressOnly();
      };
      el.onclick = e => doSeek(e.clientX);
      el.addEventListener('touchend', e => { e.preventDefault(); doSeek(e.changedTouches[0].clientX); }, { passive: false });
    });

    on("#btnPlayPause", () => {
      if (this._state.media.isPlaying) {
        this._broadcastCmd({ action: "pause" });
        this._broadcastSpkCmd({ type: 'send_message', what: 65536, arg1: 0, arg2: 1, obj: 'playorpause' });
      } else {
        this._broadcastCmd({ action: "resume" });
        this._broadcastSpkCmd({ type: 'send_message', what: 65536, arg1: 0, arg2: 1, obj: 'playorpause' });
      }
    });

    on("#btnStop", () => {
      this._resetNowPlayingCache();
      const m = this._state.media;
      m.position = 0; m.duration = 0; m.isPlaying = false;
      m.title = "Không có nhạc"; m.artist = "---"; m.thumb = ""; m.source = null;
      this._stopGuardUntil = Date.now() + 3000;
      this._broadcastCmd({ action: "stop" });
      this._broadcastSpkCmd({ type: "send_message", what: 65536, arg1: 0, arg2: 1, obj: "stop" });
      this._updateProgressOnly(); this._renderMedia();
      clearInterval(this._progressInterval); this._progressInterval = null;
    });

    on("#btnPrev", () => this._triggerMasterPrev());
    on("#btnNext", () => this._triggerMasterNext());
    on("#btnRepeat", () => this._send({ action: "toggle_repeat" }));
    on("#btnShuffle", () => this._send({ action: "toggle_auto_next" }));

    const vs = this.querySelector("#volSlider");
    if (vs) {
      vs.oninput = () => {
        const v = parseInt(vs.value, 10); this._volDragging = true; this._state.volume = v;
        const l = this.querySelector("#volLabel"); if (l) l.textContent = `Mức ${v}`;
        clearTimeout(this._volSendTimer); this._volSendTimer = setTimeout(() => this._broadcastVolume(v), 100);
        clearTimeout(this._volLockTimer); this._volLockTimer = setTimeout(() => { this._volDragging = false; }, 2000);
      };
      vs.onchange = () => {
        clearTimeout(this._volSendTimer); const v = parseInt(vs.value, 10); this._state.volume = v;
        this._broadcastVolume(v);
        clearTimeout(this._volLockTimer); this._volLockTimer = setTimeout(() => { this._volDragging = false; }, 2000);
      };
    }

    this.querySelectorAll(".stab").forEach(b => {
      b.onclick = () => {
        this._activeSearchTab = b.dataset.stab;
        this.querySelectorAll(".stab").forEach(x => x.classList.remove("active")); b.classList.add("active");
        const isPlaylists = b.dataset.stab === "playlists";
        const sb = this.querySelector("#searchBox"), pm = this.querySelector("#plMgr"), sr = this.querySelector("#searchResults");
        if (sb) sb.style.display = isPlaylists ? "none" : "";
        if (sr) sr.style.display = isPlaylists ? "none" : "";
        if (pm) pm.style.display = isPlaylists ? "" : "none";
        if (isPlaylists) this._send({ action: "playlist_list" });
        else if (sr) sr.innerHTML = "";
      };
    });

    on("#searchBtn", () => this._doSearch());
    const si = this.querySelector("#searchInp"); if (si) si.onkeypress = e => { if (e.key === "Enter") this._doSearch(); };
    on("#btnPlCreate", () => {
      const name = prompt("Tên playlist mới:"); if (name?.trim()) this._send({ action: "playlist_create", name: name.trim() });
    });
    on("#btnPlRefresh", () => this._send({ action: "playlist_list" }));

    setTimeout(() => { this._renderSyncBar(); this._renderRoomVolumeSliders(); }, 0);
  }

  _doSearch() {
    const q = (this.querySelector("#searchInp")?.value || "").trim(); if (!q) return;
    const sr = this.querySelector("#searchResults");
    if (sr) sr.innerHTML = '<div style="text-align:center;padding:12px;color:rgba(226,232,240,.4);font-size:11px">Đang tìm...</div>';
    const tab = this._activeSearchTab;
    if (tab === "songs") this._send({ action: "search_songs", query: q });
    else if (tab === "zing") this._send({ action: "search_zing", query: q });
    else if (tab === "playlist") this._send({ action: "search_playlist", query: q });
    else this._send({ action: "search_songs", query: q });
  }

  _renderSearchResults(items, type = "youtube") {
    const el = this.querySelector("#searchResults"); if (!el) return;
    if (!items.length) { el.innerHTML = '<div style="text-align:center;padding:14px;color:rgba(226,232,240,.35);font-size:11px">Không có kết quả</div>'; return; }
    el.innerHTML = items.map((item, i) => {
      const title = item.title || item.name || "---", sub = item.artist || item.channel || "";
      const thumb = item.thumbnail_url || "", dur = item.duration_seconds ? this._fmtTime(item.duration_seconds) : (item.duration || "");
      return `<div class="result-item">${thumb ? `<img class="result-thumb" src="${this._esc(thumb)}" onerror="this.style.display='none'" />` : '<div class="result-thumb">🎵</div>'}
<div class="result-info"><div class="result-title">${this._esc(title)}</div><div class="result-sub">${this._esc(sub)}${dur ? " · " + dur : ""}</div></div>
<div class="result-btns"><button class="rbtn rbtn-play" data-playidx="${i}">▶ Phát</button></div></div>`;
    }).join("");
    items.forEach((item, i) => {
      const playBtn = el.querySelector(`[data-playidx="${i}"]`);
      if (playBtn) playBtn.onclick = () => {
        let cmd;
        if (type === "playlist") {
          cmd = { action: "playlist_play", playlist_id: item.playlist_id || item.id };
        } else if (type === "zing") {
          const sid = item.song_id || item.id;
          this._lastZingSongId = sid; this._state.media.songId = sid;
          this._nowPlaying = { source:"zing", songId:sid, videoId:"", url:"", title:item.title||item.name||"", artist:item.artist||item.channel||"", thumb:item.thumbnail_url||"", position:0, duration:item.duration_seconds||0, isPlaying:true };
          cmd = { action: "play_zing", song_id: sid };
        } else {
          const vid = item.video_id || item.id;
          this._nowPlaying = { source:"youtube", songId:"", videoId:vid, url:"", title:item.title||item.name||"", artist:item.artist||item.channel||"", thumb:item.thumbnail_url||"", position:0, duration:item.duration_seconds||0, isPlaying:true };
          cmd = { action: "play_song", video_id: vid };
        }
        this._broadcastCmd(cmd);
        this._autoSyncDoneForSong = false; this._lastSyncSongTitle = "";
        this._toast(`▶ ${this._esc(item.title || "")}`, "success");
      };
    });
  }

  _renderPlaylistList(playlists) {
    this._state.playlists = playlists || [];
    const el = this.querySelector("#plList"); if (!el) return;
    if (!playlists.length) { el.innerHTML = '<div style="text-align:center;padding:12px;color:rgba(226,232,240,.35);font-size:11px">Chưa có playlist</div>'; return; }
    el.innerHTML = playlists.map((pl, i) => `<div class="pl-item"><span class="pl-name">${this._esc(pl.name || "Playlist")}</span><span class="pl-count">${pl.song_count || 0} bài</span><div class="pl-btns"><button class="form-btn sm green" data-plplay="${i}">▶</button><button class="form-btn sm" data-plview="${i}">👁</button><button class="form-btn sm danger" data-pldel="${i}">✕</button></div></div>`).join("");
    playlists.forEach((pl, i) => {
      this.querySelector(`[data-plplay="${i}"]`)?.addEventListener('click', () => { this._send({ action: "playlist_get_songs", playlist_id: pl.id }); this._send({ action: "playlist_play", playlist_id: pl.id }); this._toast(`▶ ${pl.name}`, "success"); });
      this.querySelector(`[data-plview="${i}"]`)?.addEventListener('click', () => this._send({ action: "playlist_get_songs", playlist_id: pl.id }));
      this.querySelector(`[data-pldel="${i}"]`)?.addEventListener('click', () => { if (confirm(`Xóa "${pl.name}"?`)) this._send({ action: "playlist_delete", playlist_id: pl.id }); });
    });
  }

  // ─── Message Handler ──────────────────────────────────────────────
  _handleMsg(raw) {
    let d; try { d = JSON.parse(raw); } catch { return; }
    try { this._handleMsgInner(d); } catch(e) {}
  }

  _handleMsgInner(d) {
    if (d.type === "search_result") {
      const songs = d.songs || d.results || [];
      this._songCache = songs.map(s => ({ source: "youtube", id: s.video_id || s.id, title: s.title || "", artist: s.channel || s.artist || "", thumb: s.thumbnail_url || "", duration: s.duration_seconds || 0 }));
      this._renderSearchResults(songs, "youtube"); return;
    }
    if (d.type === "zing_result") {
      const songs = d.songs || d.results || [];
      this._songCache = songs.map(s => ({ source: "zing", id: s.song_id || s.id, title: s.title || "", artist: s.artist || "", thumb: s.thumbnail_url || "", duration: s.duration_seconds || 0 }));
      this._renderSearchResults(songs, "zing"); return;
    }
    if (d.type === "playlist_result") { this._renderSearchResults(d.songs || d.playlists || d.results || [], "playlist"); return; }
    if (d.type === "playlist_list_result") { this._renderPlaylistList(d.playlists || []); return; }
    if (d.type === "playlist_created") { this._toast(`✅ Đã tạo playlist: ${this._esc(d.playlist?.name || "")}`, "success"); this._send({ action: "playlist_list" }); return; }
    if (d.type === "playlist_deleted") { this._toast("🗑 Đã xóa playlist", "success"); this._send({ action: "playlist_list" }); return; }
    if (d.type === "playlist_play_started") {
      this._activePlaylistId = d.playlist_id ?? null;
      this._songCache = [];
      if (this._activePlaylistId != null) this._send({ action: "playlist_get_songs", playlist_id: this._activePlaylistId });
      this._toast(`▶ Đang phát: ${this._esc(d.playlist_name || "")}`, "success"); return;
    }
    if (d.type === "playlist_songs_result") {
      this._state.playlistSongs = d.songs || [];
      this._songCache = (d.songs || []).map(s => ({ source: s.source || "youtube", id: s.id || s.song_id || s.video_id || "", title: s.title || "", artist: s.artist || s.channel || "", thumb: s.thumbnail_url || "", duration: s.duration_seconds || 0 }));
      if (this._pendingNextTitle) {
        const cached = this._lookupSongByTitle(this._pendingNextTitle);
        if (cached) {
          this._pendingNextTitle = null;
          const targets = this._getSyncTargets();
          const playCmd = cached.source === "zing"
            ? { action: "play_zing", song_id: cached.id, title: cached.title, artist: cached.artist, thumbnail_url: cached.thumb }
            : { action: "play_song", video_id: cached.id, title: cached.title, artist: cached.artist, thumbnail_url: cached.thumb };
          targets.forEach(idx => this._sendToRoom(idx, { action: "stop" }));
          targets.forEach((idx, i) => setTimeout(() => { if (this._switching) return; this._sendToRoom(idx, playCmd); }, i * 300 + 100));
        }
      }
      const el = this.querySelector("#plSongs"); if (!el) return;
      el.style.display = "";
      el.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><span style="font-size:10px;font-weight:700;color:rgba(226,232,240,.6)">📋 ${this._esc(d.playlist_name||'')} (${(d.songs||[]).length} bài)</span><button class="form-btn sm" id="closePlSongs">✕</button></div>` +
        (d.songs?.length ? d.songs.map((s, i) => `<div class="result-item">${s.thumbnail_url ? `<img class="result-thumb" src="${this._esc(s.thumbnail_url)}" onerror="this.style.display='none'" />` : '<div class="result-thumb">🎵</div>'}<div class="result-info"><div class="result-title">${this._esc(s.title || "?")}</div><div class="result-sub">${this._esc(s.artist||'')}${s.duration_seconds ? ' · ' + this._fmtTime(s.duration_seconds) : ''}</div></div><div class="result-btns"><button class="rbtn rbtn-play" data-plsplay="${i}">▶</button><button class="form-btn sm danger" data-rmsong="${i}">✕</button></div></div>`).join("") : '<div style="text-align:center;padding:8px;font-size:10px;color:rgba(226,232,240,.4)">Trống</div>');
      this.querySelector("#closePlSongs")?.addEventListener('click', () => { el.style.display = "none"; });
      el.querySelectorAll("[data-plsplay]").forEach(btn => {
        btn.onclick = () => {
          const sidx = parseInt(btn.dataset.plsplay); const s = (d.songs||[])[sidx]; if (!s) return;
          let cmd;
          if (s.source === "zing") { const sid = s.id || s.song_id || ""; this._lastZingSongId = sid; this._nowPlaying = { source:"zing", songId:sid, videoId:"", url:"", title:s.title||"", artist:s.artist||"", thumb:s.thumbnail_url||"", position:0, duration:s.duration_seconds||0, isPlaying:true }; cmd = { action: "play_zing", song_id: sid }; }
          else { const vid = s.id || s.video_id || ""; this._nowPlaying = { source:"youtube", songId:"", videoId:vid, url:"", title:s.title||"", artist:s.artist||"", thumb:s.thumbnail_url||"", position:0, duration:s.duration_seconds||0, isPlaying:true }; cmd = { action: "play_song", video_id: vid }; }
          this._broadcastCmd(cmd); this._toast(`▶ ${this._esc(s.title||'')}`, "success");
        };
      });
      el.querySelectorAll("[data-rmsong]").forEach(btn => {
        btn.onclick = () => {
          const sidx = parseInt(btn.dataset.rmsong);
          if (confirm(`Xóa bài #${sidx + 1} khỏi playlist?`)) {
            this._send({ action: "playlist_remove_song", playlist_id: d.playlist_id, song_index: sidx });
            setTimeout(() => this._send({ action: "playlist_get_songs", playlist_id: d.playlist_id }), 300);
          }
        };
      });
      return;
    }

    if (d.type === "playback_state") {
      if (this._stopGuardUntil && Date.now() < this._stopGuardUntil) { if (!d.is_playing) d = { ...d, position: 0, duration: 0 }; }
      const m = this._state.media;
      const wasPlaying = m.isPlaying; const prevTitle = m.title; const newTitle = d.title || "";
      if (this._syncInProgress && newTitle && prevTitle && newTitle !== prevTitle) { this._syncInProgress = false; this._syncGen++; this._toast("⚠️ Bài thay đổi — huỷ sync", "error"); }
      m.source = d.source || "youtube"; m.isPlaying = !!d.is_playing;
      m.title = d.title || "Không có nhạc"; m.artist = d.artist || d.channel || "---"; m.thumb = d.thumbnail_url || "";
      if (newTitle && prevTitle && newTitle !== prevTitle) { m.videoId = ""; m.songId = ""; m.url = ""; this._lastZingSongId = ""; }
      if (d.url) m.url = d.url;
      if (d.video_id) m.videoId = d.video_id;
      if (d.song_id) { m.songId = d.song_id; if (m.source === "zing") this._lastZingSongId = d.song_id; }
      else if (m.source === "zing" && this._lastZingSongId) { m.songId = this._lastZingSongId; }
      else if (m.source !== "zing") { m.songId = ""; }
      if (d.id && !m.videoId && !m.songId) { if (m.source === "zing") { m.songId = d.id; this._lastZingSongId = d.id; } else m.videoId = d.id; }
      if (!(this._posSyncGuardUntil && Date.now() < this._posSyncGuardUntil)) m.position = Number(d.position || 0);
      m.duration = Number(d.duration || 0);
      if (d.auto_next_enabled !== undefined) m.autoNext = !!d.auto_next_enabled;
      if (d.repeat_enabled !== undefined) m.repeat = !!d.repeat_enabled;
      if (d.shuffle_enabled !== undefined) m.shuffle = !!d.shuffle_enabled;
      if (d.volume !== undefined && !(this._volSyncGuardUntil && Date.now() < this._volSyncGuardUntil)) this._state.volume = Number(d.volume);

      if (!m.isPlaying && m.position === 0 && m.duration === 0) this._resetNowPlayingCache(); else this._updateNowPlayingCache();

      if (newTitle && newTitle !== prevTitle) {
        if (this._pendingRoomCmd === "broadcast") {
          this._pendingRoomCmd = null;
        } else {
          if (!this._pendingNextTitle) this._pendingNextTitle = newTitle;
          this._pendingRoomCmd = null;
        }
        this._autoSyncDoneForSong = false; this._lastSyncSongTitle = "";
      }

      if (this._pendingNextTitle && this._pendingNextTitle === m.title && m.isPlaying) {
        const waitTitle = this._pendingNextTitle;
        const targets = this._getSyncTargets();
        const _sendSeq = (playCmd) => {
          this._pendingNextTitle = null;
          if (!targets.length || this._config.sync_send_song === false) return;
          targets.forEach(idx => this._sendToRoom(idx, { action: "stop" }));
          targets.forEach((idx, i) => setTimeout(() => { if (this._switching) return; this._sendToRoom(idx, playCmd); }, i * 300 + 100));
        };
        if (targets.length > 0 && this._config.sync_send_song !== false) {
          const cached = this._lookupSongByTitle(waitTitle);
          if (cached) {
            const playCmd = cached.source === "zing"
              ? { action: "play_zing", song_id: cached.id, title: cached.title, artist: cached.artist, thumbnail_url: cached.thumb }
              : { action: "play_song", video_id: cached.id, title: cached.title, artist: cached.artist, thumbnail_url: cached.thumb };
            _sendSeq(playCmd);
          } else if (m.source === "youtube") {
            const vid = this._extractYtVideoId(m.thumb);
            _sendSeq(vid ? { action: "play_song", video_id: vid, title: m.title, artist: m.artist, thumbnail_url: m.thumb } : { action: "next" });
          } else if (m.source === "zing" && this._activePlaylistId) {
            this._send({ action: "playlist_get_songs", playlist_id: this._activePlaylistId });
          } else if (m.source === "zing" && this._lastZingSongId) {
            _sendSeq({ action: "play_zing", song_id: this._lastZingSongId, title: m.title, artist: m.artist, thumbnail_url: m.thumb });
          } else {
            _sendSeq({ action: "next" });
          }
        }
      }

      if (m.isPlaying && newTitle !== prevTitle) { clearTimeout(this._autoSyncTimer); this._autoSyncDoneForSong = false; this._scheduleAutoSync(); }
      if (m.isPlaying && !this._progressInterval) this._startProgressTick();
      else if (!m.isPlaying) { clearInterval(this._progressInterval); this._progressInterval = null; }

      this._renderMedia(); this._renderVolume();
      return;
    }

    // get_info fallback
    if (d.type === "get_info" && d.data) {
      const data = d.data;
      if (data.vol !== undefined && !this._volDragging) {
        const v = Number(data.vol);
        if (v !== this._state.volume) { this._state.volume = v; this._renderVolume(); }
      }
    }
  }

  _updateProgressOnly() {
    const m = this._state.media;
    const p = this.querySelector("#posText"), dur = this.querySelector("#durText"), bar = this.querySelector("#seekBar");
    if (p) p.textContent = this._fmtTime(m.position);
    if (dur) dur.textContent = this._fmtTime(m.duration);
    const pct = m.duration > 0 ? Math.min(100, (m.position / m.duration) * 100) : 0;
    if (bar) bar.style.width = pct + "%";
    const thumb = this.querySelector("#seekThumb"); if (thumb) thumb.style.setProperty("--spct", pct + "%");
  }

  _renderMedia() {
    const m = this._state.media;
    const src = this.querySelector("#mediaThumb"), fb = this.querySelector("#thumbFallback");
    if (src && fb) {
      if (m.thumb) { src.src = m.thumb; src.style.display = "block"; fb.style.display = "none"; src.classList.toggle("spin", m.isPlaying); }
      else { src.style.display = "none"; fb.style.display = "block"; }
    }
    const sl = this.querySelector("#sourceLabel"); if (sl) sl.textContent = (!m.isPlaying || !m.source) ? "IDLE" : m.source === "zing" ? "ZING MP3" : "YOUTUBE";
    const t = this.querySelector("#mediaTitle"); if (t) t.textContent = m.title;
    const a = this.querySelector("#mediaArtist"); if (a) a.textContent = m.artist;
    const pp = this.querySelector("#btnPlayPause"); if (pp) pp.textContent = m.isPlaying ? "⏸" : "▶";
    const rp = this.querySelector("#btnRepeat"); if (rp) rp.classList.toggle("active-btn", !!m.repeat);
    const sh = this.querySelector("#btnShuffle"); if (sh) sh.classList.toggle("active-btn", !!m.autoNext);
    const ww = this.querySelector("#waveformWrap");
    if (ww) {
      ww.style.display = m.isPlaying ? "flex" : "none";
      if (m.isPlaying) { const wv = this.querySelector('#waveform'); if (wv) { this._waveBars = wv.querySelectorAll('.wv-bar'); this._waveBalls = wv.querySelectorAll('.wv-ball'); } }
    }
    const styleBtn = this.querySelector('#btnWaveStyle'); if (styleBtn) styleBtn.textContent = (this._waveStyle || 'ball') === 'classic' ? '≡' : '⚬';
    const mcBg = this.querySelector("#mcBg");
    if (mcBg) {
      if (m.thumb) { mcBg.style.backgroundImage = `url("${m.thumb}")`; mcBg.classList.add("show"); }
      else { mcBg.style.backgroundImage = ''; mcBg.classList.remove("show"); }
    }
    this._updateProgressOnly();
  }

  _renderVolume() {
    if (this._volDragging) return;
    const s = this.querySelector("#volSlider"), l = this.querySelector("#volLabel");
    if (s) s.value = this._state.volume; if (l) l.textContent = `Mức ${this._state.volume}`;
    const masterSlider = this.querySelector(`.room-vol-slider[data-rvidx="${this._currentRoomIdx}"]`);
    if (masterSlider) { masterSlider.value = this._state.volume; const lbl = this.querySelector(`#rvl_${this._currentRoomIdx}`); if (lbl) lbl.textContent = this._state.volume; }
  }
}

if (!customElements.get("aibox-ha-card-lite")) {
  customElements.define("aibox-ha-card-lite", PhicommR1LiteCard);
}

window.customCards = window.customCards || [];
if (!window.customCards.find(c => c.type === "aibox-ha-card-lite")) {
  window.customCards.push({
    type: "aibox-ha-card-lite",
    name: "Aibox Ha Lite Card — Media Only",
    description: "Card media thuần — waveform, seek, controls, volume, search, playlist, multiroom sync. Derived from aibox-ha-card.",
    preview: false,
  });
}
