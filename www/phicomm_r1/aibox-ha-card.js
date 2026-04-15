
const DEFAULTS = {
  host: "", ws_port: 8082, speaker_port: 8080, http_port: 8081,
  // HTTPS/domain custom proxy (ưu tiên hơn tunnel khi có cấu hình)
  custom_ws_url: "",
  custom_speaker_ws_url: "",
  tunnel_host: "", tunnel_port: 443, tunnel_path: "/",
  speaker_tunnel_host: "", speaker_tunnel_port: 443, speaker_tunnel_path: "/",
  mode: "auto", title: "AI BOX",
  rooms: null,
  default_tab: "media", show_background: true,
  reconnect_ms: 1500, connect_timeout_ms: 2500,
  sync_send_song: true,
  // Sync timing (ms)
  auto_sync_delay_ms: 5000,    // Chờ bao lâu sau khi bài bắt đầu phát rồi mới auto-sync
  sync_pause_ms: 400,          // Thời gian pause để các client ổn định trước khi seek
  sync_resume_delay_ms: 3000,  // Chờ sau khi seek xong rồi mới resume (đủ để buffer)
};

const VOICES = {1:'Ngọc Anh',2:'Minh Anh',3:'Khánh An',4:'Bảo Ngọc',5:'Thanh Mai',6:'Hà My',7:'Thùy Dung',8:'Diệu Linh',9:'Lan Anh',10:'Ngọc Hà',11:'Mai Anh',12:'Bảo Châu',13:'Tú Linh',14:'An Nhiên',15:'Minh Khang',16:'Hoàng Nam',17:'Gia Huy',18:'Đức Anh',19:'Quang Minh',20:'Bảo Long',21:'Hải Đăng',22:'Tuấn Kiệt',23:'Nhật Minh',24:'Anh Dũng',25:'Trung Kiên',26:'Khánh Duy',27:'Phúc An',28:'Thành Đạt',29:'Hữu Phước',30:'Thiên Ân'};
const VFILES = {1:'ngocanh',2:'minhanh',3:'khanhan',4:'baongoc',5:'thanhmai',6:'hamy',7:'thuydung',8:'dieulinh',9:'lananh',10:'ngocha',11:'maianh',12:'baochau',13:'tulinh',14:'annhien',15:'minhkhang',16:'hoangnam',17:'giahuy',18:'ducanh',19:'quangminh',20:'baolong',21:'haidang',22:'tuankiet',23:'nhatminh',24:'anhdung',25:'trungkien',26:'khanhduy',27:'phucan',28:'thanhdat',29:'huuphuoc',30:'thienan'};
const VBASE = 'https://r1.truongblack.me/download/';
const EQ_PRESETS = { flat:[0,0,0,0,0], bass:[800,400,0,0,0], vocal:[-200,0,600,400,0], rock:[500,200,-200,300,500], jazz:[300,0,200,400,300] };
const EQ_LABELS = ['60Hz','230Hz','910Hz','3.6K','14K'];

const ROOM_COLORS = ['#a78bfa','#34d399','#fb923c','#f472b6','#38bdf8','#facc15','#4ade80','#e879f9'];

class AiBoxCard extends HTMLElement {
  static getStubConfig() { return { mode: "auto", title: "AI BOX", rooms: [] }; }
  static getConfigElement() { return null; }

  _lsKey(k) { return `aibox_${(this._config?.title||'card').replace(/\W+/g,'_')}_${k}`; }
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
      this._stopTabServices();
      clearTimeout(this._reconnectTimer); clearTimeout(this._connectTimeout);
      clearTimeout(this._spkReconnect); clearTimeout(this._autoSyncTimer);
      clearTimeout(this._volSendTimer); clearTimeout(this._volLockTimer);
      clearTimeout(this._toastTimer); clearInterval(this._retryCountdownTimer);
      this._clearAllRoomVolTimers();
    }

    this._ws = null; this._wsConnected = false;
    this._spkWs = null; this._spkHb = null; this._spkEqHb = null; this._spkReconnect = null;
    this._switching = false;
    this._lastZingSongId = ""; // track zing song_id vì playback_state không trả về song_id
    // ─── NowPlaying Cache ─────────────────────────────────────────
    this._nowPlaying = {
      source:    null,
      songId:    "",
      videoId:   "",
      url:       "",
      title:     "",
      artist:    "",
      thumb:     "",
      position:  0,
      duration:  0,
      isPlaying: false,
    };    
    this._ctrlPoll = null; this._sysPoll = null; this._progressInterval = null;
    this._reconnectTimer = null; this._connectTimeout = null; this._toastTimer = null;
    this._retryCountdownTimer = null; this._volSendTimer = null; this._volLockTimer = null;
    this._waveRaf = null;
    this._volTempWs = null;

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
    this._pendingBroadcastNextSong = false;
    this._pendingBroadcastTimer = null;
    this._pendingRoomCmd = null;  // null=auto-next | "next"/"prev"=manual | "broadcast"=direct play
    this._pendingNextTitle = null; // chờ is_playing=true với title này rồi gửi tuần tự sang rooms

    // ─── Song Cache (bộ nhớ tạm) ──────────────────────────────────
    // Lưu danh sách bài từ search hoặc playlist hiện tại
    // Reset khi search mới hoặc playlist mới phát
    // Format: [{source:"youtube"|"zing", id, title, artist, thumb, duration}]
    this._songCache = [];
    this._activePlaylistId = null; // playlist đang phát → dùng để re-fetch khi lookup thất bại

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

    this._cardCollapsed = !!this._config.default_collapsed;

    this._activeTab = this._config.default_tab;
    this._activeSearchTab = 'songs';
    this._activeAudioTab = 'eq';
    this._activeLightTab = 'main';
    this._audioOpen = false; this._lightOpen = false;
    this._volDragging = false; this._ctrlGuard = 0; this._audioGuard = 0;
    this._lastCpuIdle = null; this._lastCpuTotal = null;
    this._offline = false; this._retryIn = 0; this._failCount = 0; this._dropCount = 0;
    this._chatLoaded = false; this._waveBars = null; this._waveBalls = null;

    this._state = {
      chat: [], chatBg64: "", tiktokReply: false, chatSessionActive: false, chatSpeaking: false,
      ledEnabled: null, dlnaOpen: null, airplayOpen: null, bluetoothOn: null,
      lightEnabled: null, brightness: 100, speed: 50, edgeOn: false, edgeInt: 100,
      wakeWordEnabled: null, wakeWordSensitivity: null,
      customAiEnabled: null, voiceId: null, live2dModel: null,
      otaUrl: null, otaOptions: null,
      hassConfigured: null, hassUrl: "", hassAgentId: "", hassApiKeyMasked: false,
      wifiStatus: null, wifiNetworks: [], wifiSaved: [],
      macAddress: "", macIsCustom: false,
      media: { source: null, isPlaying: false, title: "Không có nhạc", artist: "---",
        thumb: "", position: 0, duration: 0, autoNext: true, repeat: false, shuffle: false,
        url: "", videoId: "", songId: "" },
      volume: 0, sys: { cpu: 0, ram: 0 },
      alarms: [], playlists: [], playlistSongs: [],
      eqEnabled: false, eqBands: [0,0,0,0,0],
      bass: { enabled: false, strength: 0 }, loudness: { enabled: false, gain: 0 },
      bassVol: 231, highVol: 231, surroundW: 40,
      premium: -1, premQrB64: "",
    };

    if (this._inited) { this._render(); this._bind(); this._connectWsAuto(); }
  }

  _clearAllRoomVolTimers() {
    if (!this._rooms) return;
    this._rooms.forEach((_, i) => {
      if (this[`_rvTimer_${i}`]) { clearTimeout(this[`_rvTimer_${i}`]); this[`_rvTimer_${i}`] = null; }
      this[`_rvGuardUntil_${i}`] = 0; // ← THÊM DÒNG NÀY
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
    this._clearAllRoomVolTimers();
    clearTimeout(this._pendingBroadcastTimer); this._pendingBroadcastTimer = null;
    this._pendingBroadcastNextSong = false;
    this._pendingRoomCmd = null;
    this._pendingNextTitle = null;
    this._reconnectTimer = null; this._connectTimeout = null;
    this._spkReconnect = null; this._retryCountdownTimer = null;
    this._currentRoomIdx = idx;
    this._lsSet('roomIdx', idx);
    this._applyRoomToConfig();
    this._resetState();
    
    this._switching = true;
    this._syncGen++;
    this._syncInProgress = false;
    this._disconnectAllMulti();
    this._closeWs();
    this._switching = false;
    this._offline = false; this._failCount = 0; this._dropCount = 0;
    this._chatLoaded = false; this._waveBars = null; this._waveBalls = null; this._retryIn = 0;
    this._render(); this._bind();
    this._setConnDot(false); this._setConnText("WS");
    this._toast("🏠 " + this._rooms[idx].name, "success");
    setTimeout(() => {
      this._switching = false;
      this._syncRoomIdxs.forEach(sidx => {
        if (sidx !== this._currentRoomIdx) this._connectMultiRoom(sidx);
      });
      this._connectWsAuto();
    }, 120);
  }

  _resetState() {
    this._state = {
      chat: [], chatBg64: "", tiktokReply: false, chatSessionActive: false, chatSpeaking: false,
      ledEnabled: null, dlnaOpen: null, airplayOpen: null, bluetoothOn: null,
      lightEnabled: null, brightness: 100, speed: 50, edgeOn: false, edgeInt: 100,
      wakeWordEnabled: null, wakeWordSensitivity: null,
      customAiEnabled: null, voiceId: null, live2dModel: null,
      otaUrl: null, otaOptions: null,
      hassConfigured: null, hassUrl: "", hassAgentId: "", hassApiKeyMasked: false,
      wifiStatus: null, wifiNetworks: [], wifiSaved: [],
      macAddress: "", macIsCustom: false,
      media: { source: null, isPlaying: false, title: "Không có nhạc", artist: "---",
        thumb: "", position: 0, duration: 0, autoNext: true, repeat: false, shuffle: false ,
        url: "",      // ← THÊM
        videoId: "",  // ← THÊM
        songId: "",   // ← THÊM
      },    
      volume: 0, sys: { cpu: 0, ram: 0 },
      alarms: [], playlists: [], playlistSongs: [],
      eqEnabled: false, eqBands: [0,0,0,0,0],
      bass: { enabled: false, strength: 0 }, loudness: { enabled: false, gain: 0 },
      bassVol: 231, highVol: 231, surroundW: 40,
      premium: -1, premQrB64: "",
    };
    this._ctrlGuard = 0; this._audioGuard = 0; this._volDragging = false;
    this._lastZingSongId = "";
    this._resetNowPlayingCache(); // ← THÊM
  }
  _updateNowPlayingCache() {
    const m = this._state.media;
    if (!m.isPlaying && m.title === "Không có nhạc") {
      this._resetNowPlayingCache();
      return;
    }
    this._nowPlaying = {
      source:    m.source   || null,
      songId:    m.songId   || (m.source === "zing" ? this._lastZingSongId : ""),
      videoId:   m.videoId  || "",
      url:       m.url      || "",
      title:     m.title    || "",
      artist:    m.artist   || "",
      thumb:     m.thumb    || "",
      position:  m.position || 0,
      duration:  m.duration || 0,
      isPlaying: m.isPlaying,
    };
  }

  _resetNowPlayingCache() {
    this._nowPlaying = {
      source:    null,
      songId:    "",
      videoId:   "",
      url:       "",
      title:     "",
      artist:    "",
      thumb:     "",
      position:  0,
      duration:  0,
      isPlaying: false,
    };
  }


  // Trích video_id từ YouTube thumbnail URL
  // VD: https://i.ytimg.com/vi/4IT7N1CQCNc/hq720.jpg → "4IT7N1CQCNc"
  _extractYtVideoId(thumbnailUrl) {
    if (!thumbnailUrl) return null;
    const m = thumbnailUrl.match(/ytimg\.com\/vi\/([^/?#]+)/);
    return m ? m[1] : null;
  }

  // Tra cứu bài hát trong _songCache theo title (normalize)
  _lookupSongByTitle(title) {
    if (!title) return null;
    const norm = t => (t || "").toLowerCase().replace(/\s+/g, " ").trim();
    return this._songCache.find(s => norm(s.title) === norm(title)) || null;
  }

  _buildPlayCmdFromCache(cache) {
    if (!cache) return null;
    // Zing: cần source + songId
    if (cache.source === "zing" && cache.songId)
      return {
        action: "play_zing", song_id: cache.songId,
        title: cache.title, artist: cache.artist, thumbnail_url: cache.thumb,
      };
    // YouTube/URL: không cần kiểm tra source
    if (cache.videoId)
      return {
        action: "play_song", video_id: cache.videoId,
        title: cache.title, artist: cache.artist, thumbnail_url: cache.thumb,
      };
    if (cache.url)
      return { action: "play_url", url: cache.url, title: cache.title, artist: cache.artist, thumbnail_url: cache.thumb };
    return null;
  }
  // ════════════════════════════════════════════════════════════════════
  // MULTIROOM – WebSocket Pool
  // ════════════════════════════════════════════════════════════════════

  _buildMultiRoomWsUrl(idx) {
    const room = this._rooms[idx]; if (!room) return "";
    const mode = (this._config.mode || "auto").toLowerCase();
    const https = this._isHttps();
    const _customUrl = () => this._resolveCustomWsUrl(room.custom_ws_url || this._config.custom_ws_url || "", room.host);
    const _tunnelUrl = () => {
      const th = room.tunnel_host; if (!th) return "";
      const tp = room.tunnel_port || 443;
      const tpath = room.tunnel_path || "/";
      let url = `wss://${th}${tp === 443 ? "" : ":" + tp}${tpath.startsWith("/") ? tpath : "/" + tpath}`;
      if (room.host) url += (url.includes("?") ? "&" : "?") + "ip=" + encodeURIComponent(room.host);
      return url;
    };
    const _lanUrl = () => (https ? "" : `ws://${room.host}:${this._config.ws_port}`);
    if (https) {
      const custom = _customUrl();
      if (custom) return custom;
    }
    if (mode === "lan") return _lanUrl();
    if (mode === "tunnel") return _tunnelUrl();
    return https ? _tunnelUrl() : _lanUrl();
  }

  _buildMultiRoomSpkUrl(idx) {
    const room = this._rooms[idx]; if (!room) return "";
    const mode = (this._config.mode || "auto").toLowerCase();
    const https = this._isHttps();
    const _customUrl = () => this._resolveCustomWsUrl(room.custom_speaker_ws_url || this._config.custom_speaker_ws_url || "", room.host);
    const _tunnelUrl = () => {
      const th = room.speaker_tunnel_host; if (!th) return "";
      const tp = room.speaker_tunnel_port || 443;
      const tpath = room.speaker_tunnel_path || "/";
      let url = `wss://${th}${tp === 443 ? "" : ":" + tp}${tpath.startsWith("/") ? tpath : "/" + tpath}`;
      if (room.host) url += (url.includes("?") ? "&" : "?") + "ip=" + encodeURIComponent(room.host);
      return url;
    };
    const _lanUrl = () => (https ? "" : `ws://${room.host}:${this._config.speaker_port || 8080}`);
    if (https) {
      const custom = _customUrl();
      if (custom) return custom;
    }
    if (mode === "lan") return _lanUrl();
    if (mode === "tunnel") return _tunnelUrl();
    return https ? _tunnelUrl() : _lanUrl();
  }

  _connectMultiRoom(idx, pendingCmd = null) {
    if (!this._rooms || idx === this._currentRoomIdx) return;
    const existing = this._multiWs[idx];
    if (existing) {
      if (existing.ws?.readyState === 0 || existing.ws?.readyState === 1) {
        // Đã connecting/connected — nếu có pending cmd thì gửi ngay hoặc queue
        if (pendingCmd) {
          if (existing.ws.readyState === 1) {
            existing.ws.send(JSON.stringify(pendingCmd));
          } else {
            existing._pendingCmd = pendingCmd; // sẽ gửi khi onopen
          }
        }
        return;
      }
      this._disconnectMultiRoom(idx);
    }
    const entry = { ws: null, spkWs: null, reconnectTimer: null, connected: false, pollTimer: null, _pendingCmd: pendingCmd };
    this._multiWs[idx] = entry;
    const wsUrl = this._buildMultiRoomWsUrl(idx);
    if (wsUrl) {
      try {
        const ws = new WebSocket(wsUrl);
        entry.ws = ws;
          ws.onopen = () => {
            entry.connected = true;
            entry.pollTimer = setInterval(() => {
              if (ws.readyState === 1) ws.send(JSON.stringify({ action: 'get_info' }));
            }, 5000);
            ws.send(JSON.stringify({ action: 'get_info' }));
            const cmdToSend = entry._pendingCmd || this._buildPlayCmdFromCache(this._nowPlaying);
            if (cmdToSend) {
              setTimeout(() => {
                if (ws.readyState === 1) ws.send(JSON.stringify(cmdToSend));
                entry._pendingCmd = null;
              }, 300);
            } else {
              entry._pendingCmd = null;
              // Không có play cmd → hỏi trạng thái hiện tại để cập nhật UI
              ws.send(JSON.stringify({ action: 'get_playback_state' }));
            }
            // FIX: đồng bộ volume master sang room mới
            setTimeout(() => {
              if (ws.readyState === 1) this._sendVolumeToRoom(idx, this._state.volume);
            }, 500);
            delete this._roomVolumes[idx];
            this[`_rvGuardUntil_${idx}`] = 0;
            this._toast(`🔗 ${this._rooms[idx].name} linked`, "success");
            this._renderSyncBar();
            this._renderRoomVolumeSliders();
          };
        ws.onclose = () => {
          entry.connected = false;
          if (entry.pollTimer) { clearInterval(entry.pollTimer); entry.pollTimer = null; }
          this._renderSyncBar();
          this._renderRoomVolumeSliders();
          if (this._syncRoomIdxs.has(idx) && !this._switching && !this._cardCollapsed) {
            const jitter = 3000 + Math.random() * 3000;
            entry.reconnectTimer = setTimeout(() => {
              delete this._multiWs[idx];
              if (this._syncRoomIdxs.has(idx)) this._connectMultiRoom(idx);
            }, jitter);
          }
        };
        ws.onerror = () => {};
        ws.onmessage = (ev) => {
          try {
            const d = JSON.parse(ev.data);
            // ── Volume ────────────────────────────────────────────
            const vol = (() => {
              if (d.type === "volume_state" && d.volume !== undefined) return Number(d.volume);
              if (d.type === "get_info" && d.data) {
                const v = d.data.vol !== undefined ? d.data.vol : d.data.volume;
                if (v !== undefined) return Number(v);
              }
              if (d.type === "playback_state" && d.volume !== undefined) return Number(d.volume);
              if (d.vol !== undefined) return Number(d.vol);
              if (d.volume !== undefined) return Number(d.volume);
              return null;
            })();
            if (vol !== null && vol !== this._roomVolumes[idx]) {
              if (this[`_rvGuardUntil_${idx}`] && Date.now() < this[`_rvGuardUntil_${idx}`]) return;
              this._roomVolumes[idx] = vol;
              const sl = this.querySelector(`.room-vol-slider[data-rvidx="${idx}"]`);
              if (sl) {
                sl.value = vol;
                const lbl = this.querySelector(`#rvl_${idx}`);
                if (lbl) lbl.textContent = vol;
              }
            }
            // ── playback_state: lưu cache để hiển thị trên sync badge ──
            if (d.type === "playback_state" && d.title) {
              if (!this._roomPlayback) this._roomPlayback = {};
              this._roomPlayback[idx] = {
                title: d.title || "",
                artist: d.artist || d.channel || "",
                thumb: d.thumbnail_url || "",
                isPlaying: !!d.is_playing,
                source: d.source || "youtube",
              };
              // Cập nhật tooltip trên badge phòng
              const badge = this.querySelector(`.sync-room-badge[data-srbidx="${idx}"]`);
              if (badge && d.title) badge.title = d.title;
            }
          } catch(_) {}
        };
      } catch(_) {}
    }
    const spkUrl = this._buildMultiRoomSpkUrl(idx);
    if (spkUrl) {
      try {
        const spkWs = new WebSocket(spkUrl);
        entry.spkWs = spkWs;
        const attachSpkHandlers = (ws) => {
          ws.onopen = () => {
            if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'get_info' }));
          };
          ws.onerror = () => {};
          ws.onmessage = (ev) => {
            try {
              const d = JSON.parse(ev.data);
              let s = d;
              if (typeof d.data === "string") { try { s = JSON.parse(d.data); } catch { s = d; } }
              else if (d.data) { s = d.data; }
              const vol = s.vol !== undefined ? Number(s.vol) : null;
              if (vol !== null && vol !== this._roomVolumes[idx]) {
                if (this[`_rvGuardUntil_${idx}`] && Date.now() < this[`_rvGuardUntil_${idx}`]) return;
                this._roomVolumes[idx] = vol;
                const sl = this.querySelector(`.room-vol-slider[data-rvidx="${idx}"]`);
                if (sl) {
                  sl.value = vol;
                  const lbl = this.querySelector(`#rvl_${idx}`);
                  if (lbl) lbl.textContent = vol;
                }
              }

            } catch(_) {}
          };
          ws.onclose = () => {
            if (entry.spkWs === ws) entry.spkWs = null;
            if (this._syncRoomIdxs.has(idx) && !this._switching && !this._cardCollapsed) {
              const jitter = 3500 + Math.random() * 2500;
              entry.spkReconnectTimer = setTimeout(() => {
                entry.spkReconnectTimer = null;
                if (!this._syncRoomIdxs.has(idx) || this._switching || this._cardCollapsed) return;
                const newSpkUrl = this._buildMultiRoomSpkUrl(idx);
                if (!newSpkUrl) return;
                try { const newSpk = new WebSocket(newSpkUrl); entry.spkWs = newSpk; attachSpkHandlers(newSpk); } catch(_) {}
              }, jitter);
            }
          };
        };
        attachSpkHandlers(spkWs);
        spkWs.onerror = () => {};
      } catch(_) {}
    }
    this._renderSyncBar();
    this._renderRoomVolumeSliders();
  }

  _disconnectMultiRoom(idx) {
    const entry = this._multiWs[idx]; if (!entry) return;
    clearTimeout(entry.reconnectTimer);
    clearTimeout(entry.spkReconnectTimer);
    if (entry.pollTimer) { clearInterval(entry.pollTimer); entry.pollTimer = null; }
    try { if (entry.ws) { entry.ws.onclose = null; entry.ws.onerror = null; entry.ws.onmessage = null; entry.ws.close(); } } catch(_) {}
    try { if (entry.spkWs) { entry.spkWs.onclose = null; entry.spkWs.onerror = null; entry.spkWs.close(); } } catch(_) {}
    delete this._multiWs[idx];
  }

  _disconnectAllMulti() {
    Object.keys(this._multiWs).forEach(idx => this._disconnectMultiRoom(parseInt(idx)));
  }

  _getSyncTargets() {
    if (!this._rooms) return [];
    return Array.from(this._syncRoomIdxs).filter(i => i !== this._currentRoomIdx);
  }

  _sendToRoom(idx, obj) {
    const entry = this._multiWs[idx];
    if (entry?.ws?.readyState === 1) entry.ws.send(JSON.stringify(obj));
  }

  _sendSpkToRoom(idx, obj) {
    const entry = this._multiWs[idx];
    if (entry?.spkWs?.readyState === 1) entry.spkWs.send(JSON.stringify(obj));
    else this._sendToRoom(idx, obj);
  }

  _broadcastCmd(obj) {
    if (this._ws?.readyState === 1) {
      this._ws.send(JSON.stringify(obj));
    }
    const a = obj?.action;
    const targets = this._getSyncTargets();
    if (a === "play_song" || a === "play_zing" || a === "play_url" || a === "playlist_play") {
      // Direct play: đánh dấu broadcast, gửi tuần tự cách 300ms
      this._pendingRoomCmd = "broadcast";
      this._pendingNextTitle = null;
      targets.forEach((idx, i) => {
        setTimeout(() => {
          if (this._switching) return;
          this._sendToRoom(idx, obj);
        }, i * 300);
      });
    } else {
      // Các lệnh khác (pause/resume/seek/stop): gửi đồng thời
      targets.forEach(idx => this._sendToRoom(idx, obj));
    }
  }

  _broadcastSpkCmd(obj) {
    this._sendSpk(obj);
    this._getSyncTargets().forEach(idx => this._sendSpkToRoom(idx, obj));
  }

  _sendVolumeToRoom(idx, vol) {
    if (idx === this._currentRoomIdx) {
      this._sendVolume(vol);
      return;
    }
    const entry = this._multiWs[idx];
    if (!entry) return;
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

  // ════════════════════════════════════════════════════════════════════
  // MULTIROOM – Next/Prev
  // ════════════════════════════════════════════════════════════════════


  _triggerMasterNext() {
    this._pendingRoomCmd = "next";
    this._pendingNextTitle = null;
    this._pendingBroadcastNextSong = false;
    clearTimeout(this._pendingBroadcastTimer);
    this._pendingBroadcastTimer = null;
    // Stop rooms ngay để tránh phát nhầm bài cũ
    this._getSyncTargets().forEach(idx => this._sendToRoom(idx, { action: "stop" }));
    this._send({ action: "next" });
    this._sendSpk({ type: 'send_message', what: 65536, arg1: 0, arg2: 1, obj: 'next' });
  }

  _triggerMasterPrev() {
    this._pendingRoomCmd = "prev";
    this._pendingNextTitle = null;
    this._pendingBroadcastNextSong = false;
    clearTimeout(this._pendingBroadcastTimer);
    this._pendingBroadcastTimer = null;
    // Stop rooms ngay để tránh phát nhầm bài cũ
    this._getSyncTargets().forEach(idx => this._sendToRoom(idx, { action: "stop" }));
    this._send({ action: "prev" });
    this._sendSpk({ type: 'send_message', what: 65536, arg1: 0, arg2: 1, obj: 'pre' });
  }

  // ════════════════════════════════════════════════════════════════════
  // SYNC PLAYBACK
  // ════════════════════════════════════════════════════════════════════

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
        if (aborted()) {
          if (wasPlaying) {
            this._broadcastCmd({ action: "resume" });
            this._startProgressTick();
          }
          this._syncInProgress = false;
          return;
        }
        if (!wasPlaying) {
          if (!silent) this._toast(`✅ Sync xong ${this._fmtTime(pos)} → ${roomNames}`, "success");
          this._syncInProgress = false;
          this._renderSyncBar();
          return;
        }
        this._syncSuppressUntil = Date.now() + 8000;
        this._broadcastCmd({ action: "resume" });
        this._startProgressTick();
        this._volSyncGuardUntil = Date.now() + 3000;
        this._posSyncGuardUntil = Date.now() + 2000;
        if (!silent) this._toast(`✅ Sync xong → ${roomNames}`, "success");
        this._syncInProgress = false;
        this._renderSyncBar();

        setTimeout(() => {
          if (aborted()) return;
          this._closeSpkWs();
          setTimeout(() => { if (!aborted()) this._connectSpkWs(); }, 400);

          targets.forEach(idx => {
            const ent = this._multiWs[idx]; if (!ent) return;
            try {
              if (ent.spkWs) {
                ent.spkWs.onclose = null; ent.spkWs.onerror = null;
                ent.spkWs.close(); ent.spkWs = null;
              }
            } catch(_) {}
            setTimeout(() => {
              if (!this._syncRoomIdxs.has(idx) || this._switching) return;
              const entry = this._multiWs[idx]; if (!entry) return;
              if (entry.spkWs) return;
              const spkUrl = this._buildMultiRoomSpkUrl(idx); if (!spkUrl) return;
              const attachSpkHandlers = (ws) => {
                ws.onopen = () => {
                  if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'get_info' }));
                };
                ws.onerror = () => {};
                ws.onmessage = (ev) => {
                  try {
                    const d = JSON.parse(ev.data);
                    let s = d;
                    if (typeof d.data === "string") { try { s = JSON.parse(d.data); } catch { s = d; } }
                    else if (d.data) { s = d.data; }
                    const vol = s.vol !== undefined ? Number(s.vol) : null;

                    if (vol !== null && vol !== this._roomVolumes[idx]) {
                      if (this[`_rvGuardUntil_${idx}`] && Date.now() < this[`_rvGuardUntil_${idx}`]) return;
                      this._roomVolumes[idx] = vol;
                      const sl = this.querySelector(`.room-vol-slider[data-rvidx="${idx}"]`);
                      if (sl) {
                        sl.value = vol;
                        const lbl = this.querySelector(`#rvl_${idx}`);
                        if (lbl) lbl.textContent = vol;
                      }
                    }
                    
                  } catch(_) {}
                };
                ws.onclose = () => {
                  if (entry.spkWs === ws) entry.spkWs = null;
                  if (this._syncRoomIdxs.has(idx) && !this._switching && !this._cardCollapsed) {
                    entry.spkReconnectTimer = setTimeout(() => {
                      entry.spkReconnectTimer = null;
                      if (!this._syncRoomIdxs.has(idx) || this._switching || this._cardCollapsed) return;
                      const url2 = this._buildMultiRoomSpkUrl(idx); if (!url2) return;
                      try { const newSpk = new WebSocket(url2); entry.spkWs = newSpk; attachSpkHandlers(newSpk); } catch(_) {}
                    }, 3500 + Math.random() * 2500);
                  }
                };
              };
              try { const spkWs = new WebSocket(spkUrl); entry.spkWs = spkWs; attachSpkHandlers(spkWs); } catch(_) {}
            }, 500);
          });
        }, 800);
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
    if (!this._rooms || this._rooms.length < 2 || this._getSyncTargets().length === 0) {
      bar.style.display = "none"; return;
    }
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
            return `<span class="sync-room-badge ${ok ? 'ok' : 'pending'}" data-srbidx="${idx}" title="${this._esc(songTip)}">
              ${this._esc(this._rooms[idx].name)}${rp?.isPlaying ? ' ▶' : ''}
            </span>`;
          }).join('')}
        </div>
        <div class="sync-bar-right">
          <button class="sync-btn${this._syncInProgress ? ' sync-btn-busy' : ''}" id="btnSyncNow"
            title="Pause → Seek → Resume đồng loạt"
            ${this._syncInProgress ? 'disabled' : ''}>
            ${this._syncInProgress ? '⌛ Syncing...' : '⏱ Sync Now'}
          </button>
          <button class="sync-btn ${this._autoSync ? 'sync-auto-on' : ''}" id="btnAutoSync"
            title="Tự sync 1 lần/bài sau khi bắt đầu phát">
            ${this._autoSync ? '🔄 Auto ON' : '🔄 Auto'}
          </button>
          <button class="sync-btn" id="btnSyncSettings" title="Cài đặt thời gian sync">⚙</button>
        </div>
      </div>
      <div id="syncSettingsPanel" class="${this._syncSettingsOpen ? '' : 'hidden'}" style="border-top:1px solid rgba(139,92,246,.15);margin-top:6px;padding-top:8px">
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <div style="flex:1;min-width:120px">
            <div style="font-size:9px;color:rgba(226,232,240,.45);margin-bottom:3px">⏳ Chờ trước auto-sync</div>
            <div style="display:flex;align-items:center;gap:5px">
              <input type="range" id="slAutoDelay" min="1000" max="15000" step="500"
                value="${this._config.auto_sync_delay_ms}"
                style="flex:1;height:4px" />
              <span id="autoDelayVal" style="font-size:10px;color:#a78bfa;min-width:32px;text-align:right">${(this._config.auto_sync_delay_ms/1000).toFixed(1)}s</span>
            </div>
          </div>
          <div style="flex:1;min-width:120px">
            <div style="font-size:9px;color:rgba(226,232,240,.45);margin-bottom:3px">⏸ Pause settle</div>
            <div style="display:flex;align-items:center;gap:5px">
              <input type="range" id="slPauseMs" min="100" max="2000" step="100"
                value="${this._config.sync_pause_ms}"
                style="flex:1;height:4px" />
              <span id="pauseMsVal" style="font-size:10px;color:#a78bfa;min-width:32px;text-align:right">${this._config.sync_pause_ms}ms</span>
            </div>
          </div>
          <div style="flex:1;min-width:120px">
            <div style="font-size:9px;color:rgba(226,232,240,.45);margin-bottom:3px">▶ Resume delay</div>
            <div style="display:flex;align-items:center;gap:5px">
              <input type="range" id="slResumeDelay" min="500" max="8000" step="500"
                value="${this._config.sync_resume_delay_ms}"
                style="flex:1;height:4px" />
              <span id="resumeDelayVal" style="font-size:10px;color:#a78bfa;min-width:32px;text-align:right">${(this._config.sync_resume_delay_ms/1000).toFixed(1)}s</span>
            </div>
          </div>
        </div>
        <div style="font-size:9px;color:rgba(226,232,240,.3);margin-top:5px">
          Auto-sync: chờ <b style="color:#a78bfa">${(this._config.auto_sync_delay_ms/1000).toFixed(1)}s</b> rồi pause <b style="color:#a78bfa">${this._config.sync_pause_ms}ms</b> → seek → resume sau <b style="color:#a78bfa">${(this._config.sync_resume_delay_ms/1000).toFixed(1)}s</b>
        </div>
      </div>`;
    const syncNow = bar.querySelector("#btnSyncNow");
    if (syncNow) syncNow.onclick = () => this._syncPlaybackTime(false);
    const autoBtn = bar.querySelector("#btnAutoSync");
    if (autoBtn) autoBtn.onclick = () => this._toggleAutoSync();
    const settingsBtn = bar.querySelector("#btnSyncSettings");
    if (settingsBtn) settingsBtn.onclick = () => {
      this._syncSettingsOpen = !this._syncSettingsOpen;
      this._renderSyncBar();
    };
    // Sliders
    const slAutoDelay = bar.querySelector("#slAutoDelay");
    if (slAutoDelay) {
      slAutoDelay.oninput = () => {
        this._config.auto_sync_delay_ms = parseInt(slAutoDelay.value);
        const v = bar.querySelector("#autoDelayVal"); if (v) v.textContent = (this._config.auto_sync_delay_ms/1000).toFixed(1) + "s";
        this._updateSyncSummary(bar);
      };
    }
    const slPauseMs = bar.querySelector("#slPauseMs");
    if (slPauseMs) {
      slPauseMs.oninput = () => {
        this._config.sync_pause_ms = parseInt(slPauseMs.value);
        const v = bar.querySelector("#pauseMsVal"); if (v) v.textContent = this._config.sync_pause_ms + "ms";
        this._updateSyncSummary(bar);
      };
    }
    const slResumeDelay = bar.querySelector("#slResumeDelay");
    if (slResumeDelay) {
      slResumeDelay.oninput = () => {
        this._config.sync_resume_delay_ms = parseInt(slResumeDelay.value);
        const v = bar.querySelector("#resumeDelayVal"); if (v) v.textContent = (this._config.sync_resume_delay_ms/1000).toFixed(1) + "s";
        this._updateSyncSummary(bar);
      };
    }
    bar.style.display = "";
  }

  _updateSyncSummary(bar) {
    const el = bar.querySelector("#syncSettingsPanel div:last-child");
    if (el) el.innerHTML = `Auto-sync: chờ <b style="color:#a78bfa">${(this._config.auto_sync_delay_ms/1000).toFixed(1)}s</b> rồi pause <b style="color:#a78bfa">${this._config.sync_pause_ms}ms</b> → seek → resume sau <b style="color:#a78bfa">${(this._config.sync_resume_delay_ms/1000).toFixed(1)}s</b>`;
  }

  _renderRoomVolumeSliders() {
    const container = this.querySelector("#roomVolumes"); if (!container) return;
    if (!this._rooms || this._rooms.length < 2 || this._getSyncTargets().length === 0) {
      container.style.display = "none"; return;
    }
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
        <input type="range" class="room-vol-slider" min="0" max="15" value="${vol}"
          data-rvidx="${idx}" style="--rv-color:${color}" />
        <span class="room-vol-label" id="rvl_${idx}">${vol}</span>
      </div>`;
    }).join('');
    container.querySelectorAll(".room-vol-slider").forEach(sl => {
      sl.oninput = () => {
        const ridx = parseInt(sl.dataset.rvidx);
        const v = parseInt(sl.value);
        const lbl = container.querySelector(`#rvl_${ridx}`); if (lbl) lbl.textContent = v;
        if (ridx === this._currentRoomIdx) {
          this._state.volume = v;
          this._volDragging = true;
          clearTimeout(this._volSendTimer);
          this._volSendTimer = setTimeout(() => this._broadcastVolume(v), 100);
          clearTimeout(this._volLockTimer);
          this._volLockTimer = setTimeout(() => { this._volDragging = false; }, 2000);
        } else {
          this._roomVolumes[ridx] = v;
          clearTimeout(this[`_rvTimer_${ridx}`]);
          this[`_rvTimer_${ridx}`] = setTimeout(() => {
            this[`_rvTimer_${ridx}`] = null;
            this._sendVolumeToRoom(ridx, v);
          }, 100);
        }
      };
      sl.onchange = () => {
        const ridx = parseInt(sl.dataset.rvidx);
        const v = parseInt(sl.value);
        if (ridx === this._currentRoomIdx) {
          this._state.volume = v;
          this._broadcastVolume(v);
          clearTimeout(this._volLockTimer);
          this._volLockTimer = setTimeout(() => { this._volDragging = false; }, 2000);
        } else {
          this._roomVolumes[ridx] = v;
          clearTimeout(this[`_rvTimer_${ridx}`]);
          this[`_rvTimer_${ridx}`] = null;
          this._sendVolumeToRoom(ridx, v);
        }
      };
    });
  }

  _renderRoomPills() {
    const bar = this.querySelector("#roomBar"); if (!bar || !this._rooms) return;
    bar.querySelectorAll(".room-pill").forEach((pill, i) => {
      pill.classList.toggle("active", i === (this._currentRoomIdx || 0));
    });
    bar.querySelectorAll(".sync-cb").forEach(cb => {
      const idx = parseInt(cb.dataset.sidx);
      cb.checked = this._syncRoomIdxs.has(idx);
    });
    this._updateRoomPillState();
  }

  // ════════════════════════════════════════════════════════════════════
  // CARD COLLAPSE
  // ════════════════════════════════════════════════════════════════════

  _toggleCardCollapse() {
    this._cardCollapsed = !this._cardCollapsed;
    const body = this.querySelector("#cardBody");
    const btn = this.querySelector("#btnCollapseCard");
    if (body) body.style.display = this._cardCollapsed ? "none" : "";
    if (btn) btn.textContent = this._cardCollapsed ? "▼" : "▲";
    if (this._cardCollapsed) {
      this._stopTabServices();
      clearTimeout(this._autoSyncTimer);
      this._disconnectAllMulti();
      this._closeSpkWs();
      this._toast("⏸ Card tắt — đã dừng đồng bộ", "");
    } else {
      if (this._wsConnected) {
        this._loadTab(this._activeTab);
        this._connectSpkWs();
        this._syncRoomIdxs.forEach(sidx => {
          if (sidx !== this._currentRoomIdx) this._connectMultiRoom(sidx);
        });
        this._renderSyncBar();
        this._renderRoomVolumeSliders();
      } else {
        this._connectWsAuto();
      }
      this._toast("▶ Card bật — đồng bộ đã khởi động lại", "success");
    }
  }

  set hass(h) { this._hass = h; if (!this._inited) { this._inited = true; this._render(); this._bind(); this._connectWsAuto(); } }

  connectedCallback() {
    if (this._inited) this._connectWsAuto();
    if (!this._visHandler) {
      this._visHandler = () => {
        if (!document.hidden && this._wsConnected && this._state.media.isPlaying && !this._cardCollapsed) {
          this._send({ action: 'get_playback_state' });
          this._send({ action: 'playback_info' });
        }
      };
      document.addEventListener('visibilitychange', this._visHandler);
    }
  }

  disconnectedCallback() {
    this._closeWs(); this._stopTabServices(); this._disconnectAllMulti();
    clearTimeout(this._autoSyncTimer); this._autoSyncTimer = null;
    clearTimeout(this._volSendTimer); this._volSendTimer = null;
    clearTimeout(this._volLockTimer); this._volLockTimer = null;
    clearTimeout(this._toastTimer); this._toastTimer = null;
    this._clearAllRoomVolTimers();
    clearTimeout(this._pendingBroadcastTimer); this._pendingBroadcastTimer = null;
    this._pendingNextTitle = null;
    this._syncInProgress = false; this._syncGen++;
    if (this._visHandler) { document.removeEventListener('visibilitychange', this._visHandler); this._visHandler = null; }
  }

  getCardSize() { return 9; }

  _isHttps() { return window.location.protocol === "https:"; }
  _resolveCustomWsUrl(raw, targetHost = this._host) {
    const s = String(raw || "").trim();
    if (!s) return "";
    const host = targetHost || "";
    let out = s.replaceAll("{ip}", encodeURIComponent(host)).replaceAll("{host}", encodeURIComponent(host));
    if (out.startsWith("/")) {
      const scheme = this._isHttps() ? "wss" : "ws";
      out = `${scheme}://${window.location.host}${out}`;
    }
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
      if (https) {
        const c = this._customWsUrl(); if (c) list.push({ url: c, label: "CUSTOM WSS" });
        const t = this._tunnelWsUrl(); if (t) list.push({ url: t, label: "TUNNEL WSS" });
        if (!c && !t) this._toast("HTTPS: cần cấu hình custom_ws_url hoặc tunnel_host", "error");
      } else { list.push({ url: this._lanWsUrl(), label: "LAN WS" }); }
    } else if (mode === "tunnel") {
      const t = this._tunnelWsUrl(); if (t) list.push({ url: t, label: "TUNNEL WSS" });
    } else {
      if (https) {
        const c = this._customWsUrl(); if (c) list.push({ url: c, label: "CUSTOM WSS" });
        const t = this._tunnelWsUrl(); if (t) list.push({ url: t, label: "TUNNEL WSS" });
      }
      else { list.push({ url: this._lanWsUrl(), label: "LAN WS" }); }
    }
    return list;
  }

  _connectWsAuto() {
    if (this._switching || this._cardCollapsed) return;
    if (this._ws && (this._ws.readyState === 0 || this._ws.readyState === 1)) return;
    clearTimeout(this._reconnectTimer);
    const candidates = this._buildCandidates();
    if (!candidates.length) {
      this._wsConnected = false; this._setConnDot(false);
      this._setOffline(true, 0, 1, 1);
      this._toast(this._isHttps() ? "HTTPS: cần cấu hình custom_ws_url hoặc tunnel_host" : "Chưa có host", "error"); return;
    }
    this._doTry(candidates, 0, 1);
  }

  _doTry(candidates, idx, attempt) {
    const MAX_PER_URL = 3;
    clearTimeout(this._reconnectTimer);
    if (this._switching || this._cardCollapsed) return;
    if (this._ws && (this._ws.readyState === 0 || this._ws.readyState === 1)) return;
    const c = candidates[idx];
    const total = candidates.length * MAX_PER_URL;
    const doneSoFar = idx * MAX_PER_URL + (attempt - 1);
    this._setOffline(true, this._config.reconnect_ms, doneSoFar, total);
    this._tryOnce(c.url, c.label).then(ok => {
      if (ok) return;
      const newDone = doneSoFar + 1;
      if (attempt < MAX_PER_URL) {
        this._toast(`${c.label} lần ${attempt}/${MAX_PER_URL} thất bại`, "error");
        this._setOffline(true, this._config.reconnect_ms, newDone, total);
        this._reconnectTimer = setTimeout(() => this._doTry(candidates, idx, attempt + 1), this._config.reconnect_ms);
      } else if (idx + 1 < candidates.length) {
        const nextLabel = candidates[idx + 1].label;
        this._toast(`${c.label} hết lượt → thử ${nextLabel}`, "error");
        this._setOffline(true, this._config.reconnect_ms, newDone, total);
        this._reconnectTimer = setTimeout(() => this._doTry(candidates, idx + 1, 1), this._config.reconnect_ms);
      } else {
        this._wsConnected = false; this._setConnDot(false); this._setConnText("WS");
        this._toast("Thiết bị offline!", "error");
        this._setOffline(true, 0, newDone, total);
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
      this._connectTimeout = setTimeout(() => {
        if (!connected) {
          try { ws.close(); } catch(_) {}
          finish(false);
          if (this._isHttps()) {
            this._setOffline(true, this._config.reconnect_ms, 1, 3);
          }
        }
      }, this._config.connect_timeout_ms);
      ws.onopen = () => {
        if (this._host !== capturedHost || this._switching) { try { ws.close(); } catch(_) {} finish(false); return; }
        connected = true; this._dropCount = 0; this._wsConnected = true;
        if (this._syncInProgress) { this._syncInProgress = false; this._syncGen++; }
        this._chatLoaded = false; this._setConnDot(true); this._setConnText(label);
        this._setOffline(false); this._toast("Đã kết nối: " + label, "success");
        this._requestInitial(); finish(true);
      };
      ws.onclose = () => {
        if (!connected) { this._ws = null; finish(false); }
        else {
          if (this._switching) return;
          this._wsConnected = false; this._setConnDot(false); this._setConnText("WS");
          if (this._syncInProgress) { this._syncInProgress = false; this._syncGen++; this._renderSyncBar(); }
          this._stopTabServices(); clearTimeout(this._reconnectTimer);
          const MAX_DROP = 3; this._dropCount = (this._dropCount || 0) + 1;
          if (this._dropCount >= MAX_DROP) {
            this._dropCount = 0; this._toast("Thiết bị offline sau " + MAX_DROP + " lần drop!", "error");
            this._setOffline(true, 0, MAX_DROP, MAX_DROP);
          } else {
            this._toast(`Drop ${this._dropCount}/${MAX_DROP} — thử lại...`, "error");
            this._setOffline(true, this._config.reconnect_ms, this._dropCount, MAX_DROP);
            if (!this._cardCollapsed) this._reconnectTimer = setTimeout(() => this._connectWsAuto(), this._config.reconnect_ms);
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
    this._stopTabServices(); this._stopWaveform();
    if (this._ws) {
      try { this._ws.onclose = null; } catch(_) {}
      try { this._ws.onerror = null; } catch(_) {}
      try { this._ws.onmessage = null; } catch(_) {}
      try { this._ws.close(); } catch(_) {}
      this._ws = null;
    }
    this._wsConnected = false; this._setConnDot(false);
    this._closeSpkWs();
  }

  _send(obj) {
    if (this._ws?.readyState === 1) this._ws.send(JSON.stringify(obj));
    // Bộ nhớ tạm: đánh dấu khi user nhấn next/prev → chờ lấy thông tin bài rồi gửi sang rooms
    const a = obj?.action;
    if (a === "next" || a === "prev") {
      this._pendingRoomCmd = a; // lưu "next" hoặc "prev" làm marker
    }
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
    if (this._switching || this._cardCollapsed) return;
    if (this._spkWs && (this._spkWs.readyState === 0 || this._spkWs.readyState === 1)) return;
    const https = this._isHttps(); let url;
    if (https) {
      url = this._customSpkWsUrl() || this._spkTunnelWsUrl();
      if (!url) return;
    }
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
        if (!this._switching && !this._cardCollapsed && this._host === capturedHost) {
          this._spkReconnect = setTimeout(() => this._connectSpkWs(), 3000);
        }
      };
      this._spkWs.onerror = () => {};
    } catch(_) {}
  }

  _closeSpkWs() {
    this._stopSpkHeartbeat(); clearTimeout(this._spkReconnect); this._spkReconnect = null;
    if (this._spkWs) {
      try { this._spkWs.onclose = null; } catch(_) {}
      try { this._spkWs.onerror = null; } catch(_) {}
      try { this._spkWs.onmessage = null; } catch(_) {}
      try { this._spkWs.close(); } catch(_) {}
      this._spkWs = null;
    }
  }

  _startSpkHeartbeat() {
    this._stopSpkHeartbeat();
    if (this._spkWs?.readyState === 1) {
      this._spkWs.send(JSON.stringify({ type: 'get_info' }));
      this._spkWs.send(JSON.stringify({ type: 'get_eq_config' }));
    }
    this._spkHb = setInterval(() => {
      if (this._cardCollapsed) return;
      if (this._spkWs?.readyState === 1) this._spkWs.send(JSON.stringify({ type: 'get_info' }));
    }, 2000);
    this._spkEqHb = setInterval(() => {
      if (this._cardCollapsed) return;
      if (this._spkWs?.readyState === 1) {
        this._spkWs.send(JSON.stringify({ type: 'get_eq_config' }));
        this._spkWs.send(JSON.stringify({ type: 'get_device_info' }));
      }
    }, 3000);
  }

  _stopSpkHeartbeat() {
    if (this._spkHb) { clearInterval(this._spkHb); this._spkHb = null; }
    if (this._spkEqHb) { clearInterval(this._spkEqHb); this._spkEqHb = null; }
  }

  _sendSpk(obj) {
    if (this._spkWs?.readyState === 1) { this._spkWs.send(JSON.stringify(obj)); }
    else { this._send(obj); }
  }

  _sendSpkMsg(arg1, arg2, obj) {
    const d = { type: 'send_message', what: 4, arg1, arg2 };
    if (obj !== undefined) d.obj = String(obj);
    this._sendSpk(d);
  }

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
      this[`_rvGuardUntil_${idx}`] = Date.now() + 3000; // ← THÊM DÒNG NÀY
      const sl = this.querySelector(`.room-vol-slider[data-rvidx="${idx}"]`);
      if (sl) sl.value = vol;
      const lbl = this.querySelector(`#rvl_${idx}`);
      if (lbl) lbl.textContent = vol;
    });
  }

  _handleSpkMsg(raw) {
    let d; try { d = JSON.parse(raw); } catch { return; }
    let s;
    if (typeof d.data === "string") { try { s = JSON.parse(d.data); } catch { s = d; } } else { s = d.data || d; }
    if (!this._volDragging && !(this._volSyncGuardUntil && Date.now() < this._volSyncGuardUntil)) {
      const vol = s.vol !== undefined ? Number(s.vol) : null;
      if (vol !== null && vol !== this._state.volume) {
        this._state.volume = vol;
        this._renderVolume();
        const masterSlider = this.querySelector(`.room-vol-slider[data-rvidx="${this._currentRoomIdx}"]`);
        if (masterSlider) { masterSlider.value = vol; const lbl = this.querySelector(`#rvl_${this._currentRoomIdx}`); if (lbl) lbl.textContent = vol; }
      }
    }
    const ctrlOk = Date.now() - this._ctrlGuard > 3000;
    if (ctrlOk) {
      if (s.dlna_open !== undefined) this._state.dlnaOpen = !!s.dlna_open;
      if (s.airplay_open !== undefined) this._state.airplayOpen = !!s.airplay_open;
      if (s.device_state !== undefined) this._state.bluetoothOn = (s.device_state === 3);
      if (s.music_light_enable !== undefined) this._state.lightEnabled = !!s.music_light_enable;
      if (s.music_light_luma !== undefined) this._state.brightness = Math.max(1, Math.min(200, Math.round(s.music_light_luma)));
      if (s.music_light_chroma !== undefined) this._state.speed = Math.max(1, Math.min(100, Math.round(s.music_light_chroma)));
      if (s.music_light_mode !== undefined) this._state.lightMode = s.music_light_mode;
      this._renderControlToggles(); this._renderLight();
    }
    const isEqResponse = d.type === "get_eq_config" || d.code === 200;
    const audioOk = isEqResponse || (Date.now() - this._audioGuard > 3000);
    if (audioOk) {
      if (s.eq) {
        const eqEn = s.eq.Eq_Enable !== undefined ? s.eq.Eq_Enable : s.eq.sound_effects_eq_enable;
        if (eqEn !== undefined) { this._state.eqEnabled = !!eqEn; this._updateSwitch("#swEq", this._state.eqEnabled); }
        if (s.eq.Bands?.list) {
          s.eq.Bands.list.forEach((b, i) => { const lv = b.BandLevel ?? 0; this._state.eqBands[i] = lv; const inp = this.querySelector(`input[data-band="${i}"]`); if (inp) inp.value = lv; });
          this._renderEqBands();
        }
      }
      if (s.bass) {
        const bassEn = s.bass.Bass_Enable ?? s.bass.sound_effects_bass_enable;
        if (bassEn !== undefined) { this._state.bass.enabled = !!bassEn; this._updateSwitch("#swBass", this._state.bass.enabled); }
        if (s.bass.Current_Strength !== undefined) {
          this._state.bass.strength = s.bass.Current_Strength;
          const bs = this.querySelector("#bassSlider"); if (bs) bs.value = s.bass.Current_Strength;
          const bv = this.querySelector("#bassVal"); if (bv) bv.textContent = Math.round(s.bass.Current_Strength / 10) + "%";
        }
      }
      if (s.loudness) {
        const loudEn = s.loudness.Loudness_Enable ?? s.loudness.sound_effects_loudness_enable;
        if (loudEn !== undefined) { this._state.loudness.enabled = !!loudEn; this._updateSwitch("#swLoud", this._state.loudness.enabled); }
        if (s.loudness.Current_Gain !== undefined) {
          const g = Math.round(s.loudness.Current_Gain); this._state.loudness.gain = g;
          const ls = this.querySelector("#loudSlider"); if (ls) ls.value = g;
          const lv = this.querySelector("#loudVal"); if (lv) lv.textContent = (g / 100).toFixed(1) + " dB";
        }
      }
      if (s.Mixer) {
        const bvRaw = s.Mixer['DAC Digital Volume L'];
        if (bvRaw !== undefined) { const v = parseInt(bvRaw, 10); this._state.bassVol = v; const bvs = this.querySelector("#bvSlider"); if (bvs) bvs.value = v; const bvl = this.querySelector("#bvVal"); if (bvl) bvl.textContent = this._dbStr(v); }
        const hvRaw = s.Mixer['DAC Digital Volume R'];
        if (hvRaw !== undefined) { const v = parseInt(hvRaw, 10); this._state.highVol = v; const hvs = this.querySelector("#hvSlider"); if (hvs) hvs.value = v; const hvl = this.querySelector("#hvVal"); if (hvl) hvl.textContent = this._dbStr(v); }
      }
    }
    if (d.type === "get_device_info") {
      const dd = typeof d.data === "string" ? (() => { try { return JSON.parse(d.data); } catch { return {}; } })() : (d.data || {});
      if (Array.isArray(dd.cpuinfo) && dd.cpuinfo.length > 2) this._state.sys.cpu = Math.round(dd.cpuinfo[2] * 100 * 10) / 10;
      if (typeof dd.meminfo === "string") {
        const mTotal = (dd.meminfo.match(/MemTotal:\s+(\d+)/) || [])[1]; const mFree = (dd.meminfo.match(/MemFree:\s+(\d+)/) || [])[1];
        const mBuf = (dd.meminfo.match(/Buffers:\s+(\d+)/) || [])[1]; const mCach = (dd.meminfo.match(/\bCached:\s+(\d+)/) || [])[1];
        if (mTotal && mFree) { const used = parseInt(mTotal) - parseInt(mFree) - (parseInt(mBuf)||0) - (parseInt(mCach)||0); this._state.sys.ram = Math.round(used / parseInt(mTotal) * 100); }
      }
      this._renderSystem();
    }
  }

  _requestInitial() {
    if (!this._wsConnected || this._cardCollapsed) return;
    if (!this._spkWs || this._spkWs.readyState > 1) { this._connectSpkWs(); } else { this._startSpkHeartbeat(); }
    if (this._syncRoomIdxs.size > 0) {
      this._syncRoomIdxs.forEach(sidx => {
        if (sidx !== this._currentRoomIdx) this._connectMultiRoom(sidx);
      });
      setTimeout(() => { this._renderSyncBar(); this._renderRoomVolumeSliders(); }, 300);
    }
    this._loadTab(this._activeTab, true);
  }

  _loadTab(tab, isFirst = false) {
    if (this._cardCollapsed) return;
    this._stopTabServices();
    if (tab === 'media') {
      this._send({ action: 'get_info' }); this._startProgressTick(); this._startWaveform();
    } else if (tab === 'control') {
      this._send({ action: 'get_info' }); this._send({ action: 'alarm_list' }); this._send({ action: 'led_get_state' });
      this._send({ action: 'wake_word_get_enabled' }); this._send({ action: 'wake_word_get_sensitivity' });
      this._send({ action: 'custom_ai_get_enabled' }); this._send({ action: 'voice_id_get' }); this._send({ action: 'live2d_get_model' });
      this._ctrlPoll = setInterval(() => {
        if (this._cardCollapsed) return;
        this._send({ action: 'led_get_state' }); this._send({ action: 'get_info' });
      }, 5000);
    } else if (tab === 'chat') {
      this._send({ action: 'get_info' });
      if (!this._chatLoaded) { this._send({ action: 'chat_get_history' }); }
      this._send({ action: 'get_chat_background' }); this._send({ action: 'custom_ai_get_enabled' });
    } else if (tab === 'system') {
      this._send({ action: 'get_info' }); this._send({ action: 'get_device_info' }); this._send({ action: 'ota_get' });
      this._send({ action: 'hass_get' }); this._send({ action: 'wifi_get_status' }); this._send({ action: 'wifi_get_saved' });
      this._send({ action: 'mac_get' }); this._send({ action: 'get_premium_status' });
      this._sysPoll = setInterval(() => {
        if (this._cardCollapsed) return;
        this._send({ action: 'get_info' }); this._send({ action: 'get_device_info' });
      }, 3000);
    }
  }

  _stopTabServices() {
    this._stopWaveform();
    clearInterval(this._progressInterval); this._progressInterval = null;
    clearInterval(this._ctrlPoll); this._ctrlPoll = null;
    clearInterval(this._sysPoll); this._sysPoll = null;
  }

  _startProgressTick() {
    clearInterval(this._progressInterval);
    let lastTick = performance.now();
    this._progressInterval = setInterval(() => {
      if (this._cardCollapsed) return;
      const now = performance.now();
      const elapsed = now - lastTick;
      lastTick = now;
      const m = this._state.media;
      if (!m.isPlaying || m.duration <= 0 || this._syncInProgress) return;
      const delta = Math.round(elapsed / 1000);
      if (delta > 0 && m.position + delta <= m.duration) {
        m.position += delta;
        this._updateProgressOnly();
      }
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
    let rafId = null;
    let waveRunning = true;

    const tick = (ts) => {
      if (!waveRunning) return;
      rafId = requestAnimationFrame(tick);
      if (this._cardCollapsed) return;
      const dt = Math.min((ts - (lastTs || ts)) / 16.67, 3); lastTs = ts;
      const isPlaying = this._state.media.isPlaying; const curMode = this._waveStyle || 'ball';
      w1 += 0.0045 * dt; w2 += 0.010 * dt; w3 += 0.0065 * dt;
      const fpb = (60 / bpm) * 60; frameSinceBeat += dt;
      if (frameSinceBeat >= fpb) {
        frameSinceBeat -= fpb; beatTgt = isPlaying ? (0.6 + Math.random() * 0.4) : 0;
        bpm += (Math.random() - 0.5) * 2; bpm = Math.max(22, Math.min(42, bpm));
      }
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

    this._waveStop = () => {
      waveRunning = false;
      if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
    };
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
      if (this._waveStyle === 'classic') {
        for (let i = 0; i < 25; i++) html += `<div class="wv-col"><div class="wv-ball" style="display:none"></div><div class="wv-bar"></div></div>`;
      } else {
        for (let i = 0; i < 25; i++) html += `<div class="wv-col"><div class="wv-ball"></div><div class="wv-bar"></div></div>`;
      }
      wv.innerHTML = html;
      this._waveBars = wv.querySelectorAll('.wv-bar'); this._waveBalls = wv.querySelectorAll('.wv-ball');
    }
    const btn = this.querySelector('#btnWaveStyle');
    if (btn) btn.textContent = this._waveStyle === 'classic' ? '≡' : '⚬';
    this._toast(this._waveStyle === 'classic' ? '≡ Classic bars' : '⚬ Peak ball', 'success');
  }

  _fmtTime(s) { s = Math.max(0, Math.floor(Number(s || 0))); return `${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`; }
  _esc(s) { return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
  _dbStr(v) { const d = v - 231; return (d >= 0 ? "+" : "") + d + " dB"; }
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
    overlay.innerHTML = `<div class="offline-box"><div class="offline-icon">${isPermanent ? "🔌" : "📡"}</div><div class="offline-title" style="color:${isPermanent ? "#fca5a5" : "#fcd34d"}">${isPermanent ? "Thiết bị offline" : "Đang kết nối lại..."}</div><div class="offline-room">${this._esc(roomName)}</div><div class="offline-host">${this._esc(host)}</div>${progressBar}<div class="offline-retry" style="margin-top:6px">${isPermanent ? `<span style="color:rgba(226,232,240,.45);font-size:11px">Đã thử hết ${total} lần — không kết nối được</span>` : (this._retryIn > 0 ? `Thử lại sau <b>${this._retryIn}s</b>` : `Đang thử kết nối...`)}</div><button class="offline-btn" id="btnOfflineRetry">🔄 Thử lại</button></div>`;
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

  _showInputModal(labelText, placeholder, callback) {
    const existing = this.querySelector("#inputModal"); if (existing) existing.remove();
    const div = document.createElement("div");
    div.id = "inputModal"; div.className = "modal-overlay";
    div.innerHTML = `<div class="modal-box" style="max-width:320px">
      <div class="modal-head"><h3>${this._esc(labelText)}</h3><button class="modal-close" id="_imClose">✕</button></div>
      <input class="form-inp" id="_imInp" placeholder="${this._esc(placeholder)}" style="margin-bottom:12px" autocomplete="off"/>
      <div class="fx g4">
        <button class="form-btn" id="_imCancel" style="flex:1">Hủy</button>
        <button class="form-btn green" id="_imOk" style="flex:1">OK</button>
      </div>
    </div>`;
    this.appendChild(div);
    const inp = div.querySelector("#_imInp");
    const close = () => div.remove();
    const confirm = () => { close(); callback(inp.value); };
    div.querySelector("#_imClose").onclick = close;
    div.querySelector("#_imCancel").onclick = close;
    div.querySelector("#_imOk").onclick = confirm;
    inp.onkeypress = e => { if (e.key === "Enter") confirm(); };
    setTimeout(() => inp.focus(), 50);
  }

  _showPasswordModal(ssid, callback) {
    const existing = this.querySelector("#pwModal"); if (existing) existing.remove();
    const div = document.createElement("div");
    div.id = "pwModal"; div.className = "modal-overlay";
    div.innerHTML = `<div class="modal-box" style="max-width:320px">
      <div class="modal-head"><h3>🔐 Kết nối WiFi</h3><button class="modal-close" id="_pwClose">✕</button></div>
      <div style="font-size:12px;color:#a78bfa;font-weight:700;margin-bottom:8px">📶 ${this._esc(ssid)}</div>
      <input class="form-inp" id="_pwInp" type="password" placeholder="Mật khẩu WiFi..." style="margin-bottom:12px" autocomplete="off"/>
      <div class="fx g4">
        <button class="form-btn" id="_pwCancel" style="flex:1">Hủy</button>
        <button class="form-btn green" id="_pwOk" style="flex:1">Kết nối</button>
      </div>
    </div>`;
    this.appendChild(div);
    const inp = div.querySelector("#_pwInp");
    const close = () => div.remove();
    const confirm = () => { close(); callback(inp.value); };
    div.querySelector("#_pwClose").onclick = close;
    div.querySelector("#_pwCancel").onclick = close;
    div.querySelector("#_pwOk").onclick = confirm;
    inp.onkeypress = e => { if (e.key === "Enter") confirm(); };
    setTimeout(() => inp.focus(), 50);
  }

  _showAddToPlaylistModal(item, type) {
    const existing = this.querySelector("#addPlModal"); if (existing) existing.remove();
    // Cần biết danh sách playlist → fetch trước
    this._send({ action: "playlist_list" });
    const div = document.createElement("div");
    div.id = "addPlModal"; div.className = "modal-overlay";
    const playlists = this._state.playlists || [];
    const songTitle = item.title || item.name || "---";
    div.innerHTML = `<div class="modal-box" style="max-width:320px">
      <div class="modal-head"><h3>➕ Thêm vào Playlist</h3><button class="modal-close" id="_apClose">✕</button></div>
      <div style="font-size:11px;color:#a78bfa;font-weight:700;margin-bottom:10px">🎵 ${this._esc(songTitle)}</div>
      ${playlists.length ? playlists.map((pl, i) => `<div class="pl-item" style="cursor:pointer" data-apidx="${i}">
        <span class="pl-name">${this._esc(pl.name)}</span>
        <span class="pl-count">${pl.count ?? pl.song_count ?? 0} bài</span>
        <button class="form-btn sm green" data-apidx="${i}">+ Thêm</button>
      </div>`).join("") : '<div style="text-align:center;padding:16px;color:rgba(226,232,240,.4);font-size:11px">Chưa có playlist nào.<br>Hãy tạo playlist trước.</div>'}
      <div class="fx g4 mt8">
        <button class="form-btn" id="_apCancel" style="flex:1">Đóng</button>
        <button class="form-btn green" id="_apNew" style="flex:1">+ Tạo mới</button>
      </div>
    </div>`;
    this.appendChild(div);
    const close = () => div.remove();
    div.querySelector("#_apClose").onclick = close;
    div.querySelector("#_apCancel").onclick = close;
    div.querySelector("#_apNew").onclick = () => {
      close();
      this._showInputModal("Tên playlist mới", "VD: Nhạc buổi sáng", (name) => {
        if (!name?.trim()) return;
        this._send({ action: "playlist_create", name: name.trim() });
        this._toast("✅ Đã tạo playlist — mở lại để thêm bài", "success");
      });
    };
    div.querySelectorAll("[data-apidx]").forEach(btn => {
      btn.onclick = () => {
        const idx = parseInt(btn.dataset.apidx);
        const pl = playlists[idx]; if (!pl) return;
        // Build payload theo API: source, id (không phải song_id), title, artist, thumbnail_url, duration_seconds
        let source, id;
        if (type === "zing") { source = "zing"; id = item.song_id || item.id; }
        else { source = "youtube"; id = item.video_id || item.id; }
        this._send({
          action: "playlist_add_song",
          playlist_id: pl.id,
          source,
          id,
          title: item.title || item.name || "",
          artist: item.artist || item.channel || "",
          thumbnail_url: item.thumbnail_url || "",
          duration_seconds: item.duration_seconds || 0,
        });
        this._toast(`✅ Đã thêm vào "${pl.name}"`, "success");
        close();
      };
    });
  }

  _render() {
    const tab = this._activeTab;
    this.innerHTML = `
<ha-card>
<div class="wrap">
  <div class="header">
    <div class="brand"><div class="badge-icon">👑</div><span class="title-text">${this._esc(this._config.title)}</span></div>
    <div class="conn-row">
      <div class="dot" id="connDot"></div>
      <span class="conn-label" id="connText">WS</span>
      <button class="collapse-btn" id="btnCollapseCard" title="${this._cardCollapsed ? 'Bật card' : 'Tắt card (tiết kiệm tài nguyên)'}">${this._cardCollapsed ? "▼" : "▲"}</button>
    </div>
  </div>

  <div id="cardBody" style="${this._cardCollapsed ? 'display:none' : ''}">

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
        </label>` : `<span class="sync-active-mark" title="Phòng đang chọn" style="color:${color}">★</span>`}
      </div>`;
    }).join('')}
  </div>` : ''}

  <div class="tabs">
    ${["media","control","chat","system"].map(k=>`<button class="tab ${tab===k?"active":""}" data-tab="${k}">${{media:"♪ Media",control:"⚙ Control",chat:"💬 Chat",system:"✦ System"}[k]}</button>`).join("")}
  </div>
  <div class="body">
    <div class="offline-overlay" id="offlineOverlay" style="display:none"></div>
    ${this._panelMedia(tab)}
    ${this._panelControl(tab)}
    ${this._panelChat(tab)}
    ${this._panelSystem(tab)}
  </div>

  </div><!-- /cardBody -->
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
.conn-label{font-size:10px;color:rgba(226,232,240,.6)}
.collapse-btn{background:rgba(109,40,217,.2);border:1px solid rgba(139,92,246,.25);color:#c4b5fd;cursor:pointer;border-radius:6px;padding:2px 7px;font-size:11px;font-weight:700;transition:all .15s}
.collapse-btn:hover{background:rgba(109,40,217,.4)}
.room-bar{display:flex;gap:5px;overflow-x:auto;padding:0 0 8px;scrollbar-width:none;-webkit-overflow-scrolling:touch;margin-bottom:4px;align-items:flex-end}
.room-bar::-webkit-scrollbar{display:none}
.room-pill-group{display:flex;flex-direction:column;align-items:center;gap:3px;flex-shrink:0}
.room-pill{display:flex;align-items:center;gap:5px;padding:6px 12px;border-radius:999px;cursor:pointer;font-size:11px;font-weight:700;white-space:nowrap;border:1px solid rgba(148,163,184,.18);background:rgba(2,6,23,.4);color:rgba(226,232,240,.6);transition:all .18s}
.room-pill:hover{background:rgba(109,40,217,.2);border-color:rgba(139,92,246,.25);color:#c4b5fd}
.room-pill.active{background:linear-gradient(135deg,rgba(109,40,217,.45),rgba(91,33,182,.4));border-color:rgba(139,92,246,.5);color:#fff;box-shadow:0 2px 14px rgba(109,40,217,.3)}
.room-pill-dot{width:6px;height:6px;border-radius:50%;background:rgba(148,163,184,.4);transition:all .2s;flex-shrink:0}
.room-pill.offline{background:rgba(239,68,68,.15);border-color:rgba(239,68,68,.35);color:rgba(252,165,165,.9)}
.room-pill.offline .room-pill-dot{background:rgba(239,68,68,.9);box-shadow:0 0 6px rgba(239,68,68,.6);animation:offBlink 1.2s ease-in-out infinite}
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
.sync-btn:hover{background:rgba(109,40,217,.5);border-color:rgba(139,92,246,.5);transform:translateY(-1px)}
.sync-auto-on{background:linear-gradient(135deg,rgba(34,197,94,.3),rgba(21,128,61,.25));border-color:rgba(34,197,94,.4);color:#86efac;animation:autoSyncPulse 2s ease-in-out infinite}
@keyframes autoSyncPulse{0%,100%{box-shadow:0 0 0 0 rgba(34,197,94,.3)}50%{box-shadow:0 0 8px 3px rgba(34,197,94,.2)}}
.sync-btn-busy{opacity:.6;cursor:not-allowed!important;animation:syncBusy .8s ease-in-out infinite}
@keyframes syncBusy{0%,100%{opacity:.6}50%{opacity:.3}}
.room-volumes{border-radius:12px;background:rgba(2,6,23,.5);border:1px solid rgba(139,92,246,.15);padding:8px 12px;margin-bottom:8px}
.room-vol-row{display:flex;align-items:center;gap:8px;margin-bottom:5px}
.room-vol-row:last-child{margin-bottom:0}
.room-vol-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0}
.room-vol-name{font-size:10px;font-weight:700;min-width:64px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex-shrink:0}
.room-vol-row input[type=range]{flex:1;-webkit-appearance:none;height:4px;border-radius:999px;outline:none;cursor:pointer;background:rgba(148,163,184,.18)}
.room-vol-row input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:13px;height:13px;border-radius:50%;background:var(--rv-color,#7c3aed);border:2px solid rgba(255,255,255,.3);cursor:pointer}
.room-vol-label{font-size:10px;color:rgba(226,232,240,.6);min-width:18px;text-align:right;font-family:monospace}
@keyframes offBlink{0%,100%{opacity:1}50%{opacity:.3}}
.offline-overlay{position:absolute;inset:0;z-index:50;background:rgba(6,9,18,.92);border-radius:12px;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px)}
.offline-box{text-align:center;padding:24px 20px;display:flex;flex-direction:column;align-items:center;gap:8px}
.offline-icon{font-size:40px;animation:offBlink 1.5s ease-in-out infinite}
.offline-title{font-size:16px;font-weight:900;letter-spacing:.5px}
.offline-room{font-size:13px;font-weight:700;color:#e2e8f0}
.offline-host{font-size:10px;color:rgba(226,232,240,.4);font-family:monospace}
.offline-retry{font-size:12px;color:rgba(226,232,240,.6);margin-top:4px}
.offline-retry b{color:#fbbf24}
.offline-btn{margin-top:8px;padding:10px 24px;border-radius:12px;cursor:pointer;font-size:12px;font-weight:700;border:1px solid rgba(139,92,246,.4);background:linear-gradient(135deg,rgba(109,40,217,.5),rgba(91,33,182,.4));color:#fff;transition:all .15s}
.offline-btn:hover{box-shadow:0 2px 16px rgba(109,40,217,.5);transform:translateY(-1px)}
.tabs{display:flex;gap:6px;background:rgba(2,6,23,.5);border:1px solid rgba(148,163,184,.1);padding:5px;border-radius:14px;margin-bottom:12px}
.tab{flex:1;font-size:11px;padding:8px 6px;border-radius:10px;cursor:pointer;color:rgba(226,232,240,.6);background:transparent;border:none;font-weight:600;transition:all .2s}
.tab.active{color:#fff;background:rgba(109,40,217,.5);border:1px solid rgba(139,92,246,.3);font-weight:800;box-shadow:0 2px 12px rgba(109,40,217,.25)}
.body{height:520px;overflow:hidden;position:relative}
.panel{display:none;position:absolute;inset:0;overflow-y:auto;overflow-x:hidden;padding-right:4px}
.panel::-webkit-scrollbar{width:4px}.panel::-webkit-scrollbar-thumb{background:rgba(139,92,246,.3);border-radius:999px}
.panel.active{display:block;animation:fadeIn .2s ease}
@keyframes fadeIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
.media-card{border-radius:16px;overflow:hidden;border:1px solid rgba(148,163,184,.12);background:linear-gradient(180deg,rgba(30,20,60,.9),rgba(10,15,30,.95));padding:14px;margin-bottom:12px}
.mc-header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px}
.mc-info{flex:1;min-width:0}
.mc-title{font-size:15px;font-weight:900;color:#f1f5f9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mc-artist{font-size:11px;color:rgba(226,232,240,.55);margin-top:2px}
.mc-badges{display:flex;align-items:center;gap:6px;flex-shrink:0}
.mc-source{font-size:9px;padding:3px 8px;border-radius:6px;background:rgba(109,40,217,.3);border:1px solid rgba(139,92,246,.3);color:#c4b5fd;font-weight:800;letter-spacing:1px}
.mc-icon-btn{width:28px;height:28px;border-radius:50%;border:1px solid rgba(148,163,184,.15);background:transparent;color:rgba(226,232,240,.5);cursor:pointer;font-size:13px;display:grid;place-items:center;transition:all .15s}
.mc-icon-btn:hover{background:rgba(109,40,217,.2)}.mc-icon-btn.active-btn{color:#86efac;border-color:rgba(34,197,94,.3)}
.mc-vis{position:relative;border-radius:14px;overflow:hidden;margin-bottom:0;border:1px solid rgba(139,92,246,.2);background:linear-gradient(135deg,#0c0618 0%,#12082a 100%);display:flex;flex-direction:column;}
.mc-bg{position:absolute;inset:0;z-index:0;background-size:cover;background-position:center;filter:blur(18px) brightness(.75) saturate(1.5);transform:scale(1.25);opacity:0;transition:opacity .6s ease;}
.mc-bg.show{opacity:1}
.mc-vis::after{content:'';position:absolute;inset:0;z-index:1;background:linear-gradient(to bottom,rgba(4,2,12,.05) 0%,rgba(4,2,12,.25) 100%);pointer-events:none;}
.mc-top{display:flex;align-items:center;gap:11px;padding:12px 14px;position:relative;z-index:2;flex:1;flex-direction:row-reverse;}
.mc-thumb-wrap{width:72px;height:72px;border-radius:50%;overflow:hidden;flex-shrink:0;border:2.5px solid rgba(139,92,246,.55);box-shadow:0 0 20px rgba(109,40,217,.5);position:relative;}
.mc-thumb{width:100%;height:100%;object-fit:cover}
.mc-thumb.spin{animation:sp 12s linear infinite}@keyframes sp{to{transform:rotate(360deg)}}
.mc-thumb-fb{width:100%;height:100%;display:grid;place-items:center;background:rgba(109,40,217,.18);font-size:28px}
.waveform-wrap{display:flex;flex-direction:column;align-items:flex-start;flex:1;height:72px;overflow:hidden;position:relative;z-index:2;}
.waveform{display:flex;align-items:flex-end;justify-content:space-evenly;flex:1;width:100%}
.wv-style-btn{flex-shrink:0;width:28px;height:28px;border-radius:50%;border:1px solid rgba(139,92,246,.45);background:rgba(109,40,217,.25);color:rgba(167,139,250,.95);cursor:pointer;font-size:14px;display:grid;place-items:center;align-self:flex-start;margin:0 0 4px 2px;transition:all .15s;padding:0;line-height:1;}
.wv-style-btn:hover{background:rgba(109,40,217,.5);border-color:rgba(139,92,246,.7);transform:scale(1.1)}
.wv-col{display:flex;flex-direction:column;align-items:center;justify-content:flex-end;position:relative;flex:1;height:100%}
.wv-bar{width:3px;flex-shrink:0;background:linear-gradient(to top,rgba(88,28,220,.7),rgba(167,139,250,.9));border-radius:2px 2px 1px 1px;will-change:height;height:3px;opacity:.9}
.wv-ball{position:absolute;bottom:3px;width:5px;height:5px;border-radius:50%;background:#c4b5fd;box-shadow:0 0 4px rgba(167,139,250,.8);left:50%;transform:translateX(-50%);transition:bottom 0.05s linear;pointer-events:none}
.mc-seek-wrap{position:relative;z-index:2;padding:4px 12px 10px 12px;flex-shrink:0;}
.mc-seek-row{display:flex;align-items:center;gap:7px}
.mc-seek-bar{flex:1;height:3px;border-radius:2px;background:rgba(255,255,255,.12);cursor:pointer;position:relative;overflow:visible;}
.mc-seek-fill{height:100%;background:linear-gradient(to right,#6d28d9,#a78bfa);border-radius:2px;transition:width .4s linear;pointer-events:none;}
.mc-seek-thumb{position:absolute;top:50%;right:calc(100% - var(--spct,0%));transform:translate(50%,-50%);width:11px;height:11px;border-radius:50%;background:#c4b5fd;box-shadow:0 0 6px rgba(167,139,250,.7);opacity:0;transition:opacity .15s;pointer-events:none;}
.mc-seek-bar:hover .mc-seek-thumb{opacity:1}
@media(hover:none){.mc-seek-thumb{opacity:1!important}}
.progress-row{display:flex;align-items:center;gap:8px;margin-bottom:12px}
.time-txt{font-size:10px;color:rgba(226,232,240,.55);min-width:32px;font-family:monospace}
.time-txt.right{text-align:right}
.media-controls{display:flex;align-items:center;justify-content:center;gap:10px;margin-bottom:14px}
.ctrl-btn{width:38px;height:38px;border-radius:50%;border:1px solid rgba(148,163,184,.15);background:rgba(2,6,23,.4);color:rgba(226,232,240,.8);cursor:pointer;font-size:14px;display:grid;place-items:center;transition:all .15s}
.ctrl-btn:hover{background:rgba(109,40,217,.3);border-color:rgba(139,92,246,.3)}
.ctrl-btn.play{width:52px;height:52px;font-size:20px;background:linear-gradient(135deg,#7c3aed,#5b21b6);border:1px solid rgba(139,92,246,.5);box-shadow:0 4px 20px rgba(109,40,217,.4);color:#fff}
.ctrl-btn.stop{background:rgba(239,68,68,.15);border-color:rgba(239,68,68,.25);color:rgba(239,68,68,.9)}
.ctrl-btn.active-btn{background:rgba(34,197,94,.15);border-color:rgba(34,197,94,.3);color:rgba(34,197,94,.9)}
.vol-row{display:flex;align-items:center;gap:8px;margin-top:10px;padding:0 2px}
.vol-icon{font-size:12px;color:rgba(226,232,240,.6)}
.vol-label{font-size:10px;color:rgba(226,232,240,.5);min-width:40px;text-align:right}
input[type=range]{flex:1;-webkit-appearance:none;height:5px;border-radius:999px;background:rgba(148,163,184,.2);outline:none;cursor:pointer}
input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:14px;height:14px;border-radius:50%;background:#7c3aed;border:2px solid rgba(167,139,250,.5);cursor:pointer}
.search-tabs{display:flex;gap:2px;margin-bottom:8px;border-bottom:1px solid rgba(148,163,184,.12);padding-bottom:6px}
.stab{padding:5px 10px;cursor:pointer;font-size:11px;font-weight:700;color:rgba(226,232,240,.5);background:transparent;border:none;border-bottom:2px solid transparent;transition:all .15s}
.stab.active{color:#a78bfa;border-bottom-color:#7c3aed}
.search-row{display:flex;gap:8px;margin-bottom:8px}
.search-inp{flex:1;background:rgba(2,6,23,.5);border:1px solid rgba(148,163,184,.18);border-radius:12px;padding:9px 12px;color:#e2e8f0;font-size:12px;outline:none}
.search-inp:focus{border-color:rgba(139,92,246,.5)}
.search-btn{padding:9px 14px;border-radius:12px;cursor:pointer;background:linear-gradient(135deg,#7c3aed,#5b21b6);border:1px solid rgba(139,92,246,.4);color:#fff;font-size:14px}
.search-results{max-height:160px;overflow-y:auto}
.search-results::-webkit-scrollbar{width:4px}.search-results::-webkit-scrollbar-thumb{background:rgba(139,92,246,.3);border-radius:999px}
.result-item{display:flex;align-items:center;gap:8px;padding:7px 8px;border-radius:10px;cursor:pointer;border:1px solid transparent;transition:all .15s;margin-bottom:4px}
.result-item:hover{background:rgba(109,40,217,.2);border-color:rgba(139,92,246,.2)}
.result-thumb{width:36px;height:36px;border-radius:8px;object-fit:cover;background:rgba(109,40,217,.2);flex-shrink:0;font-size:16px;display:grid;place-items:center}
.result-info{flex:1;min-width:0}
.result-title{font-size:11px;font-weight:700;color:#e2e8f0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.result-sub{font-size:10px;color:rgba(226,232,240,.5)}
.result-btns{display:flex;gap:4px;flex-shrink:0}
.rbtn{padding:5px 10px;border-radius:8px;cursor:pointer;font-size:11px;font-weight:700;border:none;transition:all .15s}
.rbtn-add{background:rgba(109,40,217,.25);color:#a78bfa;border:1px solid rgba(139,92,246,.3);padding:5px 8px}
.rbtn-add:hover{background:rgba(109,40,217,.4)}
.rbtn-play{background:linear-gradient(135deg,#7c3aed,#5b21b6);color:#fff;border:1px solid rgba(139,92,246,.4)}
.rbtn-play:hover{box-shadow:0 2px 10px rgba(109,40,217,.4)}
.ctrl-section{margin-bottom:12px}
.section-label{font-size:10px;color:rgba(226,232,240,.45);font-weight:700;letter-spacing:1px;margin-bottom:8px;text-transform:uppercase}
.toggle-item{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-radius:12px;border:1px solid rgba(148,163,184,.1);background:rgba(2,6,23,.3);margin-bottom:6px}
.toggle-left .tog-name{font-size:12px;font-weight:800;color:#e2e8f0}
.toggle-left .tog-desc{font-size:10px;color:rgba(226,232,240,.5);margin-top:2px}
.sw{width:42px;height:24px;border-radius:999px;cursor:pointer;border:1px solid rgba(148,163,184,.2);background:rgba(148,163,184,.12);position:relative;transition:all .2s;flex-shrink:0}
.sw::after{content:"";position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:rgba(226,232,240,.7);transition:all .18s}
.sw.on{background:rgba(34,197,94,.2);border-color:rgba(34,197,94,.4)}.sw.on::after{left:21px;background:#86efac}
.sw.unknown{opacity:.5}
.slider-row{padding:10px 12px;border-radius:12px;border:1px solid rgba(148,163,184,.1);background:rgba(2,6,23,.3);margin-bottom:6px}
.slider-row-top{display:flex;justify-content:space-between;margin-bottom:6px}
.slider-row-top .s-name{font-size:12px;font-weight:800;color:#e2e8f0}
.slider-row-top .s-val{font-size:11px;color:#a78bfa}
.sub-tabs{display:flex;gap:4px;margin-bottom:8px}
.sub-tab{padding:5px 10px;border-radius:8px;cursor:pointer;font-size:10px;font-weight:700;border:1px solid rgba(148,163,184,.12);background:transparent;color:rgba(226,232,240,.5);transition:all .15s}
.sub-tab.active{background:rgba(109,40,217,.3);border-color:rgba(139,92,246,.3);color:#c4b5fd}
.eq-container{display:flex;justify-content:space-evenly;align-items:flex-end;padding:8px 0;width:100%}
.eq-band{display:flex;flex-direction:column;align-items:center;gap:4px;flex:1}
.eq-band-val{font-size:10px;font-weight:700;color:#a78bfa;text-align:center;min-height:16px;line-height:16px}
.eq-band input[type=range]{writing-mode:vertical-lr;direction:rtl;-webkit-appearance:slider-vertical;width:22px;height:95px;flex:none;padding:0}
.eq-band label{font-size:9px;color:rgba(226,232,240,.4)}
.preset-row{display:flex;flex-wrap:wrap;gap:4px;justify-content:center;margin:6px 0}
.preset-btn{padding:4px 10px;border-radius:8px;cursor:pointer;font-size:10px;font-weight:700;border:1px solid rgba(148,163,184,.12);background:rgba(2,6,23,.3);color:rgba(226,232,240,.5);transition:all .15s}
.preset-btn:hover{background:rgba(109,40,217,.2);border-color:rgba(139,92,246,.2);color:#c4b5fd}
.collapsible-header{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-radius:12px;border:1px solid rgba(148,163,184,.1);background:rgba(2,6,23,.4);cursor:pointer;margin-bottom:6px;transition:all .15s;user-select:none}
.collapsible-header:hover{background:rgba(109,40,217,.15);border-color:rgba(139,92,246,.2)}
.collapsible-title{font-size:11px;font-weight:800;color:#e2e8f0;display:flex;align-items:center;gap:6px}
.collapsible-arrow{font-size:10px;color:rgba(226,232,240,.5);transition:transform .2s}
.collapsible-arrow.open{transform:rotate(180deg)}
.collapsible-body.closed{display:none}
.alarm-item{padding:10px 12px;border-radius:12px;border:1px solid rgba(148,163,184,.1);background:rgba(2,6,23,.3);margin-bottom:6px}
.alarm-time{font-size:22px;font-weight:900;color:#e2e8f0}
.alarm-meta{font-size:10px;color:rgba(226,232,240,.5);margin-top:3px}
.alarm-actions{display:flex;gap:4px;flex-shrink:0}
.chat-wrap{border-radius:16px;overflow:hidden;border:1px solid rgba(148,163,184,.12);background:rgba(2,6,23,.4);position:relative}
.chat-bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.22;display:none;pointer-events:none}
.msgs{position:relative;height:240px;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:7px;scroll-behavior:smooth}
.msgs::-webkit-scrollbar{width:4px}.msgs::-webkit-scrollbar-thumb{background:rgba(139,92,246,.3);border-radius:999px}
.mrow{display:flex}.mrow.user{justify-content:flex-end}.mrow.server{justify-content:flex-start}
.bubble{max-width:82%;padding:8px 11px;border-radius:14px;font-size:12px;line-height:1.45;color:#fff}
.bubble.user{background:linear-gradient(135deg,#1d4ed8,#2563eb);border-radius:14px 14px 4px 14px}
.bubble.server{background:linear-gradient(135deg,#15803d,#16a34a);border-radius:14px 14px 14px 4px}
.chat-input-row{display:flex;gap:8px;padding:10px;border-top:1px solid rgba(148,163,184,.1);position:relative}
.chat-inp{flex:1;background:rgba(2,6,23,.4);border:1px solid rgba(148,163,184,.15);border-radius:12px;padding:9px 12px;color:#e2e8f0;font-size:12px;outline:none}
.chat-inp:focus{border-color:rgba(139,92,246,.4)}
.send-btn{width:42px;border-radius:12px;border:1px solid rgba(34,197,94,.3);background:linear-gradient(135deg,rgba(21,128,61,.5),rgba(22,163,74,.4));color:#86efac;cursor:pointer;font-size:15px;display:grid;place-items:center}
.chat-actions{display:flex;gap:8px;padding:0 10px 8px}
.chat-action-btn{flex:1;padding:9px;border-radius:12px;cursor:pointer;font-size:11px;font-weight:700;border:1px solid rgba(109,40,217,.3);background:linear-gradient(135deg,rgba(109,40,217,.3),rgba(91,33,182,.25));color:#c4b5fd}
.chat-action-btn.alt{background:rgba(148,163,184,.1);border-color:rgba(148,163,184,.15);color:rgba(226,232,240,.8)}
.chat-action-btn.danger{background:rgba(239,68,68,.1);border-color:rgba(239,68,68,.2);color:rgba(252,165,165,.9)}
.chat-action-btn.session-active{background:linear-gradient(135deg,rgba(234,179,8,.35),rgba(161,98,7,.3));border-color:rgba(234,179,8,.4);color:#fde68a;animation:sessionPulse 2s ease-in-out infinite}
.chat-action-btn.interrupt{background:linear-gradient(135deg,rgba(239,68,68,.35),rgba(185,28,28,.3));border-color:rgba(239,68,68,.4);color:#fca5a5;animation:sessionPulse 2s ease-in-out infinite}
@keyframes sessionPulse{0%,100%{opacity:1}50%{opacity:.75}}
.tiktok-btn{display:flex;align-items:center;gap:8px;margin:0 10px 10px;padding:9px 12px;border-radius:12px;border:1px solid rgba(148,163,184,.12);background:rgba(2,6,23,.3);color:#e2e8f0;font-size:11px;cursor:pointer}
.tk-dot{width:8px;height:8px;border-radius:50%;background:rgba(148,163,184,.5);flex-shrink:0;transition:all .2s}
.tk-dot.on{background:rgba(34,197,94,.9);box-shadow:0 0 8px rgba(34,197,94,.5)}
.sys-info-item{padding:10px 12px;border-radius:12px;border:1px solid rgba(148,163,184,.1);background:rgba(2,6,23,.3);margin-bottom:8px}
.sys-label{font-size:10px;color:rgba(226,232,240,.45);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px}
.sys-value{font-size:12px;color:#e2e8f0;font-weight:700;word-break:break-all}
.stat-bar-wrap{height:8px;background:rgba(148,163,184,.12);border-radius:999px;margin-top:6px;overflow:hidden}
.stat-bar{height:100%;border-radius:999px;transition:width .5s ease}
.stat-bar.cpu{background:linear-gradient(90deg,#7c3aed,#a78bfa)}
.stat-bar.ram{background:linear-gradient(90deg,#0891b2,#38bdf8)}
.form-row{margin-bottom:8px}
.form-label{font-size:10px;color:rgba(226,232,240,.5);margin-bottom:4px}
.form-inp{width:100%;background:rgba(2,6,23,.4);border:1px solid rgba(148,163,184,.15);border-radius:10px;padding:8px 10px;color:#e2e8f0;font-size:11px;outline:none}
.form-inp:focus{border-color:rgba(139,92,246,.4)}
select.form-inp{cursor:pointer}
.form-btn{padding:8px 14px;border-radius:10px;cursor:pointer;font-size:11px;font-weight:700;border:1px solid rgba(139,92,246,.3);background:rgba(109,40,217,.3);color:#c4b5fd}
.form-btn.sm{padding:6px 10px;font-size:10px}
.form-btn.danger{background:rgba(239,68,68,.15);border-color:rgba(239,68,68,.25);color:rgba(252,165,165,.9)}
.form-btn.green{background:rgba(34,197,94,.15);border-color:rgba(34,197,94,.3);color:#86efac}
.wifi-item{display:flex;align-items:center;justify-content:space-between;padding:7px 10px;border-radius:10px;border:1px solid rgba(148,163,184,.1);background:rgba(2,6,23,.25);margin-bottom:5px;cursor:pointer}
.wifi-item:hover{background:rgba(109,40,217,.1)}
.wifi-ssid{font-size:11px;color:#e2e8f0;font-weight:700}
.wifi-rssi{font-size:10px;color:rgba(226,232,240,.5)}
.modal-overlay{position:fixed;top:0;left:0;right:0;bottom:0;z-index:200;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:16px}
.modal-box{background:linear-gradient(180deg,#0f172a,#0a0f1e);border:1px solid rgba(139,92,246,.2);border-radius:18px;padding:18px;max-width:420px;width:100%;max-height:85vh;overflow-y:auto}
.modal-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}
.modal-head h3{font-size:14px;font-weight:900;color:#e2e8f0}
.modal-close{background:none;border:none;color:rgba(226,232,240,.5);cursor:pointer;font-size:18px;padding:4px}
.modal-close:hover{color:#e2e8f0}
.pl-item{display:flex;align-items:center;justify-content:space-between;padding:8px 10px;border-radius:10px;border:1px solid rgba(148,163,184,.1);background:rgba(2,6,23,.25);margin-bottom:5px}
.pl-name{font-size:11px;font-weight:700;color:#e2e8f0;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pl-count{font-size:9px;color:rgba(226,232,240,.45);margin-left:8px}
.pl-btns{display:flex;gap:3px;margin-left:8px}
.al-days{display:flex;flex-wrap:wrap;gap:5px;margin-top:6px}
.al-days label{display:flex;align-items:center;gap:3px;font-size:10px;color:rgba(226,232,240,.6);cursor:pointer}
.al-days input{width:14px;height:14px;accent-color:#7c3aed}
.toast{position:fixed;z-index:9999;left:50%;transform:translateX(-50%);bottom:16px;background:rgba(2,6,23,.9);border:1px solid rgba(148,163,184,.2);color:#e2e8f0;padding:9px 14px;border-radius:12px;font-size:11px;opacity:0;pointer-events:none;transition:opacity .18s,transform .18s;white-space:nowrap}
.toast.on{opacity:1;transform:translateX(-50%) translateY(-6px)}
.toast.success{border-color:rgba(34,197,94,.3);color:#86efac}
.toast.error{border-color:rgba(239,68,68,.3);color:#fca5a5}
.fx{display:flex}.aic{align-items:center}.jcb{justify-content:space-between}.g4{gap:4px}.g6{gap:6px}.g8{gap:8px}.mt6{margin-top:6px}.mt8{margin-top:8px}.mb6{margin-bottom:6px}.mb8{margin-bottom:8px}.f1{flex:1;min-width:0}.o5{opacity:.5}
.hidden{display:none!important}
@media(max-width:480px){.wrap{padding:10px 10px 8px}.title-text{font-size:14px}.badge-icon{width:28px;height:28px;font-size:13px}.tabs{padding:4px;gap:4px}.tab{font-size:10px;padding:7px 4px}.body{height:auto;min-height:420px;max-height:90vh}.mc-thumb-wrap{width:60px;height:60px}.waveform-wrap{height:60px!important}.mc-title{font-size:13px}.ctrl-btn{width:34px;height:34px;font-size:13px}.ctrl-btn.play{width:46px;height:46px;font-size:18px}.msgs{height:200px}.bubble{font-size:11px}.toggle-left .tog-name{font-size:11px}.sw{width:38px;height:22px}.sw::after{width:14px;height:14px;top:3px;left:3px}.sw.on::after{left:19px}.rbtn{font-size:10px;padding:4px 8px}.eq-band input[type=range]{height:70px}.eq-band-val{font-size:9px}input[type=range]::-webkit-slider-thumb{width:20px;height:20px}.mc-seek-thumb{opacity:1!important;width:14px;height:14px}.sync-bar-inner{flex-direction:column;align-items:flex-start}.sync-bar-right{flex-wrap:wrap}}
</style>
`;
    this._setConnDot(this._wsConnected);
    if (this._rooms) this._renderRoomPills();
    if (this._offline) this._setOffline(true, this._retryIn * 1000);
    this._renderMedia(); this._renderVolume();
    this._renderControlToggles(); this._renderLight();
    this._renderWakeWord(); this._renderCustomAi(); this._renderVoice();
    this._renderOta(); this._renderHass();
    this._renderWifiStatus(); this._renderWifiSaved();
    this._renderChatMsgs(); this._renderChatBg(); this._renderTikTok(); this._renderSessionBtn();
    this._renderSystem(); this._renderAlarms();
    setTimeout(() => { this._renderSyncBar(); this._renderRoomVolumeSliders(); }, 0);
  }

  _panelMedia(tab) {
    let wvContent = '';
    for (let i = 0; i < 25; i++) wvContent += `<div class="wv-col"><div class="wv-ball"></div><div class="wv-bar"></div></div>`;
    return `
<div class="panel ${tab==="media"?"active":""}" id="p-media">
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
      <button class="ctrl-btn" id="btnPrev" title="Previous">⏮</button>
      <button class="ctrl-btn play" id="btnPlayPause" title="Play/Pause">▶</button>
      <button class="ctrl-btn stop" id="btnStop" title="Stop">■</button>
      <button class="ctrl-btn" id="btnNext" title="Next">⏭</button>
    </div>
    <div class="vol-row">
      <span class="vol-icon">🔊</span>
      <input type="range" id="volSlider" min="0" max="15" value="0" />
      <span class="vol-label" id="volLabel">0</span>
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
  <div id="plMgr" class="hidden">
    <div class="fx g4 mb6"><button class="form-btn sm" id="btnPlCreate">+ Tạo playlist</button><button class="form-btn sm" id="btnPlRefresh">🔄</button></div>
    <div id="plList"></div>
    <div id="plSongs" class="hidden mt6"></div>
  </div>
  <div id="searchResults" class="search-results"></div>
</div>`;
  }

  _panelControl(tab) {
    let voiceOpts = ''; for (let i = 1; i <= 30; i++) voiceOpts += `<option value="${i}">${i}. ${VOICES[i]}</option>`;
    const at = this._activeAudioTab, lt = this._activeLightTab;
    const audioOpen = this._audioOpen, lightOpen = this._lightOpen;
    return `
<div class="panel ${tab==="control"?"active":""}" id="p-control">
  <div class="ctrl-section">
    <div class="section-label">📡 CONTROL</div>
    <div class="toggle-item"><div class="toggle-left"><div class="tog-name">🎙 Wake Word (Ô Kề Na Bu)</div></div><div class="sw unknown" id="swWake"></div></div>
    <div id="wakeSensRow" style="display:none"><div class="slider-row"><div class="slider-row-top"><span class="s-name">Độ nhạy (nên để 0.95~0.99)</span><span class="s-val" id="wakeVal">0.90</span></div><input type="range" id="wakeSlider" min="0" max="1" step="0.01" value="0.90" style="width:100%" /><div class="fx jcb" style="font-size:9px;color:rgba(226,232,240,.35)"><span>Dễ kích hoạt</span><span>Khó kích hoạt</span></div></div></div>
    <div class="toggle-item" id="customAiRow" style="display:none"><div class="toggle-left"><div class="tog-name">🧠 Chống Điếc AI</div><div class="tog-desc">Khi bật sẽ nhận diện giọng nói chuẩn 99% và đổi giọng AI</div></div><div class="sw unknown" id="swCustomAi"></div></div>
  </div>
  <div class="ctrl-section" id="voiceRow" style="display:none"><div class="section-label">🎤 Chọn Giọng Nói AI</div><div class="fx g4 aic"><select class="form-inp" id="voiceSel" style="flex:1">${voiceOpts}</select><button class="form-btn sm" id="btnVoicePv">▶ Play</button></div></div>
  <div class="ctrl-section" id="live2dRow" style="display:none"><div class="section-label">👤 Chọn Model Live2D</div><select class="form-inp" id="live2dSel"><option value="hiyori">Hiyori</option><option value="mao">Mao</option><option value="miara">Miara</option><option value="nicole">Nicole</option><option value="changli">Changli</option></select></div>
  <div class="ctrl-section">
    <div class="toggle-item"><div class="toggle-left"><div class="tog-name">📡 DLNA</div></div><div class="sw unknown" id="swDlna"></div></div>
    <div class="toggle-item"><div class="toggle-left"><div class="tog-name">🍎 AirPlay</div></div><div class="sw unknown" id="swAirplay"></div></div>
    <div class="toggle-item"><div class="toggle-left"><div class="tog-name">🔵 Bluetooth</div></div><div class="sw unknown" id="swBt"></div></div>
    <div class="toggle-item"><div class="toggle-left"><div class="tog-name">💡 Đèn LED Chờ (Tắt để nháy theo nhạc)</div></div><div class="sw unknown" id="swLed"></div></div>
  </div>
  <div class="ctrl-section">
    <div class="collapsible-header" id="audioCollHeader"><span class="collapsible-title">🎛 Audio Engine</span><span class="collapsible-arrow ${audioOpen ? 'open' : ''}" id="audioArrow">▼</span></div>
    <div class="collapsible-body ${audioOpen ? '' : 'closed'}" id="audioCollBody">
      <div class="sub-tabs" style="margin-top:6px">
        <button class="sub-tab ${at==='eq'?'active':''}" data-atab="eq">Equalizer</button>
        <button class="sub-tab ${at==='sur'?'active':''}" data-atab="sur">Surround</button>
      </div>
      <div id="audioEq" class="${at!=='eq'?'hidden':''}">
        <div class="toggle-item mb6"><div class="toggle-left"><div class="tog-name">🎚 Equalizer Enable</div></div><div class="sw" id="swEq"></div></div>
        <div class="eq-container" id="eqBands"></div>
        <div class="preset-row">${['flat','bass','vocal','rock','jazz'].map(p=>`<button class="preset-btn" data-pr="${p}">${p==='bass'?'Bass Boost':p.charAt(0).toUpperCase()+p.slice(1)}</button>`).join('')}</div>
        <div class="toggle-item mt6"><div class="toggle-left"><div class="tog-name">🎵 Tăng cường bass</div></div><div class="sw" id="swBass"></div></div>
        <div class="slider-row"><div class="slider-row-top"><span class="s-name">Strength</span><span class="s-val" id="bassVal">0%</span></div><input type="range" id="bassSlider" min="0" max="1000" step="10" value="0" style="width:100%" /><div class="fx jcb" style="font-size:9px;color:rgba(226,232,240,.35)"><span>0%</span><span>50%</span><span>100%</span></div></div>
        <div class="toggle-item mt6"><div class="toggle-left"><div class="tog-name">🔊 Độ lớn âm thanh</div></div><div class="sw" id="swLoud"></div></div>
        <div class="slider-row"><div class="slider-row-top"><span class="s-name">Gain</span><span class="s-val" id="loudVal">0.0 dB</span></div><input type="range" id="loudSlider" min="-3000" max="3000" value="0" style="width:100%" /><div class="fx jcb" style="font-size:9px;color:rgba(226,232,240,.35)"><span>-30 dB</span><span>0 dB</span><span>+30 dB</span></div></div>
        <div class="section-label mt8">🔊 Dải Trung-Cao</div>
        <div class="slider-row"><div class="slider-row-top"><span class="s-name">Âm trầm trung</span><span class="s-val" id="bvVal">+0 dB</span></div><input type="range" id="bvSlider" min="211" max="251" value="231" style="width:100%" /><div class="fx jcb" style="font-size:9px;color:rgba(226,232,240,.35)"><span>-20 dB</span><span>0 dB</span><span>+20 dB</span></div></div>
        <div class="slider-row"><div class="slider-row-top"><span class="s-name">Âm nốt cao</span><span class="s-val" id="hvVal">+0 dB</span></div><input type="range" id="hvSlider" min="211" max="251" value="231" style="width:100%" /><div class="fx jcb" style="font-size:9px;color:rgba(226,232,240,.35)"><span>-20 dB</span><span>0 dB</span><span>+20 dB</span></div></div>
      </div>
      <div id="audioSur" class="${at!=='sur'?'hidden':''}">
        <div class="slider-row"><div class="slider-row-top"><span class="s-name">↔ Width</span><span class="s-val" id="surWVal">40</span></div><input type="range" id="surW" min="0" max="100" value="40" style="width:100%" /></div>
        <div class="slider-row"><div class="slider-row-top"><span class="s-name">🎯 Presence</span><span class="s-val" id="surPVal">30</span></div><input type="range" id="surP" min="0" max="100" value="30" style="width:100%" /></div>
        <div class="slider-row"><div class="slider-row-top"><span class="s-name">🌌 Space</span><span class="s-val" id="surSVal">10</span></div><input type="range" id="surS" min="0" max="100" value="10" style="width:100%" /></div>
        <div class="preset-row"><button class="preset-btn" data-sur="cinema">🎬 Cinema</button><button class="preset-btn" data-sur="wide">🌌 Wide Space</button><button class="preset-btn" data-sur="reset">↺ Reset</button></div>
      </div>
    </div>
  </div>
  <div class="ctrl-section">
    <div class="collapsible-header" id="lightCollHeader"><span class="collapsible-title">💡 Lighting Control</span><span class="collapsible-arrow ${lightOpen ? 'open' : ''}" id="lightArrow">▼</span></div>
    <div class="collapsible-body ${lightOpen ? '' : 'closed'}" id="lightCollBody">
      <div class="sub-tabs" style="margin-top:6px">
        <button class="sub-tab ${lt==='main'?'active':''}" data-ltab="main">Đèn Chính (RGB)</button>
        <button class="sub-tab ${lt==='edge'?'active':''}" data-ltab="edge">Đèn Viền (Edge)</button>
      </div>
      <div id="lightMain" class="${lt!=='main'?'hidden':''}">
        <div class="toggle-item"><div class="toggle-left"><div class="tog-name">Trạng thái</div></div><div class="sw unknown" id="swLight"></div></div>
        <div class="slider-row"><div class="slider-row-top"><span class="s-name">⚙ Cường độ sáng</span><span class="s-val" id="brightVal">200</span></div><input type="range" id="brightSlider" min="1" max="200" value="200" style="width:100%" /></div>
        <div class="slider-row"><div class="slider-row-top"><span class="s-name">⚡ Tốc độ</span><span class="s-val" id="speedVal">1</span></div><input type="range" id="speedSlider" min="1" max="100" value="1" style="width:100%" /></div>
        <div class="section-label mt6" style="font-size:11px">Chế độ tích hợp (Firmware)</div>
        <div class="preset-row">${[['0','Mặc Định'],['1','Xoay vòng'],['2','Nháy 1'],['3','Đơn sắc'],['4','Nháy 2'],['7','Hơi thở']].map(([v,n])=>`<button class="preset-btn" data-lmode="${v}">${n}</button>`).join('')}</div>
      </div>
      <div id="lightEdge" class="${lt!=='edge'?'hidden':''}">
        <div class="toggle-item"><div class="toggle-left"><div class="tog-name">Trạng thái</div></div><div class="sw" id="swEdge"></div></div>
        <div class="slider-row"><div class="slider-row-top"><span class="s-name">💡 Cường độ viền</span><span class="s-val" id="edgeVal">100%</span></div><input type="range" id="edgeSlider" min="0" max="100" value="100" style="width:100%" /></div>
      </div>
    </div>
  </div>
  <div class="ctrl-section">
    <div class="fx jcb aic mb6"><div class="section-label" style="margin:0">⏰ Báo thức</div><div class="fx g4"><button class="form-btn sm" id="btnAlarmAdd">+ Thêm</button><button class="form-btn sm" id="btnAlarmRefresh">🔄</button></div></div>
    <div id="alarmList"><div style="text-align:center;padding:12px;color:rgba(226,232,240,.4);font-size:11px">Chưa có báo thức</div></div>
  </div>
</div>`;
  }

  _panelChat(tab) {
    return `
<div class="panel ${tab==="chat"?"active":""}" id="p-chat">
  <div class="chat-wrap">
    <img class="chat-bg" id="chatBg" alt="" />
    <div class="msgs" id="chatMsgs"><div style="text-align:center;padding:30px 0;color:rgba(226,232,240,.4);font-size:12px">Chưa có tin nhắn</div></div>
    <div class="chat-input-row">
      <input class="chat-inp" id="chatInp" placeholder="Nhập tin nhắn..." autocomplete="off" />
      <button class="send-btn" id="chatSend">➤</button>
    </div>
    <div class="chat-actions">
      <button class="chat-action-btn session-btn" id="btnSession">🎤 Wake Up</button>
      <button class="chat-action-btn alt" id="btnTestMic">🎙 Test Mic</button>
      <button class="chat-action-btn danger" id="btnChatClear">🧹 Clear</button>
    </div>
    <button class="tiktok-btn" id="btnTikTok"><div class="tk-dot" id="tkDot"></div><span>📹</span><span id="tkText">TikTok Reply: OFF</span></button>
  </div>
</div>`;
  }

  _panelSystem(tab) {
    const roomInfo = this._rooms ? `<div class="sys-info-item mb6"><div class="sys-label">Thiết bị đang chọn</div><div class="sys-value" style="color:#a78bfa">${this._esc(this._rooms[this._currentRoomIdx||0]?.name||"—")}</div><div style="font-size:10px;color:rgba(226,232,240,.4);margin-top:3px">${this._esc(this._rooms[this._currentRoomIdx||0]?.host||"—")}</div></div>` : '';
    return `
<div class="panel ${tab==="system"?"active":""}" id="p-system">
  ${roomInfo}
  <div class="sys-info-item"><div class="sys-label">CPU</div><div class="sys-value" id="cpuVal">0%</div><div class="stat-bar-wrap"><div class="stat-bar cpu" id="cpuBar" style="width:0%"></div></div></div>
  <div class="sys-info-item"><div class="sys-label">RAM</div><div class="sys-value" id="ramVal">0%</div><div class="stat-bar-wrap"><div class="stat-bar ram" id="ramBar" style="width:0%"></div></div></div>
  <div class="sys-info-item"><div class="sys-label">MAC Address</div>
  <div class="fx jcb aic"><div class="sys-value" id="macVal">--</div><span style="font-size:9px;color:rgba(226,232,240,.4)" id="macType"></span></div>
  <div class="fx g4 mt6"><button class="form-btn sm" id="btnMacGet">🔄</button><button class="form-btn sm" id="btnMacRandom">🔀 Random</button><button class="form-btn sm danger" id="btnMacReal">MAC thực</button></div></div>
  <div class="ctrl-section mt8"><div class="section-label">OTA Server</div><div class="form-row"><select class="form-inp" id="otaSel"></select></div><div class="fx g4"><button class="form-btn sm" id="btnOtaRefresh">🔄</button><button class="form-btn sm" id="btnOtaSave">💾 Lưu</button></div></div>
  <div class="ctrl-section mt8"><div class="section-label">Home Assistant</div>
  <div class="form-row"><div class="form-label">HA URL</div><input class="form-inp" id="hassUrl" placeholder="http://192.168.x.x:8123" /></div>
  <div class="form-row"><div class="form-label">Agent ID</div><input class="form-inp" id="hassAgent" placeholder="conversation.xxx" /></div>
  <div class="form-row"><div class="form-label">API Key</div><input class="form-inp" id="hassKey" placeholder="eyJ..." type="password" /></div>
  <button class="form-btn" id="btnHassSave">💾 Lưu HASS</button></div>
  <div class="ctrl-section mt8"><div class="section-label">WiFi</div>
  <div id="wifiStatusArea"></div>
  <div class="fx g4 mt6"><button class="form-btn sm" id="btnWifiScan">📡 Quét WiFi</button><button class="form-btn sm" id="btnWifiSavedRef">🔄 Đã lưu</button></div>
  <div id="wifiScanArea" class="mt6"></div><div id="wifiSavedArea" class="mt6"></div></div>
  <div class="sys-info-item mt8"><div class="sys-label">Kết nối</div>
  <div class="sys-value" style="font-size:10px">${this._esc(this._isHttps()?"HTTPS – tunnel WSS":"HTTP – WS LAN")} | ${this._isHttps() ? (this._tunnelWsUrl() ? `Tunnel: ${this._esc(this._tunnelWsUrl())}` : "Chưa có tunnel") : `LAN: ${this._esc(this._lanWsUrl())}`}</div></div>
</div>`;
  }

  _bind() {
    this._on("#btnCollapseCard", () => this._toggleCardCollapse());

    if (this._rooms) {
      this.querySelectorAll(".room-pill").forEach(pill => {
        pill.onclick = () => this._switchRoom(parseInt(pill.dataset.ridx));
      });
      this.querySelectorAll(".sync-cb").forEach(cb => {
        cb.onchange = () => {
          const idx = parseInt(cb.dataset.sidx);
          if (cb.checked) {
            this._syncRoomIdxs.add(idx);

            // Build play command TRƯỚC khi connect
            let pendingCmd = null;
            const m = this._state.media;
            if (m.isPlaying && this._config.sync_send_song !== false) {
              const zingSongId = m.songId || (m.source === "zing" ? this._lastZingSongId : "");
              if (m.source === "zing" && zingSongId) {
                pendingCmd = { action: "play_zing", song_id: zingSongId };
              } else if (m.videoId) {
                pendingCmd = { action: "play_song", video_id: m.videoId };
              } else if (m.url && m.source !== "zing") {
                pendingCmd = { action: "play_url", url: m.url, title: m.title, artist: m.artist, thumbnail_url: m.thumb };
              }
              if (!pendingCmd) {
                pendingCmd = this._buildPlayCmdFromCache(this._nowPlaying);
              }
            }

            // Pass pendingCmd vào connectMultiRoom — gửi ngay khi ws.onopen
            this._connectMultiRoom(idx, pendingCmd);

            if (pendingCmd) {
              // Schedule auto-sync sau khi bài đã phát ổn định
              setTimeout(() => {
                if (this._syncRoomIdxs.has(idx) && this._state.media.isPlaying) {
                  this._autoSyncDoneForSong = false;
                  this._lastSyncSongTitle = "";
                  this._scheduleAutoSync();
                }
              }, 4000);
            }

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
          this._renderSyncBar();
          this._renderRoomVolumeSliders();
        };
      });
    }

    this.querySelectorAll(".tab").forEach(b => { b.onclick = () => {
      const newTab = b.dataset.tab;
      if (newTab === this._activeTab) return;
      this._activeTab = newTab;
      this._render(); this._bind();
      if (this._wsConnected && !this._cardCollapsed) this._loadTab(newTab);
    }; });

    this._on("#btnWaveStyle", () => this._toggleWaveStyle());
    this._on("#seekWrap", null, el => {
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

    this._on("#btnPlayPause", () => {
      if (this._state.media.isPlaying) {
        this._broadcastCmd({ action: "pause" });
        this._broadcastSpkCmd({ type: 'send_message', what: 65536, arg1: 0, arg2: 1, obj: 'playorpause' });
      } else {
        this._broadcastCmd({ action: "resume" });
        this._broadcastSpkCmd({ type: 'send_message', what: 65536, arg1: 0, arg2: 1, obj: 'playorpause' });
      }
    });

    this._on("#btnStop", () => {
      this._resetNowPlayingCache();
      const m = this._state.media;
      m.position  = 0;
      m.duration  = 0;
      m.isPlaying = false;
      m.title     = "Không có nhạc";
      m.artist    = "---";
      m.thumb     = "";
      m.source    = null;
      // Guard: bỏ qua playback_state position từ server trong 3s tới
      this._stopGuardUntil = Date.now() + 3000;
      this._broadcastCmd({ action: "stop" });
      this._broadcastSpkCmd({ type: "send_message", what: 65536, arg1: 0, arg2: 1, obj: "stop" });
      // Cập nhật UI ngay lập tức
      this._updateProgressOnly();
      this._renderMedia();
      clearInterval(this._progressInterval);
      this._progressInterval = null;
    });

    this._on("#btnPrev", () => this._triggerMasterPrev());
    this._on("#btnNext", () => this._triggerMasterNext());
    this._on("#btnRepeat", () => this._send({ action: "toggle_repeat" }));
    this._on("#btnShuffle", () => this._send({ action: "toggle_auto_next" }));

    this.querySelectorAll(".stab").forEach(b => { b.onclick = () => {
      this._activeSearchTab = b.dataset.stab;
      this.querySelectorAll(".stab").forEach(x => x.classList.remove("active")); b.classList.add("active");
      const isPlaylists = b.dataset.stab === "playlists";
      const sb = this.querySelector("#searchBox"), pm = this.querySelector("#plMgr"), sr = this.querySelector("#searchResults");
      if (sb) sb.classList.toggle("hidden", isPlaylists);
      if (sr) sr.classList.toggle("hidden", isPlaylists);
      if (pm) pm.classList.toggle("hidden", !isPlaylists);
      if (isPlaylists) this._send({ action: "playlist_list" });
      else if (sr) sr.innerHTML = "";
    }; });
    this._on("#searchBtn", () => this._doSearch());
    const si = this.querySelector("#searchInp"); if (si) si.onkeypress = e => { if (e.key === "Enter") this._doSearch(); };

    this._on("#btnPlCreate", () => {
      this._showInputModal("Tên playlist mới", "VD: Nhạc buổi sáng", (name) => {
        if (name?.trim()) this._send({ action: "playlist_create", name: name.trim() });
      });
    });
    this._on("#btnPlRefresh", () => this._send({ action: "playlist_list" }));

    const vs = this.querySelector("#volSlider");
    if (vs) {
      vs.oninput = () => {
        const v = parseInt(vs.value, 10);
        this._volDragging = true;
        this._state.volume = v;
        const l = this.querySelector("#volLabel"); if (l) l.textContent = `Mức ${v}`;
        clearTimeout(this._volSendTimer);
        this._volSendTimer = setTimeout(() => this._broadcastVolume(v), 100);
        clearTimeout(this._volLockTimer);
        this._volLockTimer = setTimeout(() => { this._volDragging = false; }, 2000);
      };
      vs.onchange = () => {
        clearTimeout(this._volSendTimer);
        const v = parseInt(vs.value, 10);
        this._state.volume = v;
        this._broadcastVolume(v);
        clearTimeout(this._volLockTimer);
        this._volLockTimer = setTimeout(() => { this._volDragging = false; }, 2000);
      };
    }

    this._bindSwitch("#swLed", () => { this._ctrlGuard = Date.now(); this._state.ledEnabled = !this._state.ledEnabled; this._send({ action: "led_toggle" }); this._renderControlToggles(); });
    this._bindSwitch("#swDlna", () => { this._ctrlGuard = Date.now(); this._state.dlnaOpen = !this._state.dlnaOpen; this._sendSpk({ type: "Set_DLNA_Open", open: this._state.dlnaOpen ? 1 : 0 }); this._renderControlToggles(); });
    this._bindSwitch("#swAirplay", () => { this._ctrlGuard = Date.now(); this._state.airplayOpen = !this._state.airplayOpen; this._sendSpk({ type: "Set_AirPlay_Open", open: this._state.airplayOpen ? 1 : 0 }); this._renderControlToggles(); });
    this._bindSwitch("#swBt", () => {
      this._ctrlGuard = Date.now(); this._state.bluetoothOn = !this._state.bluetoothOn;
      if (this._state.bluetoothOn) { this._sendSpk({ type: "send_message", what: 64, arg1: 1, arg2: -1, type_id: "Open Bluetooth" }); }
      else { this._sendSpk({ type: "send_message", what: 64, arg1: 2, arg2: -1, type_id: "Close Bluetooth" }); }
      this._renderControlToggles();
    });

    const audioHdr = this.querySelector("#audioCollHeader");
    if (audioHdr) { audioHdr.onclick = () => { this._audioOpen = !this._audioOpen; const body = this.querySelector("#audioCollBody"), arrow = this.querySelector("#audioArrow"); if (body) body.classList.toggle("closed", !this._audioOpen); if (arrow) arrow.classList.toggle("open", this._audioOpen); if (this._audioOpen) this._buildEqBands(); }; }
    const lightHdr = this.querySelector("#lightCollHeader");
    if (lightHdr) { lightHdr.onclick = () => { this._lightOpen = !this._lightOpen; const body = this.querySelector("#lightCollBody"), arrow = this.querySelector("#lightArrow"); if (body) body.classList.toggle("closed", !this._lightOpen); if (arrow) arrow.classList.toggle("open", this._lightOpen); }; }

    this.querySelectorAll("[data-ltab]").forEach(b => { b.onclick = () => {
      this._activeLightTab = b.dataset.ltab;
      this.querySelectorAll("[data-ltab]").forEach(x => x.classList.remove("active")); b.classList.add("active");
      const lm = this.querySelector("#lightMain"), le = this.querySelector("#lightEdge");
      if (lm) lm.classList.toggle("hidden", b.dataset.ltab !== "main");
      if (le) le.classList.toggle("hidden", b.dataset.ltab !== "edge");
    }; });
    this._bindSwitch("#swLight", () => { this._ctrlGuard = Date.now(); this._state.lightEnabled = !this._state.lightEnabled; this._sendSpkMsg(64, this._state.lightEnabled ? 1 : 0); this._renderLight(); });
    this._bindSlider("#brightSlider", "#brightVal", v => { this._ctrlGuard = Date.now(); this._sendSpkMsg(65, v); }, v => v);
    this._bindSlider("#speedSlider", "#speedVal", v => { this._ctrlGuard = Date.now(); this._sendSpkMsg(66, v); }, v => v);
    this._bindSwitch("#swEdge", () => {
      this._ctrlGuard = Date.now(); this._state.edgeOn = !this._state.edgeOn;
      this._sendSpk({ type_id: 'Turn on light', type: 'shell', shell: this._state.edgeOn ? 'lights_test set 7fffff8000 ffffff' : 'lights_test set 7fffff8000 0' });
      this._updateSwitch("#swEdge", this._state.edgeOn);
    });
    this._bindSlider("#edgeSlider", "#edgeVal", v => {
      this._ctrlGuard = Date.now(); if (!this._state.edgeOn) return;
      const h = Math.round((v / 100) * 255).toString(16).padStart(2, '0');
      this._sendSpk({ type_id: 'Turn on light', type: 'shell', shell: `lights_test set 7fffff8000 ${h}${h}${h}` });
    }, v => v + "%");
    this.querySelectorAll("[data-lmode]").forEach(b => { b.onclick = () => { const mode = parseInt(b.dataset.lmode); this._sendSpkMsg(67, mode); this._state.lightMode = mode; }; });
    this.querySelectorAll("[data-atab]").forEach(b => { b.onclick = () => {
      this._activeAudioTab = b.dataset.atab;
      this.querySelectorAll("[data-atab]").forEach(x => x.classList.remove("active")); b.classList.add("active");
      const eq = this.querySelector("#audioEq"), sur = this.querySelector("#audioSur");
      if (eq) eq.classList.toggle("hidden", b.dataset.atab !== "eq");
      if (sur) sur.classList.toggle("hidden", b.dataset.atab !== "sur");
    }; });
    this._bindSwitch("#swEq", () => { this._audioGuard = Date.now(); this._state.eqEnabled = !this._state.eqEnabled; this._sendSpk({ type: "set_eq_enable", enable: this._state.eqEnabled }); this._updateSwitch("#swEq", this._state.eqEnabled); });
    this._buildEqBands();
    this.querySelectorAll("[data-pr]").forEach(b => { b.onclick = () => {
      this._audioGuard = Date.now(); const vals = EQ_PRESETS[b.dataset.pr]; if (!vals) return;
      vals.forEach((v, i) => { this._sendSpk({ type: "set_eq_bandlevel", band: i, level: parseInt(v) }); this._state.eqBands[i] = v; });
      this._renderEqBands();
    }; });
    this._bindSwitch("#swBass", () => { this._audioGuard = Date.now(); this._state.bass.enabled = !this._state.bass.enabled; this._sendSpk({ type: "set_bass_enable", enable: this._state.bass.enabled }); this._updateSwitch("#swBass", this._state.bass.enabled); });
    this._bindSlider("#bassSlider", "#bassVal", v => { this._audioGuard = Date.now(); this._sendSpk({ type: "set_bass_strength", strength: parseInt(v) }); }, v => Math.round(v / 10) + "%");
    this._bindSwitch("#swLoud", () => { this._audioGuard = Date.now(); this._state.loudness.enabled = !this._state.loudness.enabled; this._sendSpk({ type: "set_loudness_enable", enable: this._state.loudness.enabled }); this._updateSwitch("#swLoud", this._state.loudness.enabled); });
    this._bindSlider("#loudSlider", "#loudVal", v => { this._audioGuard = Date.now(); this._sendSpk({ type: "set_loudness_gain", gain: parseInt(v) }); }, v => (v / 100).toFixed(1) + " dB");
    this._bindSlider("#bvSlider", "#bvVal", v => { this._audioGuard = Date.now(); this._sendSpk({ type: "sends", list: [{ type: "setMixerValue", controlName: "DAC Digital Volume L", value: String(v) }, { type: "get_eq_config" }] }); }, v => this._dbStr(v));
    this._bindSlider("#hvSlider", "#hvVal", v => { this._audioGuard = Date.now(); this._sendSpk({ type: "sends", list: [{ type: "setMixerValue", controlName: "DAC Digital Volume R", value: String(v) }, { type: "get_eq_config" }] }); }, v => this._dbStr(v));
    this._bindSlider("#surW", "#surWVal", v => { this._audioGuard = Date.now(); this._sendSpkMsg(60, v); }, v => v);
    this._bindSlider("#surP", "#surPVal", null, v => v);
    this._bindSlider("#surS", "#surSVal", null, v => v);
    this.querySelectorAll("[data-sur]").forEach(b => { b.onclick = () => {
      this._audioGuard = Date.now(); let w, p, s;
      if (b.dataset.sur === "cinema") { w=70; p=50; s=30; } else if (b.dataset.sur === "wide") { w=90; p=40; s=60; } else { w=40; p=30; s=10; }
      this._setSlider("#surW", "#surWVal", w); this._setSlider("#surP", "#surPVal", p); this._setSlider("#surS", "#surSVal", s); this._sendSpkMsg(60, w);
    }; });

    this._bindSwitch("#swWake", () => { const en = !this._state.wakeWordEnabled; this._state.wakeWordEnabled = en; this._send({ action: "wake_word_set_enabled", enabled: en }); this._renderWakeWord(); });
    const wsl = this.querySelector("#wakeSlider");
    if (wsl) { wsl.oninput = () => { const v = this.querySelector("#wakeVal"); if (v) v.textContent = parseFloat(wsl.value).toFixed(2); }; wsl.onchange = () => this._send({ action: "wake_word_set_sensitivity", sensitivity: parseFloat(wsl.value) }); }
    this._bindSwitch("#swCustomAi", () => { const en = !this._state.customAiEnabled; this._state.customAiEnabled = en; this._send({ action: "custom_ai_set_enabled", enabled: en }); this._renderCustomAi(); });
    const vsel = this.querySelector("#voiceSel"); if (vsel) vsel.onchange = () => this._send({ action: "voice_id_set", voice_id: parseInt(vsel.value) });
    this._on("#btnVoicePv", () => { const vid = parseInt(this.querySelector("#voiceSel")?.value || 1); const a = new Audio(VBASE + (VFILES[vid] || 'ngocanh') + '.mp3'); a.play().catch(() => this._toast("Không phát được", "error")); });
    const l2d = this.querySelector("#live2dSel"); if (l2d) l2d.onchange = () => this._send({ action: "live2d_set_model", model: l2d.value });
    this._on("#btnAlarmAdd", () => this._showAlarmModal());
    this._on("#btnAlarmRefresh", () => this._send({ action: "alarm_list" }));
    this._renderAlarms();

    this._on("#chatSend", () => this._sendChat());
    const ci = this.querySelector("#chatInp"); if (ci) ci.onkeypress = e => { if (e.key === "Enter") this._sendChat(); };
    this._on("#btnSession", () => { this._send({ action: "chat_wake_up" }); });
    this._on("#btnTestMic", () => this._send({ action: "chat_test_mic" }));
    this._on("#btnChatClear", () => { this._state.chat = []; this._renderChatMsgs(); this._toast("Đã xóa lịch sử chat", "success"); this._send({ action: "chat_clear_history" }); });
    this._on("#btnTikTok", () => { const v = !this._state.tiktokReply; this._state.tiktokReply = v; this._renderTikTok(); this._send({ action: "tiktok_reply_toggle", enabled: v }); });

    this._on("#btnMacGet", () => this._send({ action: "mac_get" }));
    this._on("#btnMacRandom", () => { if (confirm("⚠ Random MAC sẽ mất quyền. Tiếp tục?")) this._send({ action: "mac_random" }); });
    this._on("#btnMacReal", () => this._send({ action: "mac_clear" }));
    this._on("#btnOtaRefresh", () => this._send({ action: "ota_get" }));
    this._on("#btnOtaSave", () => { const v = this.querySelector("#otaSel")?.value; if (v) this._send({ action: "ota_set", ota_url: v }); });
    this._on("#btnHassSave", () => { this._send({ action: "hass_set", url: this.querySelector("#hassUrl")?.value?.trim() || "", agent_id: this.querySelector("#hassAgent")?.value?.trim() || "", api_key: this.querySelector("#hassKey")?.value?.trim() || undefined }); });
    this._on("#btnWifiScan", () => this._send({ action: "wifi_scan" }));
    this._on("#btnWifiSavedRef", () => this._send({ action: "wifi_get_saved" }));

    setTimeout(() => { this._renderSyncBar(); this._renderRoomVolumeSliders(); }, 0);
  }

  _on(sel, fn, cb) { const el = this.querySelector(sel); if (!el) return; if (fn) el.onclick = fn; if (cb) cb(el); }
  _bindSwitch(sel, fn) { const el = this.querySelector(sel); if (el) el.onclick = fn; }
  _bindSlider(sliderId, valId, sendFn, fmtFn) {
    const s = this.querySelector(sliderId); if (!s) return;
    s.oninput = () => { const v = this.querySelector(valId); if (v && fmtFn) v.textContent = fmtFn(parseInt(s.value)); };
    if (sendFn) s.onchange = () => sendFn(parseInt(s.value));
  }
  _setSlider(sliderId, valId, rawVal, displayVal) {
    const s = this.querySelector(sliderId); if (s) s.value = rawVal;
    const v = this.querySelector(valId); if (v) v.textContent = displayVal !== undefined ? displayVal : rawVal;
  }

  _buildEqBands() {
    const c = this.querySelector("#eqBands"); if (!c) return;
    c.innerHTML = EQ_LABELS.map((f, i) => {
      const v = this._state.eqBands[i] || 0, dv = v > 0 ? `+${v}` : `${v}`;
      return `<div class="eq-band"><div class="eq-band-val" id="eqVal${i}">${dv}</div><input type="range" min="-1500" max="1500" step="100" value="${v}" orient="vertical" data-band="${i}" /><label>${f}</label></div>`;
    }).join('');
    c.querySelectorAll("input").forEach(inp => { inp.oninput = () => {
      this._audioGuard = Date.now(); const v = parseInt(inp.value);
      const vl = this.querySelector(`#eqVal${inp.dataset.band}`); if (vl) vl.textContent = v > 0 ? `+${v}` : `${v}`;
      this._sendSpk({ type: "set_eq_bandlevel", band: parseInt(inp.dataset.band), level: v });
    }; });
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
      return `<div class="result-item" data-idx="${i}">${thumb ? `<img class="result-thumb" src="${this._esc(thumb)}" onerror="this.style.display='none'" />` : '<div class="result-thumb">🎵</div>'}
<div class="result-info"><div class="result-title">${this._esc(title)}</div><div class="result-sub">${this._esc(sub)}${dur ? " · " + dur : ""}</div></div>
<div class="result-btns"><button class="rbtn rbtn-add" data-addidx="${i}" title="Thêm vào playlist">+</button><button class="rbtn rbtn-play" data-playidx="${i}">▶ Phát</button></div></div>`;
    }).join("");
    items.forEach((item, i) => {
      // ── FIX 4: Add button ─────────────────────────
      const addBtn = el.querySelector(`[data-addidx="${i}"]`);
      if (addBtn) addBtn.onclick = (e) => {
        e.stopPropagation();
        this._send({ action: "playlist_list" });
        setTimeout(() => this._showAddToPlaylistModal(item, type), 100);
      };

      // ── Play button (giữ nguyên) ──────────────────
      const playBtn = el.querySelector(`[data-playidx="${i}"]`);
      if (playBtn) playBtn.onclick = (e) => {
        let cmd;
        if (type === "playlist") {
          cmd = { action: "playlist_play", playlist_id: item.playlist_id || item.id };
        } else if (type === "zing") {
          const sid = item.song_id || item.id;
          this._lastZingSongId      = sid;
          this._state.media.songId  = sid;
          this._nowPlaying = {
            source:    "zing",
            songId:    sid,
            videoId:   "",
            url:       "",
            title:     item.title  || item.name || "",
            artist:    item.artist || item.channel || "",
            thumb:     item.thumbnail_url || "",
            position:  0,
            duration:  item.duration_seconds || 0,
            isPlaying: true,
          };
          cmd = { action: "play_zing", song_id: sid };
        } else {
          const vid = item.video_id || item.id;
          this._nowPlaying = {
            source:    "youtube",
            songId:    "",
            videoId:   vid,
            url:       "",
            title:     item.title  || item.name || "",
            artist:    item.artist || item.channel || "",
            thumb:     item.thumbnail_url || "",
            position:  0,
            duration:  item.duration_seconds || 0,
            isPlaying: true,
          };
          cmd = { action: "play_song", video_id: vid };
        }
        this._broadcastCmd(cmd);
        this._autoSyncDoneForSong = false;
        this._lastSyncSongTitle   = "";
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
      this._on(`[data-plplay="${i}"]`, () => {
        // Request playlist songs để populate _songCache
        this._send({ action: "playlist_get_songs", playlist_id: pl.id });
        this._send({ action: "playlist_play", playlist_id: pl.id });
        this._toast(`▶ ${pl.name}`, "success");
      });
      this._on(`[data-plview="${i}"]`, () => this._send({ action: "playlist_get_songs", playlist_id: pl.id }));
      this._on(`[data-pldel="${i}"]`, () => { if (confirm(`Xóa "${pl.name}"?`)) { this._send({ action: "playlist_delete", playlist_id: pl.id }); } });
    });
  }

  _handleMsg(raw) {
    let d; try { d = JSON.parse(raw); } catch { return; }
    try { this._handleMsgInner(d); } catch(e) {}
  }

  _handleMsgInner(d) {
    if (d.type === "chat_message") { const isUser = d.message_type === "user"; this._addChatMsg(d.content || "", isUser ? "user" : "server"); return; }
    if (d.type === "chat_state") {
      const st = d.state || "";
      this._state.chatSessionActive = ["connecting","listening","speaking","thinking"].includes(st);
      this._state.chatSpeaking = st === "speaking";
      if (d.button_text) this._state.chatBtnText = d.button_text;
      if (d.button_enabled !== undefined) this._state.chatBtnEnabled = d.button_enabled;
      this._renderSessionBtn(); return;
    }
    if (d.type === "chat_history" && Array.isArray(d.messages)) {
      this._chatLoaded = true;
      if (this._state.chat.length === 0) { this._state.chat = d.messages.map(m => ({ type: m.type || m.message_type || "server", content: m.content || "", ts: m.ts || Date.now() })); this._renderChatMsgs(); }
      return;
    }
    if (d.type === "chat_history_cleared" || d.type === "chat_clear_history_result") { this._state.chat = []; this._chatLoaded = true; this._renderChatMsgs(); return; }
    if (d.type === "chat_background" || d.type === "chat_background_result") { this._state.chatBg64 = d.image || d.base64 || ""; this._renderChatBg(); return; }
    if (d.type === "tiktok_reply_state" || d.type === "tiktok_reply_result") { this._state.tiktokReply = !!d.enabled; this._renderTikTok(); return; }
    if (d.type === "led_state" || d.type === "led_get_state_result" || d.type === "led_toggle_result") { if (d.enabled !== undefined) this._state.ledEnabled = !!d.enabled; this._renderControlToggles(); return; }
    if (d.type === "ota_config" || d.type === "ota_get_result" || d.type === "ota_set_result") { if (d.ota_url !== undefined) this._state.otaUrl = d.ota_url; if (Array.isArray(d.options)) this._state.otaOptions = d.options; this._renderOta(); return; }
    if (d.type === "hass_config" || d.type === "hass_get_result" || d.type === "hass_set_result") { this._state.hassUrl = d.url || ""; this._state.hassAgentId = d.agent_id || ""; this._state.hassConfigured = !!d.configured; if (d.api_key === "***") this._state.hassApiKeyMasked = true; this._renderHass(); return; }
    if (d.type === "wifi_scan_result") { this._state.wifiNetworks = d.networks || []; this._renderWifiScan(); return; }
    if (["wifi_status","wifi_get_status_result","wifi_status_result","wifi_info"].includes(d.type)) { this._state.wifiStatus = d; this._renderWifiStatus(); return; }
    if (d.type === "wifi_saved_result" || d.type === "wifi_saved_list") { this._state.wifiSaved = d.networks || []; this._renderWifiSaved(); return; }
    if (d.type === "search_result") {
      const songs = d.songs || d.results || [];
      // Reset _songCache với kết quả YouTube mới
      this._songCache = songs.map(s => ({ source: "youtube", id: s.video_id || s.id, title: s.title || "", artist: s.channel || s.artist || "", thumb: s.thumbnail_url || "", duration: s.duration_seconds || 0 }));
      this._renderSearchResults(songs, "youtube"); return;
    }
    if (d.type === "zing_result") {
      const songs = d.songs || d.results || [];
      // Reset _songCache với kết quả Zing mới
      this._songCache = songs.map(s => ({ source: "zing", id: s.song_id || s.id, title: s.title || "", artist: s.artist || "", thumb: s.thumbnail_url || "", duration: s.duration_seconds || 0 }));
      this._renderSearchResults(songs, "zing"); return;
    }
    if (d.type === "playlist_result") { this._renderSearchResults(d.songs || d.playlists || d.results || [], "playlist"); return; }
    if (d.type === "playlist_list_result") { this._renderPlaylistList(d.playlists || []); return; }
    if (d.type === "playlist_created") {
      this._toast(`✅ Đã tạo playlist: ${this._esc(d.playlist?.name || "")}`, "success");
      this._send({ action: "playlist_list" }); return;
    }
    if (d.type === "playlist_deleted") {
      this._toast("🗑 Đã xóa playlist", "success");
      this._send({ action: "playlist_list" }); return;
    }
    if (d.type === "playlist_song_added") {
      this._toast("✅ Đã thêm bài vào playlist", "success"); return;
    }
    if (d.type === "playlist_song_removed") {
      this._toast("🗑 Đã xóa bài khỏi playlist", "success"); return;
    }
    if (d.type === "playlist_play_started") {
      this._activePlaylistId = d.playlist_id ?? null;
      // Reset cache cũ, fetch bài mới từ playlist để nạp vào _songCache
      this._songCache = [];
      if (this._activePlaylistId != null) {
        this._send({ action: "playlist_get_songs", playlist_id: this._activePlaylistId });
      }
      this._toast(`▶ Đang phát: ${this._esc(d.playlist_name || "")}`, "success"); return;
    }
    if (d.type === "playlist_songs_result") {
      this._state.playlistSongs = d.songs || [];
      const plId = d.playlist_id;
      // Lưu vào _songCache (reset toàn bộ bằng bài trong playlist)
      this._songCache = (d.songs || []).map(s => ({
        source:   s.source || "youtube",
        id:       s.id || s.song_id || s.video_id || "",
        title:    s.title || "",
        artist:   s.artist || s.channel || "",
        thumb:    s.thumbnail_url || "",
        duration: s.duration_seconds || 0,
      }));
      // Retry nếu đang chờ gửi sang rooms (playlist cache vừa về)
      if (this._pendingNextTitle) {
        const cached = this._lookupSongByTitle(this._pendingNextTitle);
        if (cached) {
          this._pendingNextTitle = null;
          const targets = this._getSyncTargets();
          const playCmd = cached.source === "zing"
            ? { action: "play_zing", song_id: cached.id, title: cached.title, artist: cached.artist, thumbnail_url: cached.thumb }
            : { action: "play_song", video_id: cached.id, title: cached.title, artist: cached.artist, thumbnail_url: cached.thumb };
          // Stop trước, gửi play tuần tự
          targets.forEach(idx => this._sendToRoom(idx, { action: "stop" }));
          targets.forEach((idx, i) => setTimeout(() => {
            if (this._switching) return;
            this._sendToRoom(idx, playCmd);
          }, i * 300 + 100));
        }
      }
      const el = this.querySelector("#plSongs"); if (!el) return;
      el.classList.remove("hidden");
      el.innerHTML = `<div class="fx jcb aic mb6"><span style="font-size:10px;font-weight:700;color:rgba(226,232,240,.6)">📋 ${this._esc(d.playlist_name||'')} (${(d.songs||[]).length} bài)</span><button class="form-btn sm" id="closePlSongs">✕</button></div>` +
        (d.songs?.length ? d.songs.map((s, i) => `<div class="result-item">
          ${s.thumbnail_url ? `<img class="result-thumb" src="${this._esc(s.thumbnail_url)}" onerror="this.style.display='none'" />` : '<div class="result-thumb">🎵</div>'}
          <div class="result-info"><div class="result-title">${this._esc(s.title || "?")}</div><div class="result-sub">${this._esc(s.artist||'')}${s.duration_seconds ? ' · ' + this._fmtTime(s.duration_seconds) : ''}</div></div>
          <div class="result-btns">
            <button class="rbtn rbtn-play" data-plsplay="${i}">▶</button>
            <button class="form-btn sm danger" data-rmsong="${i}">✕</button>
          </div></div>`).join("") : '<div style="text-align:center;padding:8px;font-size:10px;color:rgba(226,232,240,.4)">Trống</div>');
      this._on("#closePlSongs", () => el.classList.add("hidden"));
      // Play song in playlist
      el.querySelectorAll("[data-plsplay]").forEach(btn => {
        btn.onclick = () => {
          const sidx = parseInt(btn.dataset.plsplay);
          const s = (d.songs||[])[sidx]; if (!s) return;
          let cmd;
          if (s.source === "zing") {
            const sid = s.id || s.song_id || "";
            this._lastZingSongId = sid;
            this._nowPlaying = {
              source: "zing", songId: sid, videoId: "", url: "",
              title: s.title || "", artist: s.artist || "",
              thumb: s.thumbnail_url || "",
              position: 0, duration: s.duration_seconds || 0, isPlaying: true,
            };
            cmd = { action: "play_zing", song_id: sid };
          } else {
            const vid = s.id || s.video_id || "";
            this._nowPlaying = {
              source: "youtube", songId: "", videoId: vid, url: "",
              title: s.title || "", artist: s.artist || "",
              thumb: s.thumbnail_url || "",
              position: 0, duration: s.duration_seconds || 0, isPlaying: true,
            };
            cmd = { action: "play_song", video_id: vid };
          }
          this._broadcastCmd(cmd);
          this._toast(`▶ ${this._esc(s.title||'')}`, "success");
        };
      });
      // Remove song
      el.querySelectorAll("[data-rmsong]").forEach(btn => {
        btn.onclick = () => {
          const sidx = parseInt(btn.dataset.rmsong);
          if (confirm(`Xóa bài #${sidx + 1} khỏi playlist?`)) {
            this._send({ action: "playlist_remove_song", playlist_id: plId, song_index: sidx });
            this._toast("🗑 Đã xóa bài hát", "success");
            setTimeout(() => this._send({ action: "playlist_get_songs", playlist_id: plId }), 300);
          }
        };
      });
      return;
    }
    if (d.type === "wake_word_enabled_state" || d.type === "wake_word_get_enabled_result") { if (d.enabled !== undefined) this._state.wakeWordEnabled = !!d.enabled; this._renderWakeWord(); return; }
    if (d.type === "wake_word_sensitivity_state" || d.type === "wake_word_get_sensitivity_result") { if (d.sensitivity !== undefined) this._state.wakeWordSensitivity = Number(d.sensitivity); this._renderWakeWord(); return; }
    if (d.type === "custom_ai_state" || d.type === "custom_ai_enabled_state" || d.type === "custom_ai_get_enabled_result") { if (d.enabled !== undefined) this._state.customAiEnabled = !!d.enabled; this._renderCustomAi(); return; }
    if (d.type === "voice_id_state" || d.type === "voice_id_get_result") { if (d.voice_id !== undefined) this._state.voiceId = parseInt(d.voice_id); this._renderVoice(); return; }
    if (d.type === "live2d_model" || d.type === "live2d_get_model_result") { if (d.model) this._state.live2dModel = d.model; const sel = this.querySelector("#live2dSel"); if (sel && d.model) sel.value = d.model; return; }
    if (d.type === "alarm_list" || d.type === "alarm_list_result") { this._state.alarms = d.alarms || []; this._renderAlarms(); return; }
    if (d.type === "alarm_added") {
      if (d.alarm) { this._state.alarms.push(d.alarm); this._renderAlarms(); } else this._send({ action: "alarm_list" });
      this._toast(`✅ Đã thêm báo thức lúc ${d.alarm ? String(d.alarm.hour).padStart(2,'0')+':'+String(d.alarm.minute).padStart(2,'0') : ''}`, "success"); return;
    }
    if (d.type === "alarm_edited") {
      if (d.alarm) { const idx = this._state.alarms.findIndex(a => a.id === d.alarm.id); if (idx >= 0) this._state.alarms[idx] = d.alarm; else this._state.alarms.push(d.alarm); this._renderAlarms(); } else this._send({ action: "alarm_list" });
      this._toast(`✏️ Đã cập nhật báo thức #${d.alarm?.id ?? ''}`, "success"); return;
    }
    if (d.type === "alarm_deleted") {
      const delId = d.id ?? d.alarm_id ?? this._pendingDeleteId; this._pendingDeleteId = null;
      if (delId !== undefined && delId !== null) { this._state.alarms = this._state.alarms.filter(a => a.id !== delId); this._renderAlarms(); } else { this._send({ action: "alarm_list" }); }
      this._toast(`🗑 Đã xóa báo thức`, "success"); return;
    }
    if (d.type === "alarm_toggled") {
      if (d.alarm) { const idx = this._state.alarms.findIndex(a => a.id === d.alarm.id); if (idx >= 0) { this._state.alarms[idx].enabled = d.alarm.enabled; this._renderAlarms(); } else this._send({ action: "alarm_list" }); }
      else { this._send({ action: "alarm_list" }); } return;
    }
    if (d.type === "alarm_triggered") { this._toast("⏰ " + (d.message || "Báo thức!"), "success"); return; }
    if (["mac_get","mac_get_result","mac_random","mac_random_result","mac_clear","mac_clear_result","mac_result"].includes(d.type)) {
      if (d.mac_address || d.mac) { this._state.macAddress = d.mac_address || d.mac; this._state.macIsCustom = !!(d.is_custom ?? d.custom ?? d.is_spoofed ?? d.spoofed ?? (d.mac_type === "custom") ?? false); }
      const mv = this.querySelector("#macVal"); if (mv) mv.textContent = this._state.macAddress || "--";
      const mt = this.querySelector("#macType"); if (mt) { mt.textContent = this._state.macIsCustom ? "🔀 Custom" : "📡 Real"; mt.style.color = this._state.macIsCustom ? "#fbbf24" : "#86efac"; } return;
    }
    if (d.type === "premium_status") { this._state.premium = d.premium; if (d.qr_code_base64) this._state.premQrB64 = d.qr_code_base64; this._renderPremium(); return; }
    if (d.type === "playback_state") {
      // Nếu vừa stop, không cho server restore lại position/duration
      if (this._stopGuardUntil && Date.now() < this._stopGuardUntil) {
        if (!d.is_playing) {
          d = { ...d, position: 0, duration: 0 };
        }
      }
      const m = this._state.media;
      const wasPlaying = m.isPlaying;
      const prevTitle = m.title;
      const newTitle = d.title || "";
      if (this._syncInProgress && newTitle && prevTitle && newTitle !== prevTitle) {
        this._syncInProgress = false; this._syncGen++;
        this._toast("⚠️ Bài thay đổi — huỷ sync", "error");
      }
      m.source = d.source || "youtube"; m.isPlaying = !!d.is_playing;
      m.title = d.title || "Không có nhạc"; m.artist = d.artist || d.channel || "---";
      m.thumb = d.thumbnail_url || "";
      // FIX: Xóa stale track IDs khi title đổi — tránh gửi sai bài cho rooms
      if (newTitle && prevTitle && newTitle !== prevTitle) {
        m.videoId = "";
        m.songId  = "";
        m.url     = "";
        this._lastZingSongId = "";
      }
      if (d.url) m.url = d.url;
      if (d.video_id) m.videoId = d.video_id;
      // API Zing không trả song_id trong playback_state → dùng _lastZingSongId
      if (d.song_id) { m.songId = d.song_id; if (m.source === "zing") this._lastZingSongId = d.song_id; }
      else if (m.source === "zing" && this._lastZingSongId) { m.songId = this._lastZingSongId; }
      else if (m.source !== "zing") { m.songId = ""; }
      if (d.id && !m.videoId && !m.songId) {
        if (m.source === "zing") { m.songId = d.id; this._lastZingSongId = d.id; }
        else m.videoId = d.id;
      }
      if (!(this._posSyncGuardUntil && Date.now() < this._posSyncGuardUntil)) {
        m.position = Number(d.position || 0);
      }
      m.duration = Number(d.duration || 0);
      if (d.auto_next_enabled !== undefined) m.autoNext = !!d.auto_next_enabled;
      if (d.repeat_enabled !== undefined) m.repeat = !!d.repeat_enabled;
      if (d.shuffle_enabled !== undefined) m.shuffle = !!d.shuffle_enabled;
      if (d.volume !== undefined && !(this._volSyncGuardUntil && Date.now() < this._volSyncGuardUntil)) this._state.volume = Number(d.volume);

      // ── FIX STOP: reset cache nếu server báo dừng hẳn ────────
      if (!m.isPlaying && m.position === 0 && m.duration === 0) {
        this._resetNowPlayingCache();
      } else {
        this._updateNowPlayingCache();
      }

      // ── Đồng bộ bài hát sang rooms khi master chuyển bài ────────────────
      // _pendingRoomCmd: null=auto-next | "next"/"prev"=manual | "broadcast"=direct play
      // ── Đồng bộ bài hát sang rooms khi master chuyển bài ────────────────
      // _pendingRoomCmd: "next"/"prev" = manual | "broadcast" = direct play | null = auto-next
      //
      // YouTube: thumbnail_url chứa video_id → extract và gửi play_song trực tiếp
      // Zing: không có song_id trong playback_state → gửi "next" (rooms tự advance queue)
      //
      if (newTitle && newTitle !== prevTitle) {
        const prc = this._pendingRoomCmd;
        if (prc === "broadcast") {
          // Direct play: rooms đã nhận lệnh → chỉ clear
          this._pendingRoomCmd = null;
        } else {
          // Manual next/prev hoặc auto-next: chờ is_playing=true rồi gửi play cmd trực tiếp
          if (!this._pendingNextTitle) {
            this._pendingNextTitle = newTitle;
          }
          this._pendingRoomCmd = null;
        }
        this._autoSyncDoneForSong = false;
        this._lastSyncSongTitle   = "";
      }

      // ── Fire: is_playing=true + có title mới → tra _songCache rồi gửi tuần tự ──
      if (this._pendingNextTitle && this._pendingNextTitle === m.title && m.isPlaying) {
        const waitTitle = this._pendingNextTitle;
        const targets = this._getSyncTargets();

        // Helper gửi lần lượt sang rooms (stop trước, play sau)
        const _sendSeq = (playCmd) => {
          this._pendingNextTitle = null;
          if (!targets.length || this._config.sync_send_song === false) return;
          // 1. Stop tất cả rooms ngay lập tức
          targets.forEach(idx => this._sendToRoom(idx, { action: "stop" }));
          // 2. Gửi play cmd tuần tự cách 300ms/phòng
          targets.forEach((idx, i) => {
            setTimeout(() => {
              if (this._switching) return;
              this._sendToRoom(idx, playCmd);
            }, i * 300 + 100); // +100ms sau stop
          });
        };

        if (targets.length > 0 && this._config.sync_send_song !== false) {
          // 1. Tra _songCache (kết quả search / bài trong playlist đã load)
          const cached = this._lookupSongByTitle(waitTitle);
          if (cached) {
            const playCmd = cached.source === "zing"
              ? { action: "play_zing", song_id: cached.id, title: cached.title, artist: cached.artist, thumbnail_url: cached.thumb }
              : { action: "play_song", video_id: cached.id, title: cached.title, artist: cached.artist, thumbnail_url: cached.thumb };
            _sendSeq(playCmd);

          } else if (m.source === "youtube") {
            // 2. Fallback YouTube: extract video_id từ thumbnail URL (luôn có)
            const vid = this._extractYtVideoId(m.thumb);
            _sendSeq(vid
              ? { action: "play_song", video_id: vid, title: m.title, artist: m.artist, thumbnail_url: m.thumb }
              : { action: "next" });

          } else if (m.source === "zing" && this._activePlaylistId) {
            // 3. Zing + đang phát playlist → re-fetch để lấy song_id rồi retry
            // _pendingNextTitle giữ nguyên, sau khi playlist_songs_result về sẽ retry
            this._send({ action: "playlist_get_songs", playlist_id: this._activePlaylistId });
            // pendingNextTitle chưa null → sẽ được xử lý trong playlist_songs_result

          } else if (m.source === "zing" && this._lastZingSongId) {
            // 4. Fallback Zing: dùng _lastZingSongId
            _sendSeq({ action: "play_zing", song_id: this._lastZingSongId, title: m.title, artist: m.artist, thumbnail_url: m.thumb });

          } else {
            // 5. Không có gì → next
            _sendSeq({ action: "next" });
          }
        }
      }
      if (m.isPlaying && newTitle !== prevTitle) {
        clearTimeout(this._autoSyncTimer);
        this._autoSyncDoneForSong = false;
        this._scheduleAutoSync();
      }

      this._renderMedia();
      this._renderVolume();
      return;
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

  _renderControlToggles() {
    this._updateSwitch("#swLed", this._state.ledEnabled);
    this._updateSwitch("#swDlna", this._state.dlnaOpen);
    this._updateSwitch("#swAirplay", this._state.airplayOpen);
    this._updateSwitch("#swBt", this._state.bluetoothOn);
  }

  _renderLight() {
    this._updateSwitch("#swLight", this._state.lightEnabled);
    const b = this.querySelector("#brightSlider"), bv = this.querySelector("#brightVal");
    const s = this.querySelector("#speedSlider"), sv = this.querySelector("#speedVal");
    if (b) b.value = this._state.brightness; if (bv) bv.textContent = this._state.brightness;
    if (s) s.value = this._state.speed; if (sv) sv.textContent = this._state.speed;
  }

  _updateSwitch(sel, state) {
    const el = this.querySelector(sel); if (!el) return;
    if (state === null || state === undefined) { el.classList.remove("on"); el.classList.add("unknown"); }
    else { el.classList.remove("unknown"); el.classList.toggle("on", !!state); }
  }

  _renderWakeWord() {
    this._updateSwitch("#swWake", this._state.wakeWordEnabled);
    const row = this.querySelector("#wakeSensRow"); if (row) row.style.display = this._state.wakeWordEnabled ? "block" : "none";
    const sl = this.querySelector("#wakeSlider"), val = this.querySelector("#wakeVal");
    if (sl && this._state.wakeWordSensitivity !== null) { sl.value = this._state.wakeWordSensitivity; if (val) val.textContent = Number(this._state.wakeWordSensitivity).toFixed(2); }
  }

  _renderCustomAi() {
    this._updateSwitch("#swCustomAi", this._state.customAiEnabled);
    const isPrem = this._state.premium === 1, show = isPrem || this._state.customAiEnabled !== null;
    const cr = this.querySelector("#customAiRow"); if (cr) cr.style.display = show ? "flex" : "none";
    const vr = this.querySelector("#voiceRow"); if (vr) vr.style.display = (show && this._state.customAiEnabled) ? "block" : "none";
    const lr = this.querySelector("#live2dRow"); if (lr) lr.style.display = isPrem ? "block" : "none";
  }

  _renderVoice() { const sel = this.querySelector("#voiceSel"); if (sel && this._state.voiceId) sel.value = this._state.voiceId; }

  _renderOta() {
    const sel = this.querySelector("#otaSel"); if (!sel) return;
    const nm = { 'https://api.tenclass.net/xiaozhi/ota/': 'Xiaozhi', 'https://ai-box.vn/ota/': 'AI-BOX.VN' };
    if (this._state.otaOptions) { sel.innerHTML = this._state.otaOptions.map(o => `<option value="${this._esc(o)}" ${o === this._state.otaUrl ? "selected" : ""}>${nm[o] || o}</option>`).join(""); }
    else if (this._state.otaUrl) { sel.innerHTML = `<option value="${this._esc(this._state.otaUrl)}" selected>${nm[this._state.otaUrl] || this._state.otaUrl}</option>`; }
  }

  _renderHass() {
    const u = this.querySelector("#hassUrl"), a = this.querySelector("#hassAgent"), k = this.querySelector("#hassKey");
    if (u) u.value = this._state.hassUrl; if (a) a.value = this._state.hassAgentId;
    if (k && this._state.hassApiKeyMasked) k.placeholder = "*** (đã lưu)";
  }

  _renderWifiStatus() {
    const el = this.querySelector("#wifiStatusArea"); if (!el) return;
    const w = this._state.wifiStatus;
    if (!w) { el.innerHTML = '<div class="sys-info-item"><div class="sys-value" style="color:rgba(226,232,240,.4)">Đang tải WiFi...</div></div>'; return; }
    const ssid = w.current_ssid || w.ssid || w.SSID || w.connected_ssid || "", ip = w.ip_address || w.ip || w.ipv4 || "---";
    const rssi = w.rssi || w.signal || "--", connected = w.is_connected ?? (ssid !== "");
    el.innerHTML = `<div class="sys-info-item"><div class="sys-label">WiFi hiện tại</div><div class="sys-value" style="color:${connected ? '#86efac' : 'rgba(226,232,240,.4)'}">${connected ? this._esc(ssid) : "Không có kết nối"}</div><div style="font-size:10px;color:rgba(226,232,240,.5);margin-top:3px">${connected ? `IP: ${this._esc(ip)}${rssi !== "--" ? " | RSSI: " + rssi + " dBm" : ""}` : "WiFi chưa kết nối"}</div></div>`;
  }

  _renderWifiSaved() {
    const el = this.querySelector("#wifiSavedArea"); if (!el || !this._state.wifiSaved.length) return;
    el.innerHTML = '<div style="font-size:10px;font-weight:700;color:rgba(226,232,240,.45);margin-bottom:4px">Đã lưu</div>' +
      this._state.wifiSaved.map((n, i) => { const ssid = n.ssid || n; return `<div class="wifi-item"><span class="wifi-ssid">📶 ${this._esc(ssid)}</span><button class="form-btn sm danger" data-wfdel="${i}">✕</button></div>`; }).join("");
    this._state.wifiSaved.forEach((n, i) => { this._on(`[data-wfdel="${i}"]`, () => this._send({ action: "wifi_delete_saved", ssid: n.ssid || n })); });
  }

  _renderWifiScan() {
    const el = this.querySelector("#wifiScanArea"); if (!el) return;
    el.innerHTML = this._state.wifiNetworks.map(n => `<div class="wifi-item" data-wfssid="${this._esc(n.ssid)}"><div><div class="wifi-ssid">📶 ${this._esc(n.ssid)}</div><div class="wifi-rssi">${n.rssi || ""} dBm ${n.secured ? "🔒" : ""}</div></div></div>`).join("");
    this._state.wifiNetworks.forEach(n => {
      const item = el.querySelector(`[data-wfssid="${this._esc(n.ssid)}"]`);
      if (item) item.onclick = () => {
        this._showPasswordModal(n.ssid, (pw) => {
          if (pw !== null) this._send({ action: "wifi_connect", ssid: n.ssid, password: pw });
        });
      };
    });
  }

  _renderChatMsgs(scroll = true) {
    const box = this.querySelector("#chatMsgs"); if (!box) return;
    if (!this._state.chat.length) { box.innerHTML = '<div style="text-align:center;padding:30px 0;color:rgba(226,232,240,.4);font-size:12px">Chưa có tin nhắn</div>'; return; }
    box.innerHTML = this._state.chat.map(m => `<div class="mrow ${m.type === "user" ? "user" : "server"}"><div class="bubble ${m.type === "user" ? "user" : "server"}">${this._esc(m.content)}</div></div>`).join("");
    if (scroll) box.scrollTop = box.scrollHeight;
  }

  _renderChatBg() {
    const img = this.querySelector("#chatBg"); if (!img) return;
    const b = (this._state.chatBg64 || "").trim();
    if (this._config.show_background && b) { img.src = "data:image/jpeg;base64," + b; img.style.display = "block"; }
    else { img.style.display = "none"; img.removeAttribute("src"); }
  }

  _renderTikTok() {
    const dot = this.querySelector("#tkDot"), txt = this.querySelector("#tkText");
    if (dot) dot.classList.toggle("on", !!this._state.tiktokReply);
    if (txt) txt.textContent = `TikTok Reply: ${this._state.tiktokReply ? "ON" : "OFF"}`;
  }

  _renderSessionBtn() {
    const btn = this.querySelector("#btnSession"); if (!btn) return;
    const active = this._state.chatSessionActive, speaking = this._state.chatSpeaking;
    const serverText = this._state.chatBtnText || "", serverEnabled = this._state.chatBtnEnabled;
    btn.classList.remove("session-active", "interrupt");
    if (serverText) { btn.textContent = serverText; }
    else if (!active) { btn.textContent = "🎤 Wake Up"; }
    else if (speaking) { btn.textContent = "⚡ Interrupt"; }
    else { btn.textContent = "🟡 End Session"; }
    if (speaking) { btn.classList.add("interrupt"); } else if (active) { btn.classList.add("session-active"); }
    if (serverEnabled !== undefined) btn.disabled = !serverEnabled;
  }

  _renderSystem() {
    const s = this._state.sys;
    const cv = this.querySelector("#cpuVal"), rv = this.querySelector("#ramVal");
    const cb = this.querySelector("#cpuBar"), rb = this.querySelector("#ramBar");
    if (cv) cv.textContent = (Number.isInteger(s.cpu) ? s.cpu : s.cpu.toFixed(1)) + "%"; if (rv) rv.textContent = s.ram + "%";
    if (cb) cb.style.width = s.cpu + "%"; if (rb) rb.style.width = s.ram + "%";
  }

  _renderEqBands() {
    this._state.eqBands.forEach((v, i) => {
      const inp = this.querySelector(`input[data-band="${i}"]`); if (inp) inp.value = v;
      const vl = this.querySelector(`#eqVal${i}`); if (vl) vl.textContent = v > 0 ? `+${v}` : `${v}`;
    });
  }

  _renderPremium() { this._renderCustomAi(); }

  _renderAlarms() {
    const el = this.querySelector("#alarmList"); if (!el) return;
    const als = this._state.alarms;
    if (!als.length) { el.innerHTML = '<div style="text-align:center;padding:12px;color:rgba(226,232,240,.4);font-size:11px">Chưa có báo thức</div>'; return; }
    const rpMap = { daily: 'Hàng ngày', weekly: 'Hàng tuần', none: 'Một lần' };
    const dayNames = {1:'CN',2:'T2',3:'T3',4:'T4',5:'T5',6:'T6',7:'T7'};
    el.innerHTML = als.map(a => {
      const t = `${String(a.hour).padStart(2,'0')}:${String(a.minute).padStart(2,'0')}`;
      const daysStr = Array.isArray(a.selected_days) && a.selected_days.length ? a.selected_days.sort((x,y)=>x-y).map(d=>dayNames[d]||d).join(' ') : '';
      return `<div class="alarm-item ${a.enabled ? '' : 'o5'}"><div class="fx jcb aic">
<div><span class="alarm-time">${t}</span><span style="font-size:9px;color:rgba(139,92,246,.7);margin-left:6px;font-family:monospace">#${a.id}</span>${a.label ? `<span style="font-size:10px;color:rgba(226,232,240,.6);margin-left:5px;font-weight:700">${this._esc(a.label)}</span>` : ''}</div>
<div class="alarm-actions">
  <button class="form-btn sm ${a.enabled ? 'green' : ''}" data-altog="${a.id}">${a.enabled ? '🔔' : '🔕'}</button>
  <button class="form-btn sm" data-aledit="${a.id}">✏️</button>
  <button class="form-btn sm danger" data-aldel="${a.id}">✕</button>
</div></div>
<div class="alarm-meta">${rpMap[a.repeat] || 'Một lần'}${daysStr ? ' · ' + daysStr : ''} · Vol ${a.volume ?? 100}%${a.youtube_song_name ? ' · 🎵 ' + this._esc(a.youtube_song_name) : ''}</div></div>`;
    }).join("");

    el.onclick = (e) => {
      const tog = e.target.closest('[data-altog]'), edit = e.target.closest('[data-aledit]'), del = e.target.closest('[data-aldel]');
      if (tog) { const id = parseInt(tog.dataset.altog); this._send({ action: "alarm_toggle", alarm_id: id }); }
      if (edit) { const id = parseInt(edit.dataset.aledit); const a = this._state.alarms.find(x => x.id === id); if (a) this._showAlarmModal(a); }
      if (del) { const id = parseInt(del.dataset.aldel); const a = this._state.alarms.find(x => x.id === id); if (!a) return; const t = `${String(a.hour).padStart(2,'0')}:${String(a.minute).padStart(2,'0')}`; if (confirm(`Xóa báo thức #${a.id} lúc ${t}?`)) { this._pendingDeleteId = id; this._send({ action: "alarm_delete", alarm_id: id }); } }
    };
  }

  _parseProcStats(raw) {
    const lines = raw.split("\n"); let cpu = 0, ram = 0;
    for (const l of lines) {
      if (l.includes("cpu_usage")) { const m = l.match(/([\d.]+)/); if (m) cpu = Math.round(parseFloat(m[1])); }
      if (l.includes("mem_usage") || l.includes("ram_usage")) { const m = l.match(/([\d.]+)/); if (m) ram = Math.round(parseFloat(m[1])); }
    }
    this._state.sys = { cpu, ram };
  }

  _sendChat() {
    const inp = this.querySelector("#chatInp"); const t = (inp?.value || "").trim(); if (!t) return;
    this._send({ action: "chat_send_text", text: t });
    if (inp) inp.value = "";
  }

  _addChatMsg(content, type) {
    this._state.chat.push({ type, content, ts: Date.now() });
    if (this._state.chat.length > 200) this._state.chat = this._state.chat.slice(-200);
    this._renderChatMsgs(true);
  }

  _showAlarmModal(al = null) {
    const existing = this.querySelector("#alarmModal"); if (existing) existing.remove();
    const div = document.createElement("div"); div.id = "alarmModal"; div.className = "modal-overlay";
    const isEdit = !!al;
    div.innerHTML = `<div class="modal-box">
<div class="modal-head"><h3>${isEdit ? "Sửa" : "Thêm"} báo thức</h3><button class="modal-close" id="alClose">✕</button></div>
<div class="fx g8 aic mb8">
  <div class="form-row"><div class="form-label">Giờ</div><input class="form-inp" type="number" id="alH" min="0" max="23" value="${al?.hour ?? 7}" style="width:70px" /></div>
  <span style="font-size:20px;color:#e2e8f0;font-weight:900">:</span>
  <div class="form-row"><div class="form-label">Phút</div><input class="form-inp" type="number" id="alM" min="0" max="59" value="${al?.minute ?? 0}" style="width:70px" /></div>
</div>
<div class="form-row"><div class="form-label">Lặp lại</div><select class="form-inp" id="alRpt"><option value="none" ${al?.repeat==='none'||!al?.repeat?'selected':''}>Một lần</option><option value="daily" ${al?.repeat==='daily'?'selected':''}>Hàng ngày</option><option value="weekly" ${al?.repeat==='weekly'?'selected':''}>Hàng tuần</option></select></div>
<div id="alDaysWrap" class="${al?.repeat === 'weekly' ? '' : 'hidden'}"><div class="al-days">${['T2','T3','T4','T5','T6','T7','CN'].map((d, i) => { const v = i < 6 ? i + 2 : 1; return `<label><input type="checkbox" class="al-day-cb" value="${v}" ${al?.selected_days?.includes(v) ? 'checked' : ''}>${d}</label>`; }).join('')}</div></div>
<div class="form-row mt6"><div class="form-label">Tên</div><input class="form-inp" id="alLabel" placeholder="Sáng dậy" value="${this._esc(al?.label || '')}" /></div>
<div class="form-row"><div class="form-label">Volume: <span id="alVolD">${al?.volume ?? 100}</span>%</div><input type="range" id="alVol" min="0" max="100" value="${al?.volume ?? 100}" style="width:100%" /></div>
<div class="form-row"><div class="form-label">YouTube (tùy chọn)</div><input class="form-inp" id="alYt" placeholder="Tên bài hát" value="${this._esc(al?.youtube_song_name || '')}" /></div>
<div class="fx g4 mt8"><button class="form-btn" id="alCancel" style="flex:1">Hủy</button><button class="form-btn green" id="alSubmit" style="flex:1">${isEdit ? "Lưu" : "Thêm"}</button></div>
</div>`;
    this.appendChild(div);
    div.querySelector("#alClose").onclick = () => div.remove();
    div.querySelector("#alCancel").onclick = () => div.remove();
    div.querySelector("#alVol").oninput = function() { div.querySelector("#alVolD").textContent = this.value; };
    div.querySelector("#alRpt").onchange = function() { div.querySelector("#alDaysWrap").classList.toggle("hidden", this.value !== "weekly"); };
    div.querySelector("#alSubmit").onclick = () => {
      const h = parseInt(div.querySelector("#alH").value), m = parseInt(div.querySelector("#alM").value);
      if (isNaN(h) || isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) { this._toast("Giờ không hợp lệ", "error"); return; }
      const rpt = div.querySelector("#alRpt").value;
      const days = rpt === "weekly" ? Array.from(div.querySelectorAll(".al-day-cb:checked")).map(c => parseInt(c.value)) : undefined;
      const data = { action: isEdit ? "alarm_edit" : "alarm_add", hour: h, minute: m, repeat: rpt, label: div.querySelector("#alLabel").value.trim(), volume: parseInt(div.querySelector("#alVol").value) };
      if (isEdit) { data.alarm_id = al.id; data.enabled = al.enabled; }
      const yt = div.querySelector("#alYt").value.trim(); if (yt) data.youtube_song_name = yt;
      if (days) data.selected_days = days;
      this._send(data); div.remove();
    };
  }
}

customElements.define("aibox-ha-card", AiBoxCard);
window.customCards = window.customCards || [];
window.customCards.push({ type: "aibox-ha-card", name: "AI BOX HA Card", description: "AI BOX full-feature card via custom HTTPS endpoint or LAN/tunnel", preview: false });

// ── Cache-buster ─────────────────────────────────────────────────────────────
(function() {
  const BUILD_TS = "20260415-ha-custom-v1";
  const SK = "aibox_ha_card_build";

  try {
    const stored = sessionStorage.getItem(SK);
    if (stored !== BUILD_TS) {
      sessionStorage.setItem(SK, BUILD_TS);

      if (stored !== null && 'caches' in window) {
        caches.keys().then(keys => {
          return Promise.all(keys.map(k => caches.delete(k)));
        }).then(() => {
          console.warn("[AI BOX HA Card] Cache cleared — reloading for new build:", BUILD_TS);
          window.location.reload();
        }).catch(() => {
          window.location.reload();
        });
      } else if (stored !== null) {
        const url = new URL(window.location.href);
        url.searchParams.set("_aibox_v", BUILD_TS);
        window.location.replace(url.toString());
      }
    }
  } catch(e) {
    console.warn("[AI BOX HA Card] sessionStorage unavailable, cache busting skipped:", e);
  }

  console.log(`%c AI BOX HA Card [${BUILD_TS}] — base: aibox-webui-card + HTTPS custom_ws_url/custom_speaker_ws_url`, "color:#a78bfa;font-weight:bold;font-size:11px");
})();
=======
const PhicommBaseCard = customElements.get("phicomm-r1-card");

if (!PhicommBaseCard) {
  console.error("[AI BOX HA Card] Missing dependency: phicomm-r1-card must be loaded first.");
} else {
  class AiBoxHaCard extends PhicommBaseCard {
    static getStubConfig() {
      const base = typeof PhicommBaseCard.getStubConfig === "function"
        ? PhicommBaseCard.getStubConfig()
        : { entity: "media_player.phicomm_r1" };
      return { ...base, title: "AI BOX" };
    }

    setConfig(config) {
      const normalized = {
        title: "AI BOX",
        ...(config || {}),
      };

      // Alias nhẹ để người dùng cũ dễ migrate.
      if (!normalized.entity && normalized.device) {
        normalized.entity = normalized.device;
      }

      super.setConfig(normalized);
    }
  }

  if (!customElements.get("aibox-ha-card")) {
    customElements.define("aibox-ha-card", AiBoxHaCard);
  }

  window.customCards = window.customCards || [];
  if (!window.customCards.find((card) => card.type === "aibox-ha-card")) {
    window.customCards.push({
      type: "aibox-ha-card",
      name: "AI BOX HA Card",
      description: "AI BOX card chạy qua integration phicomm_r1 (HA proxy, không cần tunnel/domain).",
      preview: false,
    });
  }
}

