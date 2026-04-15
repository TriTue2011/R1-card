class PhicommR1LiteCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass = null;
    this._config = null;
    this._activeRoomIdx = 0;
    this._syncRoomIdxs = new Set();
    this._progressTimer = null;
    this._livePosition = 0;
    this._liveTickAt = 0;
  }

  static getStubConfig() {
    return {
      entity: "media_player.phicomm_r1",
      title: "Phicomm R1 Lite",
      rooms: [],
    };
  }

  setConfig(config) {
    if (!config || (!config.entity && !Array.isArray(config.rooms))) {
      throw new Error("Phicomm R1 Lite Card: cần 'entity' hoặc 'rooms'");
    }
    const rooms = Array.isArray(config.rooms) && config.rooms.length
      ? config.rooms
      : [{ entity: config.entity, name: config.title || "Phicomm R1" }];
    this._config = {
      title: "Phicomm R1 Lite",
      show_sync_selector: true,
      show_volume: true,
      ...config,
      rooms: rooms.map((r, i) => ({
        entity: String(r.entity || "").trim(),
        name: r.name || `Room ${i + 1}`,
      })),
    };
    this._activeRoomIdx = Math.min(this._activeRoomIdx, this._config.rooms.length - 1);
    this._syncRoomIdxs = new Set(
      Array.from(this._syncRoomIdxs).filter((idx) => idx >= 0 && idx < this._config.rooms.length && idx !== this._activeRoomIdx),
    );
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._ensureProgressTimer();
    this._render();
  }

  disconnectedCallback() {
    this._clearProgressTimer();
  }

  getCardSize() {
    return 5;
  }

  _activeRoom() {
    return this._config?.rooms?.[this._activeRoomIdx] || null;
  }

  _roomState(idx) {
    const room = this._config?.rooms?.[idx];
    if (!room?.entity || !this._hass) return null;
    return this._hass.states[room.entity] || null;
  }

  _activeState() {
    return this._roomState(this._activeRoomIdx);
  }

  _targetEntityIds(includeMaster = true) {
    if (!this._config?.rooms) return [];
    const ids = [];
    if (includeMaster) {
      const active = this._activeRoom()?.entity;
      if (active) ids.push(active);
    }
    this._syncRoomIdxs.forEach((idx) => {
      const entity = this._config.rooms[idx]?.entity;
      if (entity && !ids.includes(entity)) ids.push(entity);
    });
    return ids;
  }

  _callMediaPlayer(service, data = {}, includeMaster = true) {
    if (!this._hass) return;
    const entityIds = this._targetEntityIds(includeMaster);
    if (!entityIds.length) return;
    this._hass.callService("media_player", service, {
      entity_id: entityIds,
      ...data,
    });
  }

  _ensureProgressTimer() {
    const state = this._activeState();
    const isPlaying = state?.state === "playing";
    if (!isPlaying) {
      this._clearProgressTimer();
      return;
    }
    if (this._progressTimer) return;
    this._livePosition = Number(state.attributes.media_position || 0);
    this._liveTickAt = Date.now();
    this._progressTimer = setInterval(() => {
      const s = this._activeState();
      if (!s || s.state !== "playing") {
        this._clearProgressTimer();
        this._render();
        return;
      }
      const now = Date.now();
      const delta = (now - this._liveTickAt) / 1000;
      this._liveTickAt = now;
      this._livePosition += Math.max(0, delta);
      this._renderProgressOnly();
    }, 1000);
  }

  _clearProgressTimer() {
    if (this._progressTimer) {
      clearInterval(this._progressTimer);
      this._progressTimer = null;
    }
  }

  _fmtTime(sec) {
    const value = Math.max(0, Math.floor(Number(sec || 0)));
    return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
  }

  _renderProgressOnly() {
    const state = this._activeState();
    const duration = Number(state?.attributes?.media_duration || 0);
    const position = state?.state === "playing"
      ? this._livePosition
      : Number(state?.attributes?.media_position || 0);
    const bar = this.shadowRoot.querySelector("#seekBar");
    const pos = this.shadowRoot.querySelector("#pos");
    const dur = this.shadowRoot.querySelector("#dur");
    const pct = duration > 0 ? Math.min(100, (position / duration) * 100) : 0;
    if (bar) bar.style.width = `${pct}%`;
    if (pos) pos.textContent = this._fmtTime(position);
    if (dur) dur.textContent = this._fmtTime(duration);
  }

  _bind() {
    this.shadowRoot.querySelectorAll(".room-btn").forEach((btn) => {
      btn.onclick = () => {
        this._activeRoomIdx = Number(btn.dataset.idx);
        this._syncRoomIdxs.delete(this._activeRoomIdx);
        this._livePosition = Number(this._activeState()?.attributes?.media_position || 0);
        this._clearProgressTimer();
        this._ensureProgressTimer();
        this._render();
      };
    });

    this.shadowRoot.querySelectorAll(".sync-cb").forEach((cb) => {
      cb.onchange = () => {
        const idx = Number(cb.dataset.idx);
        if (cb.checked) this._syncRoomIdxs.add(idx);
        else this._syncRoomIdxs.delete(idx);
        this._render();
      };
    });

    this.shadowRoot.querySelector("#btnPrev")?.addEventListener("click", () => this._callMediaPlayer("media_previous_track"));
    this.shadowRoot.querySelector("#btnPlay")?.addEventListener("click", () => this._callMediaPlayer("media_play_pause"));
    this.shadowRoot.querySelector("#btnStop")?.addEventListener("click", () => this._callMediaPlayer("media_stop"));
    this.shadowRoot.querySelector("#btnNext")?.addEventListener("click", () => this._callMediaPlayer("media_next_track"));

    const volume = this.shadowRoot.querySelector("#volume");
    if (volume) {
      volume.oninput = () => {
        const value = Number(volume.value);
        this.shadowRoot.querySelector("#volumeLabel").textContent = `${Math.round(value * 100)}%`;
      };
      volume.onchange = () => {
        this._callMediaPlayer("volume_set", { volume_level: Number(volume.value) });
      };
    }

    const seekWrap = this.shadowRoot.querySelector("#seekWrap");
    if (seekWrap) {
      seekWrap.onclick = (e) => {
        const state = this._activeState();
        const duration = Number(state?.attributes?.media_duration || 0);
        if (!duration) return;
        const rect = seekWrap.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const seekPosition = Math.floor(duration * ratio);
        this._livePosition = seekPosition;
        this._callMediaPlayer("media_seek", { seek_position: seekPosition });
        this._renderProgressOnly();
      };
    }
  }

  _render() {
    if (!this._config) return;

    const state = this._activeState();
    const title = state?.attributes?.media_title || "Không có nhạc";
    const artist = state?.attributes?.media_artist || "---";
    const duration = Number(state?.attributes?.media_duration || 0);
    const volume = Number(state?.attributes?.volume_level ?? 0);
    const isPlaying = state?.state === "playing";
    if (!isPlaying) {
      this._livePosition = Number(state?.attributes?.media_position || 0);
    }
    const source = state?.attributes?.source || state?.attributes?.app_name || state?.state || "idle";

    this.shadowRoot.innerHTML = `
      <ha-card>
        <div class="wrap">
          <div class="head">
            <div class="title">${this._config.title}</div>
            <div class="badge">${source}</div>
          </div>
          <div class="rooms">
            ${this._config.rooms.map((room, idx) => {
              const st = this._roomState(idx);
              const active = idx === this._activeRoomIdx;
              const synced = this._syncRoomIdxs.has(idx);
              const offline = !st || st.state === "unavailable";
              return `
                <div class="room-item">
                  <button class="room-btn ${active ? "active" : ""} ${offline ? "offline" : ""}" data-idx="${idx}">
                    ${room.name}
                  </button>
                  ${this._config.show_sync_selector && !active ? `
                    <label class="sync-label">
                      <input class="sync-cb" data-idx="${idx}" type="checkbox" ${synced ? "checked" : ""}>
                      <span>🔗</span>
                    </label>
                  ` : `<span class="sync-dot">${active ? "★" : ""}</span>`}
                </div>
              `;
            }).join("")}
          </div>
          <div class="media">
            <div class="song">${title}</div>
            <div class="artist">${artist}</div>
          </div>
          <div class="seek-wrap" id="seekWrap">
            <div class="seek-track"><div id="seekBar" class="seek-bar"></div></div>
            <div class="time"><span id="pos">${this._fmtTime(this._livePosition)}</span><span id="dur">${this._fmtTime(duration)}</span></div>
          </div>
          <div class="controls">
            <button id="btnPrev">⏮</button>
            <button id="btnPlay" class="play">${isPlaying ? "⏸" : "▶"}</button>
            <button id="btnStop">■</button>
            <button id="btnNext">⏭</button>
          </div>
          ${this._config.show_volume ? `
            <div class="vol">
              <span>🔊</span>
              <input id="volume" type="range" min="0" max="1" step="0.01" value="${Number.isFinite(volume) ? volume : 0}">
              <span id="volumeLabel">${Math.round((Number.isFinite(volume) ? volume : 0) * 100)}%</span>
            </div>
          ` : ""}
        </div>
      </ha-card>
      <style>
        .wrap{padding:14px;border-radius:16px;background:linear-gradient(180deg,#0b1020,#070b16);color:#e2e8f0;font-family:Segoe UI,system-ui,sans-serif}
        .head{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}
        .title{font-size:16px;font-weight:800}
        .badge{font-size:10px;padding:2px 8px;border:1px solid rgba(167,139,250,.4);border-radius:999px;color:#c4b5fd}
        .rooms{display:flex;gap:6px;overflow:auto;padding-bottom:4px;margin-bottom:10px}
        .room-item{display:flex;flex-direction:column;align-items:center;gap:2px}
        .room-btn{border-radius:999px;border:1px solid rgba(148,163,184,.3);background:rgba(15,23,42,.6);color:#cbd5e1;padding:6px 10px;font-size:11px;cursor:pointer}
        .room-btn.active{background:rgba(109,40,217,.45);border-color:rgba(167,139,250,.8);color:#fff}
        .room-btn.offline{opacity:.5}
        .sync-label{font-size:11px;cursor:pointer;user-select:none}
        .sync-label input{display:none}
        .sync-dot{font-size:10px;color:#a78bfa;height:14px}
        .media{margin-bottom:8px}
        .song{font-size:14px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .artist{font-size:11px;color:rgba(226,232,240,.6)}
        .seek-wrap{cursor:pointer;margin-bottom:10px}
        .seek-track{height:4px;background:rgba(148,163,184,.2);border-radius:999px;overflow:hidden}
        .seek-bar{height:100%;width:0;background:linear-gradient(90deg,#7c3aed,#a78bfa)}
        .time{display:flex;justify-content:space-between;font-size:10px;color:rgba(226,232,240,.55);margin-top:4px}
        .controls{display:flex;gap:10px;justify-content:center;margin-bottom:10px}
        .controls button{width:38px;height:38px;border-radius:50%;border:1px solid rgba(148,163,184,.25);background:rgba(15,23,42,.6);color:#fff;cursor:pointer}
        .controls .play{width:50px;height:50px;background:linear-gradient(135deg,#7c3aed,#5b21b6)}
        .vol{display:flex;align-items:center;gap:8px}
        .vol input{flex:1}
      </style>
    `;

    this._bind();
    this._renderProgressOnly();
    this._ensureProgressTimer();
  }
}

if (!customElements.get("phicomm-r1-lite-card")) {
  customElements.define("phicomm-r1-lite-card", PhicommR1LiteCard);
}

window.customCards = window.customCards || [];
if (!window.customCards.find((card) => card.type === "phicomm-r1-lite-card")) {
  window.customCards.push({
    type: "phicomm-r1-lite-card",
    name: "Phicomm R1 Lite Card",
    description: "Lightweight integration-driven card with optional multi-room broadcast.",
    preview: false,
  });
}
