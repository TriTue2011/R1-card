const EQ_BAND_LABELS = ["60Hz", "230Hz", "910Hz", "3.6K", "14K"];
const CHAT_ENABLED_STATES = new Set([
  "ready",
  "online",
  "active",
  "available",
  "idle",
  "standby",
  "connecting",
  "listening",
  "thinking",
  "speaking",
]);
const CHAT_DISABLED_STATES = new Set([
  "unavailable",
  "offline",
  "error",
  "failed",
  "disabled",
  "disconnected",
]);
const CHAT_SESSION_STATES = new Set(["connecting", "listening", "thinking", "speaking"]);
const NOW_PLAYING_FALLBACK_WINDOW_MS = 8000;

class PhicommR1Card extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass = undefined;
    this._config = undefined;

    this._activeTab = "media";
    this._mediaSearchTab = "songs";
    this._lightingTab = "main";

    this._query = "";
    this._chatInput = "";
    this._chatHistory = [];
    this._chatHistoryLoaded = false;
    this._chatDangCompose = false;
    this._mediaDangCompose = false;
    this._mediaTimKiemSauCompose = false;
    this._mediaQueryFocused = false;

    this._volumeLevel = 0;
    this._wakeSensitivity = 0.9;
    this._lastPlayPauseSent = null;

    this._wakeEnabled = false;
    this._antiDeafEnabled = false;
    this._dlnaEnabled = false;
    this._airplayEnabled = false;
    this._bluetoothEnabled = false;
    this._mainLightEnabled = false;
    this._edgeLightEnabled = false;
    this._mainLightMode = 0;

    this._mainLightBrightness = 100;
    this._mainLightSpeed = 50;
    this._edgeLightIntensity = 50;

    this._eqEnabled = false;
    this._eqBandCount = EQ_BAND_LABELS.length;
    this._eqBands = [0, 0, 0, 0, 0];
    this._eqBand = 0;
    this._eqLevel = 0;
    this._eqSyncGuardUntil = 0;
    this._bassEnabled = false;
    this._bassStrength = 0;
    this._loudnessEnabled = false;
    this._loudnessGain = 0;

    this._lastEntityRef = null;
    this._lastSearchStateKey = "";
    this._lastPlaylistLibraryKey = "";
    this._lastPlaylistDetailKey = "";
    this._lastPlaylistEventKey = "";
    this._pendingRender = false;
    this._playlistLibraryLoading = false;
    this._playlistDetailLoading = false;
    this._playlistDetailVisibleId = "";
    this._playlistDialog = this._taoTrangThaiDialogPlaylist();

    this._progressTimerId = null;
    this._liveTrackKey = "";
    this._livePositionSeconds = 0;
    this._liveDurationSeconds = 0;
    this._livePlaying = false;
    this._liveTickAt = 0;
    this._nowPlayingCache = this._taoNowPlayingCache();
    this._forcePauseUntil = 0;
    this._optimisticPlayUntil = 0;
    this._pendingSwitches = {};
    this._lastChatStateRequestAt = 0;
    this._lastChatHistoryRequestAt = 0;
    this._lastControlStateRequestAt = 0;
    this._lastSystemStateRequestAt = 0;
    this._dangChoKetQuaTimKiem = false;
    this._timKiemDangCho = null;
  }

  static getStubConfig() {
    return {
      entity: "media_player.phicomm_r1",
      title: "Phicomm R1",
    };
  }

  getCardSize() {
    return 12;
  }

  _chuanHoaKichThuocCss(value) {
    if (value === undefined || value === null) return "";
    if (typeof value === "number") {
      return Number.isFinite(value) && value > 0 ? `${value}px` : "";
    }
    const normalized = String(value).trim();
    if (!normalized) return "";
    if (/^\d+(\.\d+)?$/.test(normalized)) return `${normalized}px`;
    return normalized;
  }

  setConfig(config) {
    if (!config || !config.entity) {
      throw new Error("Phicomm R1 Card: 'entity' is required");
    }
    const maxHeight = this._chuanHoaKichThuocCss(config.max_height ?? config.maxHeight);
    this._config = {
      title: "Phicomm R1",
      ...config,
      max_height: maxHeight,
    };
    this._lastEntityRef = null;
    this._pendingRender = false;
    this._xoaHenGioTienDo();
    this._liveTrackKey = "";
    this._livePositionSeconds = 0;
    this._liveDurationSeconds = 0;
    this._livePlaying = false;
    this._liveTickAt = 0;
    this._nowPlayingCache = this._taoNowPlayingCache();
    this._forcePauseUntil = 0;
    this._optimisticPlayUntil = 0;
    this._pendingSwitches = {};
    this._lastChatStateRequestAt = 0;
    this._lastChatHistoryRequestAt = 0;
    this._lastControlStateRequestAt = 0;
    this._lastSystemStateRequestAt = 0;
    this._chatHistory = [];
    this._chatHistoryLoaded = false;
    this._chatDangCompose = false;
    this._mediaDangCompose = false;
    this._mediaTimKiemSauCompose = false;
    this._mediaQueryFocused = false;
    this._eqBandCount = EQ_BAND_LABELS.length;
    this._eqBands = [0, 0, 0, 0, 0];
    this._eqBand = 0;
    this._eqLevel = 0;
    this._eqSyncGuardUntil = 0;
    this._lastSearchStateKey = "";
    this._lastPlaylistLibraryKey = "";
    this._lastPlaylistDetailKey = "";
    this._lastPlaylistEventKey = "";
    this._dangChoKetQuaTimKiem = false;
    this._timKiemDangCho = null;
    this._playlistLibraryLoading = false;
    this._playlistDetailLoading = false;
    this._playlistDetailVisibleId = "";
    this._playlistDialog = this._taoTrangThaiDialogPlaylist();
    this._veGiaoDien();
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._config) return;

    const entityRef = this._doiTuongTrangThai();
    const changed = entityRef !== this._lastEntityRef;
    const currentSearchStateKey = this._khoaTrangThaiTimKiem(
      entityRef?.attributes?.last_music_search || {}
    );
    const searchChanged = currentSearchStateKey !== this._lastSearchStateKey;
    const currentPlaylistLibraryKey = this._khoaTrangThaiPayload(
      entityRef?.attributes?.playlist_library || {}
    );
    const playlistLibraryChanged =
      currentPlaylistLibraryKey !== this._lastPlaylistLibraryKey;
    const currentPlaylistDetailKey = this._khoaTrangThaiPayload(
      entityRef?.attributes?.playlist_detail || {}
    );
    const playlistDetailChanged =
      currentPlaylistDetailKey !== this._lastPlaylistDetailKey;
    const currentPlaylistEventKey = this._khoaTrangThaiPayload(
      entityRef?.attributes?.last_playlist_event || {}
    );
    const playlistEventChanged =
      currentPlaylistEventKey !== this._lastPlaylistEventKey;
    this._lastEntityRef = entityRef;
    this._lastSearchStateKey = currentSearchStateKey;
    this._lastPlaylistLibraryKey = currentPlaylistLibraryKey;
    this._lastPlaylistDetailKey = currentPlaylistDetailKey;
    this._lastPlaylistEventKey = currentPlaylistEventKey;
    this._dongBoTuEntity();

    if (
      !changed &&
      !searchChanged &&
      !playlistLibraryChanged &&
      !playlistDetailChanged &&
      !playlistEventChanged &&
      !this._pendingRender
    ) return;
    if (this._activeTab === "system" && this._dangTuongTacEq()) {
      this._pendingRender = true;
      this._capNhatEqGiaoDien(this.shadowRoot);
      return;
    }
    if (this._dangSuaOInputVanBan()) {
      const activeId = this.shadowRoot?.activeElement?.id || "";
      if (activeId === "media-query" && this._activeTab === "media") {
        if (this._dangChoKetQuaTimKiem) {
          const cho = this._timKiemDangCho;
          const daCoKetQuaMoi = cho
            ? this._laKetQuaTimKiemMoi(
                this._thuocTinh().last_music_search || {},
                cho.query,
                cho.source,
                cho.mocTruoc,
                cho.dauVetTruoc
              )
            : false;
          if (daCoKetQuaMoi) {
            this._pendingRender = false;
            this._veGiaoDienGiuFocusTimKiem();
          } else {
            this._pendingRender = true;
          }
          return;
        }
        // Search completed but state changed (e.g. results arrived late) –
        // render with focus preservation so results appear immediately.
        if (changed || searchChanged) {
          this._pendingRender = false;
          this._veGiaoDienGiuFocusTimKiem();
          return;
        }
      }
      if (activeId === "chat-input" && this._activeTab === "chat") {
        this._pendingRender = false;
        this._veGiaoDienGiuFocusChat();
        return;
      }
      this._pendingRender = true;
      return;
    }

    this._pendingRender = false;
    this._veGiaoDien();
  }

  connectedCallback() {
    this._veGiaoDien();
  }

  disconnectedCallback() {
    this._xoaHenGioTienDo();
  }

  _doiTuongTrangThai() {
    if (!this._hass || !this._config) return undefined;
    return this._hass.states[this._config.entity];
  }

  _thuocTinh() {
    return this._doiTuongTrangThai()?.attributes || {};
  }

  _taoTrangThaiDialogPlaylist() {
    return {
      open: false,
      mode: "",
      selectedPlaylistId: "",
      newPlaylistName: "",
      pendingItem: null,
      pendingSource: "",
      busy: false,
      error: "",
    };
  }

  _taoNowPlayingCache() {
    return {
      trackKey: "",
      trackId: "",
      playlistId: "",
      title: "",
      artist: "",
      source: "",
      thumbnail_url: "",
      duration: 0,
    };
  }

  _mocCapNhatPayload(payload) {
    const raw =
      payload?.updated_at_ms ??
      payload?.updatedAtMs ??
      payload?.updated_at ??
      payload?.updatedAt;
    const numeric = Number(raw);
    return Number.isFinite(numeric) ? numeric : 0;
  }

  _khoaTrangThaiPayload(payload) {
    if (!payload || typeof payload !== "object") return "";
    return `${this._mocCapNhatPayload(payload)}|${JSON.stringify(payload)}`;
  }

  _laTabQuanLyPlaylist(tab = this._mediaSearchTab) {
    return String(tab || "").trim().toLowerCase() === "playlists";
  }

  _duLieuTimKiemTheoTab() {
    if (this._laTabQuanLyPlaylist()) {
      return {
        source: "",
        query: "",
        success: false,
        total: 0,
        items: [],
      };
    }
    const search = this._thuocTinh().last_music_search || {};
    const expectedSource = this._nguonKetQuaTheoTab(this._mediaSearchTab);
    const searchSource = String(search.source || "").trim().toLowerCase();
    const expectedSourceNorm = String(expectedSource || "").trim().toLowerCase();
    if (!expectedSourceNorm || searchSource !== expectedSourceNorm) {
      return {
        ...search,
        source: expectedSource,
        items: [],
      };
    }
    return {
      ...search,
      items: Array.isArray(search.items) ? search.items : [],
    };
  }

  _thuVienPlaylist() {
    const library = this._thuocTinh().playlist_library || {};
    return Array.isArray(library.playlists) ? library.playlists : [];
  }

  _chiTietPlaylistDangXem() {
    const detail = this._thuocTinh().playlist_detail || {};
    const detailId = String(detail.playlist_id || "").trim();
    if (!detailId || (this._playlistDetailVisibleId && detailId !== this._playlistDetailVisibleId)) {
      return null;
    }
    return {
      ...detail,
      items: Array.isArray(detail.items) ? detail.items : [],
    };
  }

  _placeholderTimKiemMedia() {
    if (this._mediaSearchTab === "playlist") return "Tìm playlist...";
    if (this._mediaSearchTab === "zing") return "Tìm bài hát Zing MP3...";
    return "Tìm bài hát...";
  }

  _chuanHoaTenPlaylist(value) {
    return String(value || "")
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase();
  }

  _timPlaylistTheoTen(name) {
    const normalizedName = this._chuanHoaTenPlaylist(name);
    if (!normalizedName) return [];
    return this._thuVienPlaylist().filter((playlist) => {
      return this._chuanHoaTenPlaylist(playlist?.name) === normalizedName;
    });
  }

  _laMucPlaylist(item, fallbackSource = "") {
    if (!item || typeof item !== "object") return false;
    const kind = String(item.kind || "").trim().toLowerCase();
    const source = String(item.source || fallbackSource || "").trim().toLowerCase();
    return kind === "playlist" || Boolean(item.playlist_id || item.playlistId) || source.includes("playlist");
  }

  _coTheThemPlaylist(item, fallbackSource = "") {
    if (!item || typeof item !== "object") return false;
    if (this._laMucPlaylist(item, fallbackSource)) return false;
    return Boolean(
      this._chuoiKhongRongDauTien(
        item.song_id,
        item.songId,
        item.video_id,
        item.videoId,
        item.id
      )
    );
  }

  _nguonTrackChoPlaylist(item, fallbackSource = "") {
    const itemSource = String(item?.source || fallbackSource || "").trim().toLowerCase();
    if (item?.song_id || item?.songId || itemSource.includes("zing")) return "zing";
    return "youtube";
  }

  _duLieuThemPlaylist(item, fallbackSource = "") {
    if (!this._coTheThemPlaylist(item, fallbackSource)) return null;
    const source = this._nguonTrackChoPlaylist(item, fallbackSource);
    const id =
      source === "zing"
        ? this._chuoiKhongRongDauTien(item?.song_id, item?.songId, item?.id)
        : this._chuoiKhongRongDauTien(item?.video_id, item?.videoId, item?.id);
    if (!id) return null;
    return {
      playlist_id: "",
      source,
      id,
      title: item?.title || item?.name || "",
      artist: item?.artist || item?.channel || "",
      thumbnail_url: item?.thumbnail_url || "",
      duration_seconds: Number(item?.duration_seconds || 0),
    };
  }

  _dangFocusTimKiem() {
    const active = this.shadowRoot?.activeElement;
    return this._mediaQueryFocused || active?.id === "media-query";
  }

  _dangSuaOInputVanBan() {
    const active = this.shadowRoot?.activeElement;
    if (this._mediaQueryFocused) return true;
    if (!active) return false;
    return active.id === "media-query" || active.id === "chat-input";
  }

  _dangTuongTacEq() {
    const active = this.shadowRoot?.activeElement;
    return Boolean(active?.dataset?.eqBand !== undefined);
  }

  _xuLyRenderCho() {
    if (!this._pendingRender) return;
    if (this._dangSuaOInputVanBan()) return;
    this._pendingRender = false;
    this._veGiaoDien();
  }

  _veGiaoDienGiuFocusTimKiem() {
    const root = this.shadowRoot;
    const input = root?.getElementById("media-query");
    const dangFocus = this._dangFocusTimKiem() && Boolean(input);
    const viTriBatDau = dangFocus ? input.selectionStart ?? input.value.length : 0;
    const viTriKetThuc = dangFocus ? input.selectionEnd ?? input.value.length : viTriBatDau;

    this._pendingRender = false;
    this._veGiaoDien();

    if (!dangFocus) return;
    const inputMoi = this.shadowRoot?.getElementById("media-query");
    if (!inputMoi) return;
    inputMoi.focus();
    const doDai = inputMoi.value.length;
    const batDau = Math.max(0, Math.min(doDai, Number(viTriBatDau)));
    const ketThuc = Math.max(batDau, Math.min(doDai, Number(viTriKetThuc)));
    inputMoi.setSelectionRange(batDau, ketThuc);
  }

  _giuFocusTimKiemKhongRender() {
    if (!this._dangFocusTimKiem()) return;
    const input = this.shadowRoot?.getElementById("media-query");
    if (!input) return;
    const viTriBatDau = input.selectionStart ?? input.value.length;
    const viTriKetThuc = input.selectionEnd ?? input.value.length;
    requestAnimationFrame(() => {
      const inputMoi = this.shadowRoot?.getElementById("media-query");
      if (!inputMoi) return;
      inputMoi.focus();
      const doDai = inputMoi.value.length;
      const batDau = Math.max(0, Math.min(doDai, Number(viTriBatDau)));
      const ketThuc = Math.max(batDau, Math.min(doDai, Number(viTriKetThuc)));
      inputMoi.setSelectionRange(batDau, ketThuc);
    });
  }

  _veGiaoDienGiuFocusChat() {
    const root = this.shadowRoot;
    const input = root?.getElementById("chat-input");
    const dangFocus = Boolean(input && root.activeElement === input);
    const viTriBatDau = dangFocus ? input.selectionStart ?? input.value.length : 0;
    const viTriKetThuc = dangFocus ? input.selectionEnd ?? input.value.length : viTriBatDau;

    this._pendingRender = false;
    this._veGiaoDien();

    const inputMoi = this.shadowRoot?.getElementById("chat-input");
    if (!inputMoi) return;
    inputMoi.focus();
    const doDai = inputMoi.value.length;
    const batDau = Math.max(0, Math.min(doDai, Number(viTriBatDau)));
    const ketThuc = Math.max(batDau, Math.min(doDai, Number(viTriKetThuc)));
    inputMoi.setSelectionRange(batDau, ketThuc);
  }

  _layGiaTriChatInput() {
    const domValue = this.shadowRoot?.getElementById("chat-input")?.value;
    if (domValue !== undefined && domValue !== null) {
      return String(domValue);
    }
    return String(this._chatInput || "");
  }

  _cuonCuoiKhungChat() {
    requestAnimationFrame(() => {
      const historyEl = this.shadowRoot?.querySelector(".chat-shell-history");
      if (!historyEl) return;
      historyEl.scrollTop = historyEl.scrollHeight;
    });
  }

  _maHoaHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  _dinhDangThoiLuong(totalSeconds) {
    const seconds = Number(totalSeconds);
    if (!Number.isFinite(seconds) || seconds <= 0) return "--:--";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  _dinhDangDongHo(totalSeconds, fallback = "0:00") {
    const seconds = Number(totalSeconds);
    if (!Number.isFinite(seconds) || seconds <= 0) return fallback;
    return this._dinhDangThoiLuong(seconds);
  }

  _nhanNguon(source) {
    const normalized = String(source || "").toLowerCase();
    if (normalized.includes("zing")) return "ZING MP3";
    if (normalized.includes("playlist")) return "PLAYLIST";
    if (normalized.includes("youtube")) return "YOUTUBE";
    return normalized ? normalized.toUpperCase() : "AI BOX";
  }

  _chuoiKhongRongDauTien(...values) {
    for (const value of values) {
      if (value === undefined || value === null) continue;
      const text = String(value).trim();
      if (text) return text;
    }
    return "";
  }

  _epKieuGiayPhat(value, fallback = 0) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(0, numeric);
  }

  _laTieuDeNghi(value) {
    const normalized = String(value || "").trim().toLowerCase();
    return (
      normalized === "chua co bai dang phat" ||
      normalized === "chưa có bài đang phát" ||
      normalized === "khong co nhac" ||
      normalized === "không có nhạc"
    );
  }

  _layIdMucMedia(item) {
    return this._layDanhSachIdMucMedia(item)[0] || "";
  }

  _layDanhSachIdMucMedia(item) {
    if (!item || typeof item !== "object") return [];
    const seen = new Set();
    return [
      item.id,
      item.video_id,
      item.videoId,
      item.song_id,
      item.songId,
      item.track_id,
      item.trackId,
      item.playlist_id,
      item.playlistId,
    ].reduce((ids, value) => {
      const text = String(value || "").trim();
      if (!text || seen.has(text)) return ids;
      seen.add(text);
      ids.push(text);
      return ids;
    }, []);
  }

  _epKieuBoolean(value, fallback = false) {
    if (value === undefined || value === null) return fallback;
    if (typeof value === "boolean") return value;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) return fallback;
      return value !== 0;
    }
    const normalized = String(value).trim().toLowerCase();
    if (!normalized) return fallback;
    if (["1", "true", "on", "enable", "enabled", "yes", "y"].includes(normalized)) return true;
    if (["0", "false", "off", "disable", "disabled", "no", "n"].includes(normalized)) return false;
    const numeric = Number(normalized);
    if (Number.isFinite(numeric)) return numeric !== 0;
    return fallback;
  }

  _epKieuSo(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
  }

  _chuanHoaNhanTrangThaiChat(value) {
    return String(value || "").trim().toLowerCase();
  }

  _layMoTaNutChat(chatState, statusLabel) {
    const explicitText = String(chatState.button_text ?? chatState.buttonText ?? chatState.text ?? "").trim();
    if (explicitText) return explicitText;

    const normalized = this._chuanHoaNhanTrangThaiChat(statusLabel);
    if (CHAT_SESSION_STATES.has(normalized)) return "Phiên chat đang hoạt động";
    if (CHAT_ENABLED_STATES.has(normalized)) return "Sẵn sàng nhận lệnh hoặc tin nhắn";
    if (CHAT_DISABLED_STATES.has(normalized)) return "Chat hiện chưa khả dụng";
    return "Đang chờ đồng bộ trạng thái chat";
  }

  _layNhanTrangThaiChatHienThi(value) {
    const normalized = this._chuanHoaNhanTrangThaiChat(value);
    const labels = {
      ready: "Sẵn sàng",
      online: "Trực tuyến",
      active: "Đang hoạt động",
      available: "Khả dụng",
      idle: "Đang chờ",
      standby: "Chờ kích hoạt",
      connecting: "Đang kết nối",
      listening: "Đang nghe",
      thinking: "Đang xử lý",
      speaking: "Đang phản hồi",
      unavailable: "Không khả dụng",
      offline: "Ngoại tuyến",
      error: "Lỗi",
      failed: "Thất bại",
      disabled: "Đã tắt",
      disconnected: "Mất kết nối",
      unknown: "Không rõ trạng thái",
    };
    if (labels[normalized]) return labels[normalized];
    return String(value || "Không rõ trạng thái");
  }

  _layNhanTrangThaiPhat(state) {
    const normalized = String(state || "").trim().toLowerCase();
    if (normalized === "playing") return "Đang phát";
    if (normalized === "paused") return "Tạm dừng";
    if (normalized === "idle" || normalized === "off" || normalized === "stopped") return "Chờ phát";
    if (normalized === "unavailable") return "Không khả dụng";
    return normalized ? normalized : "Không rõ";
  }

  _gioiHanEqLevel(value, fallback = 0) {
    const numeric = this._epKieuSo(value, fallback);
    return Math.max(-1500, Math.min(1500, Math.round(numeric)));
  }

  _dinhDangEqLevel(level) {
    const numeric = this._gioiHanEqLevel(level, 0);
    return numeric > 0 ? `+${numeric}` : `${numeric}`;
  }

  _batDauCanhGacDongBoEq(durationMs = 1200) {
    const duration = Math.max(0, Number(durationMs) || 0);
    this._eqSyncGuardUntil = Date.now() + duration;
  }

  _layNhanEqBand(band = this._eqBand) {
    const index = Math.max(0, Math.round(Number(band) || 0));
    return EQ_BAND_LABELS[index] || `Band ${index + 1}`;
  }

  _layEqLevelTheoBand(band, fallback = this._eqLevel) {
    if (!Array.isArray(this._eqBands) || this._eqBands.length === 0) {
      return this._gioiHanEqLevel(fallback, 0);
    }
    const index = Math.max(0, Math.round(Number(band) || 0));
    if (index >= this._eqBands.length) {
      return this._gioiHanEqLevel(fallback, 0);
    }
    return this._gioiHanEqLevel(this._eqBands[index], fallback);
  }

  _capNhatEqGiaoDien(root = this.shadowRoot) {
    if (!root) return;
    const eqToggle = root.getElementById("eq-enabled");
    if (eqToggle) {
      eqToggle.checked = Boolean(this._eqEnabled);
    }
    const eqStatus = root.getElementById("eq-status-chip");
    if (eqStatus) {
      eqStatus.textContent = this._eqEnabled ? "EQ bật" : "EQ tắt";
      eqStatus.classList.toggle("is-off", !this._eqEnabled);
    }
    root.querySelectorAll("[data-eq-band]").forEach((slider) => {
      const band = Math.max(0, Math.round(Number(slider.dataset.eqBand || 0)));
      const value = this._layEqLevelTheoBand(band, 0);
      slider.value = String(value);
      const valueEl = root.querySelector(`[data-eq-value="${band}"]`);
      if (valueEl) {
        valueEl.textContent = this._dinhDangEqLevel(value);
      }
      const labelEl = root.querySelector(`[data-eq-name="${band}"]`);
      if (labelEl) {
        labelEl.classList.toggle("is-active", band === this._eqBand);
      }
    });
  }

  _chuanHoaChatMuc(item, fallbackRole = "server") {
    const source = item && typeof item === "object" ? item : {};
    const content = this._chuoiKhongRongDauTien(
      source.content,
      source.message,
      source.text,
      source.msg
    );
    if (!content) return null;

    const roleRaw = this._chuoiKhongRongDauTien(
      source.message_type,
      source.role,
      source.sender,
      fallbackRole
    ).toLowerCase();
    const role = ["user", "human", "client", "me"].includes(roleRaw) ? "user" : "server";
    const timestamp = source.ts ?? source.timestamp ?? source.time ?? source.created_at ?? source.createdAt;
    const normalized = {
      ...source,
      content,
      message_type: role,
      role,
      sender: role,
    };
    if (timestamp !== undefined && timestamp !== null && String(timestamp).trim() !== "") {
      normalized.ts = timestamp;
    }
    return normalized;
  }

  _laChatMucTrung(current, incoming) {
    const currentId = this._chuoiKhongRongDauTien(
      current?.id,
      current?.message_id,
      current?._local_echo_id
    );
    const incomingId = this._chuoiKhongRongDauTien(
      incoming?.id,
      incoming?.message_id,
      incoming?._local_echo_id
    );
    if (currentId && incomingId && currentId === incomingId) return true;

    if (
      current?.ts !== undefined &&
      current?.ts !== null &&
      incoming?.ts !== undefined &&
      incoming?.ts !== null &&
      current.ts === incoming.ts
    ) {
      return true;
    }

    const sameRole = current?.message_type === incoming?.message_type;
    const sameContent = current?.content === incoming?.content;
    const currentLocal = this._epKieuBoolean(current?._local_echo, false);
    const incomingLocal = this._epKieuBoolean(incoming?._local_echo, false);
    return sameRole && sameContent && currentLocal !== incomingLocal && (currentLocal || incomingLocal);
  }

  _hopNhatLichSuChat(...groups) {
    const merged = [];
    groups.forEach((group) => {
      if (!Array.isArray(group)) return;
      group.forEach((rawItem) => {
        const item = this._chuanHoaChatMuc(rawItem);
        if (!item) return;
        const previous = merged[merged.length - 1];
        if (previous && this._laChatMucTrung(previous, item)) {
          const nextItem = { ...previous, ...item };
          if (!this._epKieuBoolean(item._local_echo, false)) {
            delete nextItem._local_echo;
            delete nextItem._local_echo_id;
          }
          merged[merged.length - 1] = nextItem;
          return;
        }
        merged.push(item);
      });
    });
    return merged.slice(-60);
  }

  _dongBoLichSuChatTuEntity(items) {
    if (!Array.isArray(items)) return;
    const hasLocalEcho = this._chatHistory.some((item) => this._epKieuBoolean(item?._local_echo, false));
    this._chatHistory = hasLocalEcho
      ? this._hopNhatLichSuChat(this._chatHistory, items)
      : this._hopNhatLichSuChat(items);
    this._chatHistoryLoaded = true;
  }

  _themTinNhanChatTam(content, role = "user") {
    const item = this._chuanHoaChatMuc(
      {
        content,
        message_type: role,
        ts: Date.now(),
        _local_echo: true,
        _local_echo_id: `local-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      },
      role
    );
    if (!item) return;
    this._chatHistory = this._hopNhatLichSuChat(this._chatHistory, [item]);
    this._chatHistoryLoaded = true;
  }

  _laBluetoothDangBat(value, fallback = false) {
    if (value === undefined || value === null || value === "") return fallback;
    if (typeof value === "number" && Number.isFinite(value)) {
      return value === 3;
    }
    const normalized = String(value).trim().toLowerCase();
    if (!normalized) return fallback;
    const numeric = Number(normalized);
    if (Number.isFinite(numeric)) {
      return numeric === 3;
    }
    if (normalized.includes("bluetooth")) {
      if (
        normalized.includes("off") ||
        normalized.includes("disable") ||
        normalized.includes("disconnect") ||
        normalized.includes("idle")
      ) {
        return false;
      }
      return true;
    }
    return this._epKieuBoolean(normalized, fallback);
  }

  _datCongTacCho(key, desired, ttlMs = 5000) {
    this._pendingSwitches[key] = {
      value: Boolean(desired),
      expiresAt: Date.now() + ttlMs,
    };
  }

  _xoaCongTacCho(key) {
    delete this._pendingSwitches[key];
  }

  _layTrangThaiCongTac(key, deviceValue) {
    const resolvedDevice = Boolean(deviceValue);
    const pending = this._pendingSwitches[key];
    if (!pending) return resolvedDevice;
    if (Date.now() > pending.expiresAt) {
      this._xoaCongTacCho(key);
      return resolvedDevice;
    }
    if (resolvedDevice === pending.value) {
      this._xoaCongTacCho(key);
      return resolvedDevice;
    }
    return pending.value;
  }

  _laCongTacDangCho(key) {
    const pending = this._pendingSwitches[key];
    if (!pending) return false;
    if (Date.now() > pending.expiresAt) {
      this._xoaCongTacCho(key);
      return false;
    }
    return true;
  }

  _dongBoTuEntity() {
    const stateObj = this._doiTuongTrangThai();
    if (!stateObj) return;

    const attrs = stateObj.attributes || {};
    const wake = attrs.wake_word || {};
    const ai = attrs.custom_ai || {};
    const volumeLevel = attrs.volume_level;

    if (typeof volumeLevel === "number") {
      this._volumeLevel = Math.max(0, Math.min(1, volumeLevel));
    }
    const sensitivity = this._epKieuSo(
      wake.sensitivity ?? wake.value,
      this._wakeSensitivity
    );
    if (Number.isFinite(sensitivity)) {
      this._wakeSensitivity = Math.max(0, Math.min(1, sensitivity));
    }

    const wakeEnabled = this._epKieuBoolean(
      wake.enabled ?? wake.enable ?? wake.state,
      this._wakeEnabled
    );
    const antiDeafEnabled = this._epKieuBoolean(
      ai.enabled ?? ai.enable ?? ai.state,
      this._antiDeafEnabled
    );
    const dlnaRaw =
      attrs.dlna_open ??
      attrs.dlnaOpen ??
      attrs.dlna ??
      attrs.dlna_enabled ??
      attrs.dlnaEnabled;
    const airplayRaw =
      attrs.airplay_open ??
      attrs.airplayOpen ??
      attrs.airplay ??
      attrs.airplay_enabled ??
      attrs.airplayEnabled;
    const bluetoothRaw =
      attrs.device_state ??
      attrs.deviceState ??
      attrs.bluetooth_state ??
      attrs.bluetoothState;
    const mainLightRaw =
      attrs.music_light_enable ??
      attrs.musicLightEnable ??
      attrs.main_light_enabled ??
      attrs.mainLightEnabled;

    const dlnaEnabled = this._epKieuBoolean(dlnaRaw, this._dlnaEnabled);
    const airplayEnabled = this._epKieuBoolean(airplayRaw, this._airplayEnabled);
    const bluetoothEnabled = this._laBluetoothDangBat(bluetoothRaw, this._bluetoothEnabled);
    const mainLightEnabled = this._epKieuBoolean(mainLightRaw, this._mainLightEnabled);

    this._wakeEnabled = this._layTrangThaiCongTac("wake_enabled", wakeEnabled);
    this._antiDeafEnabled = this._layTrangThaiCongTac("anti_deaf_enabled", antiDeafEnabled);
    this._dlnaEnabled = this._layTrangThaiCongTac("dlna_enabled", dlnaEnabled);
    this._airplayEnabled = this._layTrangThaiCongTac("airplay_enabled", airplayEnabled);
    this._bluetoothEnabled = this._layTrangThaiCongTac("bluetooth_enabled", bluetoothEnabled);
    this._mainLightEnabled = this._layTrangThaiCongTac("main_light_enabled", mainLightEnabled);

    if (typeof attrs.music_light_luma === "number") {
      this._mainLightBrightness = Math.max(1, Math.min(200, attrs.music_light_luma));
    }
    if (typeof attrs.music_light_chroma === "number") {
      this._mainLightSpeed = Math.max(1, Math.min(100, attrs.music_light_chroma));
    }

    const mainLightMode = this._epKieuSo(
      attrs.music_light_mode ?? attrs.musicLightMode,
      this._mainLightMode
    );
    if (Number.isFinite(mainLightMode)) {
      this._mainLightMode = Math.max(0, Math.round(mainLightMode));
    }

    const audioConfig = attrs.audio_config || attrs.audioConfig || {};
    const eqConfig = attrs.eq_state || attrs.eqState || audioConfig.eq || {};
    const bassConfig = attrs.bass_state || attrs.bassState || audioConfig.bass || {};
    const loudnessConfig =
      attrs.loudness_state || attrs.loudnessState || audioConfig.loudness || {};
    const edgeLight = attrs.edge_light || attrs.edgeLight || {};
    const dangGiuEqCucBo = Date.now() < this._eqSyncGuardUntil;
    if (!dangGiuEqCucBo) {
      this._eqEnabled = this._epKieuBoolean(
        eqConfig.Eq_Enable ??
          eqConfig.sound_effects_eq_enable ??
          eqConfig.eq_enable ??
          eqConfig.enabled,
        this._eqEnabled
      );

      const eqBands = Array.isArray(eqConfig.Bands?.list) ? eqConfig.Bands.list : [];
      if (eqBands.length > 0) {
        this._eqBandCount = eqBands.length;
        this._eqBands = eqBands.map((bandItem) =>
          this._gioiHanEqLevel(
            bandItem?.BandLevel ?? bandItem?.band_level ?? bandItem?.level,
            0
          )
        );
        this._eqBand = Math.max(
          0,
          Math.min(this._eqBandCount - 1, Math.round(this._eqBand))
        );
        this._eqLevel = this._layEqLevelTheoBand(this._eqBand);
      } else {
        this._eqBandCount = Math.max(
          1,
          this._eqBands.length || this._eqBandCount || EQ_BAND_LABELS.length
        );
        this._eqBand = Math.max(0, Math.min(this._eqBandCount - 1, Math.round(this._eqBand)));
        this._eqLevel = this._layEqLevelTheoBand(this._eqBand);
      }
    } else {
      this._eqBandCount = Math.max(
        1,
        this._eqBands.length || this._eqBandCount || EQ_BAND_LABELS.length
      );
      this._eqBand = Math.max(0, Math.min(this._eqBandCount - 1, Math.round(this._eqBand)));
      this._eqLevel = this._layEqLevelTheoBand(this._eqBand);
    }

    this._bassEnabled = this._epKieuBoolean(
      bassConfig.Bass_Enable ??
        bassConfig.sound_effects_bass_enable ??
        bassConfig.bass_enable ??
        bassConfig.enabled,
      this._bassEnabled
    );
    const bassStrength = this._epKieuSo(
      bassConfig.Current_Strength ??
        bassConfig.current_strength ??
        bassConfig.strength,
      this._bassStrength
    );
    if (Number.isFinite(bassStrength)) {
      this._bassStrength = Math.max(0, Math.min(1000, Math.round(bassStrength)));
    }

    this._loudnessEnabled = this._epKieuBoolean(
      loudnessConfig.Loudness_Enable ??
        loudnessConfig.sound_effects_loudness_enable ??
        loudnessConfig.loudness_enable ??
        loudnessConfig.enabled,
      this._loudnessEnabled
    );
    const loudnessGain = this._epKieuSo(
      loudnessConfig.Current_Gain ??
        loudnessConfig.current_gain ??
        loudnessConfig.gain,
      this._loudnessGain
    );
    if (Number.isFinite(loudnessGain)) {
      this._loudnessGain = Math.max(-3000, Math.min(3000, Math.round(loudnessGain)));
    }

    this._edgeLightEnabled = this._epKieuBoolean(
      edgeLight.enabled ?? edgeLight.enable ?? edgeLight.state,
      this._edgeLightEnabled
    );
    const edgeIntensity = this._epKieuSo(
      edgeLight.intensity ?? edgeLight.value,
      this._edgeLightIntensity
    );
    if (Number.isFinite(edgeIntensity)) {
      this._edgeLightIntensity = Math.max(0, Math.min(100, Math.round(edgeIntensity)));
    }

    this._dongBoLichSuChatTuEntity(attrs.last_chat_items);
  }

  async _goiDichVu(domain, service, data = {}) {
    if (!this._hass || !this._config) return;
    const payload = {
      entity_id: this._config.entity,
      ...data,
    };

    const candidateDomains = [domain];
    if (domain === "phicomm_r1") {
      candidateDomains.push("media_player");
    } else if (domain === "media_player") {
      candidateDomains.push("phicomm_r1");
    }

    const seen = new Set();
    for (const candidate of candidateDomains) {
      if (!candidate || seen.has(candidate)) continue;
      seen.add(candidate);
      if (this._hass.services?.[candidate]?.[service]) {
        await this._hass.callService(candidate, service, payload);
        return;
      }
    }

    await this._hass.callService(domain, service, payload);
  }

  async _lamMoiEntity(delayMs = 250, attempts = 1) {
    if (!this._hass || !this._config) return;
    const totalAttempts = Math.max(1, Number(attempts) || 1);
    for (let attempt = 0; attempt < totalAttempts; attempt += 1) {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }

      let refreshed = false;
      try {
        await this._goiDichVu("phicomm_r1", "refresh_state");
        refreshed = true;
      } catch (err) {
        refreshed = false;
      }

      if (!refreshed) {
        await this._hass.callService("homeassistant", "update_entity", {
          entity_id: this._config.entity,
        });
      }
    }
  }

  async _choSuKienPlaylistMoi(previousKey, predicate, timeoutMs = 6000) {
    if (!this._hass || !this._config) return null;
    const startedAt = Date.now();
    let lastRefreshAt = 0;
    while (Date.now() - startedAt < timeoutMs) {
      const event = this._thuocTinh().last_playlist_event || {};
      const currentKey = this._khoaTrangThaiPayload(event);
      if (currentKey && currentKey !== previousKey && predicate(event)) {
        return event;
      }
      const elapsed = Date.now() - startedAt;
      if (elapsed - lastRefreshAt >= 1200) {
        lastRefreshAt = elapsed;
        try {
          await this._hass.callService("homeassistant", "update_entity", {
            entity_id: this._config.entity,
          });
        } catch (_) {
          /* ignore */
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    return null;
  }

  async _taiThuVienPlaylist(reRender = true) {
    const previousKey = this._khoaTrangThaiPayload(this._thuocTinh().playlist_library || {});
    this._playlistLibraryLoading = true;
    if (reRender) this._veGiaoDien();
    try {
      await this._goiDichVu("media_player", "playlist_list");
      await this._choPayloadPlaylistMoi(
        previousKey,
        () => this._thuocTinh().playlist_library || {},
        4500
      );
    } finally {
      this._playlistLibraryLoading = false;
      if (reRender) this._veGiaoDien();
    }
  }

  async _taiChiTietPlaylist(playlistId, reRender = true) {
    const normalizedPlaylistId = String(playlistId || "").trim();
    if (!normalizedPlaylistId) return;
    this._playlistDetailVisibleId = normalizedPlaylistId;
    this._playlistDetailLoading = true;
    if (reRender) this._veGiaoDien();
    try {
      await this._goiDichVu("media_player", "playlist_get_songs", {
        playlist_id: normalizedPlaylistId,
      });
    } finally {
      this._playlistDetailLoading = false;
      if (reRender) this._veGiaoDien();
    }
  }

  _moDialogPlaylist(mode, pendingItem = null, pendingSource = "") {
    this._playlistDialog = {
      open: true,
      mode,
      selectedPlaylistId: "",
      newPlaylistName: "",
      pendingItem: pendingItem ? { ...pendingItem } : null,
      pendingSource,
      busy: false,
      error: "",
    };
    this._veGiaoDien();
  }

  _dongDialogPlaylist() {
    this._playlistDialog = this._taoTrangThaiDialogPlaylist();
    this._veGiaoDien();
  }

  async _choPayloadPlaylistMoi(previousKey, payloadFactory, timeoutMs = 4500) {
    if (!this._hass || !this._config) return null;
    const startedAt = Date.now();
    let lastRefreshAt = 0;
    while (Date.now() - startedAt < timeoutMs) {
      const payload = payloadFactory();
      const currentKey = this._khoaTrangThaiPayload(payload);
      if (currentKey && currentKey !== previousKey) {
        return payload;
      }
      const elapsed = Date.now() - startedAt;
      if (elapsed - lastRefreshAt >= 1200) {
        lastRefreshAt = elapsed;
        try {
          await this._hass.callService("homeassistant", "update_entity", {
            entity_id: this._config.entity,
          });
        } catch (_) {
          /* ignore */
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    return payloadFactory();
  }

  async _moDialogThemPlaylist(item, source) {
    try {
      await this._taiThuVienPlaylist(false);
    } catch (_) {
      /* keep the dialog usable with the latest local library snapshot */
    }
    this._moDialogPlaylist("add", item, source);
  }

  _moDialogTaoPlaylist() {
    this._moDialogPlaylist("create");
  }

  async _themTrackVaoPlaylist(playlistId, trackPayload) {
    const previousKey = this._khoaTrangThaiPayload(this._thuocTinh().last_playlist_event || {});
    await this._goiDichVu("media_player", "playlist_add_song", {
      playlist_id: playlistId,
      source: trackPayload.source,
      id: trackPayload.id,
      title: trackPayload.title,
      artist: trackPayload.artist,
      thumbnail_url: trackPayload.thumbnail_url,
      duration_seconds: trackPayload.duration_seconds,
    });
    const event = await this._choSuKienPlaylistMoi(
      previousKey,
      (payload) => {
        const type = String(payload?.type || "").toLowerCase();
        return type.includes("playlist_song_added");
      },
      6000
    );
    if (!event) {
      throw new Error("Không nhận được xác nhận thêm bài vào playlist");
    }
    return event;
  }

  async _taoPlaylistTuDialog(name, requirePlaylistId = false) {
    const normalizedName = String(name || "").trim();
    if (!normalizedName) {
      throw new Error("Vui lòng nhập tên playlist");
    }
    const previousKey = this._khoaTrangThaiPayload(this._thuocTinh().last_playlist_event || {});
    await this._goiDichVu("media_player", "playlist_create", { name: normalizedName });
    const event = await this._choSuKienPlaylistMoi(
      previousKey,
      (payload) => {
        const type = String(payload?.type || "").toLowerCase();
        return type.includes("playlist_created");
      },
      6000
    );
    if (!event) {
      throw new Error("Không nhận được xác nhận tạo playlist");
    }
    const playlistId = String(event?.playlist_id || "").trim();
    if (playlistId || !requirePlaylistId) {
      return event;
    }

    await this._taiThuVienPlaylist(false);
    const matchedPlaylists = this._timPlaylistTheoTen(normalizedName);
    if (matchedPlaylists.length === 1 && matchedPlaylists[0]?.id) {
      return {
        ...event,
        playlist_id: String(matchedPlaylists[0].id).trim(),
        playlist_name: matchedPlaylists[0].name || normalizedName,
      };
    }
    if (matchedPlaylists.length > 1) {
      const error = new Error(
        "Đã tạo playlist nhưng có nhiều playlist trùng tên. Vui lòng chọn thủ công trong danh sách."
      );
      error.manualSelectionRequired = true;
      throw error;
    }
    const error = new Error(
      "Đã tạo playlist nhưng chưa xác định được playlist mới. Vui lòng chọn thủ công trong danh sách."
    );
    error.manualSelectionRequired = true;
    throw error;
  }

  async _xacNhanDialogPlaylist() {
    const dialog = this._playlistDialog;
    if (!dialog.open || dialog.busy) return;

    const selectedPlaylistId = String(dialog.selectedPlaylistId || "").trim();
    const newPlaylistName = String(dialog.newPlaylistName || "").trim();
    const nextDialog = { ...dialog, busy: true, error: "" };
    this._playlistDialog = nextDialog;
    this._veGiaoDien();

    try {
      if (dialog.mode === "create") {
        await this._taoPlaylistTuDialog(newPlaylistName, false);
        await this._taiThuVienPlaylist(false);
        this._playlistDialog = this._taoTrangThaiDialogPlaylist();
        this._veGiaoDien();
        return;
      }

      const trackPayload = this._duLieuThemPlaylist(dialog.pendingItem, dialog.pendingSource);
      if (!trackPayload) {
        throw new Error("Không có bài hát hợp lệ để thêm vào playlist");
      }

      let playlistId = selectedPlaylistId;
      if (newPlaylistName) {
        const createdEvent = await this._taoPlaylistTuDialog(newPlaylistName, true);
        playlistId = String(createdEvent.playlist_id || "").trim();
      }
      if (!playlistId) {
        throw new Error("Vui lòng chọn playlist hoặc nhập tên playlist mới");
      }

      await this._themTrackVaoPlaylist(playlistId, trackPayload);
      await this._taiThuVienPlaylist(false);
      if (this._playlistDetailVisibleId === playlistId) {
        await this._taiChiTietPlaylist(playlistId, false);
      }
      this._playlistDialog = this._taoTrangThaiDialogPlaylist();
      this._veGiaoDien();
    } catch (err) {
      const manualSelectionRequired =
        Boolean(err) &&
        typeof err === "object" &&
        Boolean(err.manualSelectionRequired);
      this._playlistDialog = {
        ...nextDialog,
        busy: false,
        newPlaylistName: manualSelectionRequired ? "" : nextDialog.newPlaylistName,
        error: err instanceof Error ? err.message : "Không thể xử lý playlist",
      };
      this._veGiaoDien();
    }
  }

  _laPhatDangHoatDong(value) {
    if (value === true || value === 1 || value === 3) return true;
    if (typeof value === "number" && value > 0) {
      return value === 1 || value === 3;
    }
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      return (
        normalized === "true" ||
        normalized === "1" ||
        normalized === "3" ||
        normalized === "playing" ||
        normalized === "play" ||
        normalized === "on"
      );
    }
    return false;
  }

  _laPhatKhongHoatDong(value) {
    if (value === false || value === 0 || value === 2) return true;
    if (typeof value === "number") {
      return value === 0 || value === 2;
    }
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      return (
        normalized === "false" ||
        normalized === "0" ||
        normalized === "2" ||
        normalized === "paused" ||
        normalized === "pause" ||
        normalized === "stopped" ||
        normalized === "stop" ||
        normalized === "idle" ||
        normalized === "off"
      );
    }
    return false;
  }

  _chuanHoaTrangThaiPhatGiaTri(value) {
    if (value === true || value === 1 || value === 3) return "playing";
    if (value === false) return "paused";
    if (typeof value === "number") {
      if (value === 0 || value === 2) return "paused";
      return "";
    }
    if (typeof value !== "string") return "";
    const normalized = value.trim().toLowerCase();
    if (!normalized) return "";
    if (["true", "1", "3", "playing", "play", "on"].includes(normalized)) return "playing";
    if (["paused", "pause"].includes(normalized)) return "paused";
    if (["false", "0", "2", "stopped", "stop", "idle", "off"].includes(normalized)) return "idle";
    return "";
  }

  _giaiMaTrangThaiPhat(...values) {
    for (const value of values) {
      const resolved = this._chuanHoaTrangThaiPhatGiaTri(value);
      if (resolved) return resolved;
    }
    return "";
  }

  _xoaHenGioTienDo() {
    if (this._progressTimerId === null) return;
    clearInterval(this._progressTimerId);
    this._progressTimerId = null;
  }

  _batDauHenGioTienDo() {
    if (this._progressTimerId !== null) return;
    this._progressTimerId = window.setInterval(() => {
      this._xuLyNhipHenGioTienDo();
    }, 1000);
  }

  _capNhatHenGioTienDo() {
    const shouldRun = this._activeTab === "media" && this._livePlaying;
    if (shouldRun) {
      this._batDauHenGioTienDo();
    } else {
      this._xoaHenGioTienDo();
    }
  }

  _dongBoTienDoTrucTiep(trackKey, positionSeconds, durationSeconds, isPlaying) {
    const now = Date.now();
    const posRaw = Number.isFinite(Number(positionSeconds)) ? Math.max(0, Number(positionSeconds)) : 0;
    const dur = Number.isFinite(Number(durationSeconds)) ? Math.max(0, Number(durationSeconds)) : 0;
    const pos = dur > 0 ? Math.min(posRaw, dur) : posRaw;
    const sameTrack = Boolean(trackKey) && trackKey === this._liveTrackKey;

    if (!trackKey && !isPlaying && pos <= 0 && dur <= 0) {
      this._liveTrackKey = "";
      this._livePositionSeconds = 0;
      this._liveDurationSeconds = 0;
      this._livePlaying = false;
      this._liveTickAt = now;
      return;
    }

    if (!sameTrack) {
      this._liveTrackKey = trackKey;
      this._livePositionSeconds = pos;
    } else if (!isPlaying || Math.abs(pos - this._livePositionSeconds) > 2) {
      this._livePositionSeconds = pos;
    } else if (pos > this._livePositionSeconds) {
      this._livePositionSeconds = pos;
    }

    this._liveDurationSeconds = dur;
    this._livePlaying = Boolean(isPlaying);
    this._liveTickAt = now;
  }

  _xuLyNhipHenGioTienDo() {
    if (!this._livePlaying) {
      this._dongBoTienDoDom();
      return;
    }

    const now = Date.now();
    const elapsed = Math.max(0, (now - this._liveTickAt) / 1000);
    this._liveTickAt = now;
    if (elapsed <= 0) return;

    if (this._liveDurationSeconds > 0) {
      this._livePositionSeconds = Math.min(
        this._liveDurationSeconds,
        this._livePositionSeconds + elapsed
      );
      if (this._livePositionSeconds >= this._liveDurationSeconds - 0.2) {
        this._livePlaying = false;
      }
    } else {
      this._livePositionSeconds += elapsed;
    }

    this._dongBoTienDoDom();
    this._capNhatHenGioTienDo();
  }

  _dongBoTienDoDom() {
    const root = this.shadowRoot;
    if (!root) return;
    const positionEl = root.getElementById("playback-position");
    const durationEl = root.getElementById("playback-duration");
    const progressEl = root.getElementById("playback-progress");
    const progressTrackEl = root.getElementById("playback-progress-track");
    const progressThumbEl = root.getElementById("playback-progress-thumb");

    if (positionEl) {
      positionEl.textContent = this._dinhDangDongHo(this._livePositionSeconds, "0:00");
    }

    if (durationEl) {
      durationEl.textContent =
        this._liveDurationSeconds > 0 ? this._dinhDangThoiLuong(this._liveDurationSeconds) : "--:--";
    }

    if (progressEl) {
      const progressPercent =
        this._liveDurationSeconds > 0
          ? Math.max(0, Math.min(100, (this._livePositionSeconds / this._liveDurationSeconds) * 100))
          : 0;
      progressEl.style.width = `${progressPercent.toFixed(2)}%`;
      if (progressThumbEl) {
        progressThumbEl.style.left = `${progressPercent.toFixed(2)}%`;
      }
      if (progressTrackEl) {
        progressTrackEl.setAttribute("aria-valuenow", String(Math.round(this._livePositionSeconds)));
        progressTrackEl.setAttribute("aria-valuemax", String(Math.max(0, Math.round(this._liveDurationSeconds))));
      }
    }
  }

  _thongTinPhat() {
    const attrs = this._thuocTinh();
    const search = attrs.last_music_search || {};
    const play = attrs.last_music_play || {};
    const aibox = attrs.aibox_playback || {};
    const items = Array.isArray(search.items) ? search.items : [];
    const stateObj = this._doiTuongTrangThai();
    const playUpdatedAtMs = this._mocCapNhatPayload(play);
    const playIsFresh =
      playUpdatedAtMs > 0 && Date.now() - playUpdatedAtMs <= NOW_PLAYING_FALLBACK_WINDOW_MS;
    const entityPlaybackState = this._giaiMaTrangThaiPhat(
      attrs.playback_state_raw,
      stateObj?.state
    );
    const aiboxPlaybackState = this._giaiMaTrangThaiPhat(
      aibox.state,
      aibox.play_state,
      aibox.is_playing
    );
    const hasExplicitStop = aiboxPlaybackState === "idle" || entityPlaybackState === "idle";
    const candidateIds = Array.from(
      new Set(
        [
          aibox.id,
          aibox.video_id,
          aibox.song_id,
          aibox.track_id,
          aibox.playlist_id,
          playIsFresh ? play.id : "",
          playIsFresh ? play.video_id : "",
          playIsFresh ? play.song_id : "",
          playIsFresh ? play.track_id : "",
          playIsFresh ? play.playlist_id : "",
        ]
          .map((value) => String(value || "").trim())
          .filter(Boolean)
      )
    );
    const matchedItem = hasExplicitStop
      ? null
      : items.find((item) =>
          this._layDanhSachIdMucMedia(item).some((itemId) => candidateIds.includes(itemId))
        ) || null;
    const playFallback = !hasExplicitStop && playIsFresh ? play : {};

    const rawTitle = this._chuoiKhongRongDauTien(
      aibox.title,
      attrs.media_title,
      matchedItem?.title,
      playFallback.title
    );
    let title = this._laTieuDeNghi(rawTitle) ? "" : rawTitle;
    let artist = this._chuoiKhongRongDauTien(
      aibox.artist,
      aibox.channel,
      attrs.media_artist,
      matchedItem?.artist,
      matchedItem?.channel,
      playFallback.artist
    );
    let duration = this._epKieuGiayPhat(
      aibox.duration ??
        attrs.media_duration ??
        matchedItem?.duration_seconds ??
        playFallback.duration_seconds ??
        playFallback.duration,
      0
    );
    let position = this._epKieuGiayPhat(
      aibox.position ?? attrs.media_position ?? playFallback.position,
      0
    );
    if (duration > 0 && position > duration) {
      position = duration;
    }
    let source = this._chuoiKhongRongDauTien(
      aibox.source,
      playFallback.source,
      matchedItem?.source
    );
    let thumbnailUrl = this._chuoiKhongRongDauTien(
      aibox.thumbnail_url,
      attrs.entity_picture,
      matchedItem?.thumbnail_url,
      playFallback.thumbnail_url
    );
    const aiboxTrackId = this._chuoiKhongRongDauTien(
      aibox.video_id,
      aibox.song_id,
      aibox.id,
      aibox.track_id
    );
    const playlistId = this._chuoiKhongRongDauTien(
      aibox.playlist_id,
      playFallback.playlist_id,
      matchedItem?.playlist_id
    );
    const trackId = this._chuoiKhongRongDauTien(
      aiboxTrackId,
      playFallback.video_id,
      playFallback.song_id,
      playFallback.id,
      this._layIdMucMedia(matchedItem)
    );
    const aiboxPlaying = aiboxPlaybackState === "playing";
    const aiboxPaused = aiboxPlaybackState === "paused";

    const rawTrackKey = this._chuoiKhongRongDauTien(
      trackId ? `track:${trackId}` : "",
      playlistId && title ? `playlist:${playlistId}|${title}` : "",
      source && title ? `${source}|${title}|${artist}|${duration}` : ""
    );
    const hardStopRaw =
      position <= 0 &&
      duration <= 0 &&
      (hasExplicitStop ||
        (!aiboxPlaybackState &&
          !entityPlaybackState &&
          !title &&
          !trackId &&
          !playlistId &&
          !this._chuoiKhongRongDauTien(
            aibox.title,
            aibox.artist,
            aibox.channel,
            aibox.id,
            aibox.video_id,
            aibox.song_id,
            aibox.playlist_id
          )));

    if (hardStopRaw) {
      this._nowPlayingCache = this._taoNowPlayingCache();
    } else {
      const hasFreshTrack = Boolean(rawTrackKey) && Boolean(title);
      if (hasFreshTrack) {
        this._nowPlayingCache = {
          trackKey: rawTrackKey,
          trackId,
          playlistId,
          title,
          artist,
          source,
          thumbnail_url: thumbnailUrl,
          duration,
        };
      } else {
        const cached = this._nowPlayingCache;
        const cacheCompatible =
          Boolean(cached.trackKey) &&
          (!trackId || !cached.trackId || trackId === cached.trackId) &&
          (!playlistId || !cached.playlistId || playlistId === cached.playlistId);
        const canUseCache =
          cacheCompatible &&
          (aiboxPlaying ||
            aiboxPaused ||
            entityPlaybackState === "playing" ||
            entityPlaybackState === "paused" ||
            position > 0 ||
            duration > 0 ||
            Boolean(this._chuoiKhongRongDauTien(source, trackId, playlistId)));
        if (canUseCache) {
          title = title || cached.title;
          artist = artist || cached.artist;
          source = source || cached.source;
          thumbnailUrl = thumbnailUrl || cached.thumbnail_url;
          if (duration <= 0 && cached.duration > 0) {
            duration = cached.duration;
          }
        }
      }
    }

    if (!title) {
      title = "Chưa có bài đang phát";
    }
    const trackKey = this._chuoiKhongRongDauTien(
      rawTrackKey,
      this._nowPlayingCache.trackKey,
      source && title ? `${source}|${title}|${artist}|${duration}` : ""
    );

    return {
      title,
      artist,
      duration,
      position,
      source,
      thumbnail_url: thumbnailUrl,
      track_key: trackKey,
      track_id: trackId,
      playlist_id: playlistId,
      play,
      search,
      items,
      aibox,
      aibox_playback_state: aiboxPlaybackState,
      entity_playback_state: entityPlaybackState,
    };
  }

  _layTrangThaiHienThiPhat(playback, stateObj = this._doiTuongTrangThai()) {
    const entityState = String(stateObj?.state || "idle").toLowerCase();
    const rawPlaybackState = String(stateObj?.attributes?.playback_state_raw || "").toLowerCase();
    const aiboxState = this._giaiMaTrangThaiPhat(
      playback.aibox?.state,
      playback.aibox?.play_state,
      playback.aibox?.is_playing
    );
    const entityPlaybackState = this._giaiMaTrangThaiPhat(rawPlaybackState, entityState);
    const forcedPaused = Date.now() < this._forcePauseUntil;
    const optimisticPlaying =
      Date.now() < this._optimisticPlayUntil &&
      this._lastPlayPauseSent === "play" &&
      !forcedPaused &&
      aiboxState !== "paused" &&
      aiboxState !== "idle" &&
      entityPlaybackState !== "paused" &&
      entityPlaybackState !== "idle";

    let currentState = "idle";
    if (!forcedPaused && aiboxState === "playing") {
      currentState = "playing";
    } else if (aiboxState) {
      currentState = aiboxState;
    } else if (!forcedPaused && entityPlaybackState === "playing") {
      currentState = "playing";
    } else if (entityPlaybackState) {
      currentState = entityPlaybackState;
    } else if (optimisticPlaying) {
      currentState = "playing";
    } else if (forcedPaused || this._lastPlayPauseSent === "pause") {
      currentState = "paused";
    }

    return {
      isPlaying: currentState === "playing",
      currentState,
      entityState,
      rawPlaybackState,
      aiboxPlaying: aiboxState === "playing",
      aiboxPaused: aiboxState === "paused",
      aiboxIdle: aiboxState === "idle",
      entityPlaying: entityPlaybackState === "playing",
      entityPaused: entityPlaybackState === "paused",
      entityIdle: entityPlaybackState === "idle",
    };
  }

  _veCotSong() {
    const seeds = [18, 36, 14, 48, 26, 40, 22, 52, 30, 44, 20, 38];
    return Array.from({ length: 46 }, (_, idx) => {
      const h = seeds[idx % seeds.length];
      return `<span class="wave-bar" style="--i:${idx};--h:${h}px"></span>`;
    }).join("");
  }

  _timDichVuTheoTab(tab) {
    if (tab === "zing") return "search_zing";
    if (tab === "playlist") return "search_playlist";
    if (this._laTabQuanLyPlaylist(tab)) return "";
    return "search_youtube";
  }

  _nguonKetQuaTheoTab(tab) {
    if (tab === "zing") return "zingmp3";
    if (tab === "playlist") return "youtube_playlist";
    if (this._laTabQuanLyPlaylist(tab)) return "";
    return "youtube";
  }

  _mocCapNhatTimKiem(search) {
    const raw =
      search?.updated_at_ms ??
      search?.updatedAtMs ??
      search?.updated_at ??
      search?.updatedAt;
    const numeric = Number(raw);
    return Number.isFinite(numeric) ? numeric : 0;
  }

  _dauVetKetQuaTimKiem(search) {
    if (!search || typeof search !== "object") return "";
    const items = Array.isArray(search.items) ? search.items : [];
    const compactItems = items.slice(0, 5).map((item) => ({
      id: String(item?.id ?? ""),
      title: String(item?.title ?? ""),
      artist: String(item?.artist ?? ""),
    }));
    return JSON.stringify({
      query: String(search.query || "").trim().toLowerCase(),
      source: String(search.source || "").trim().toLowerCase(),
      total: Number(search.total || 0),
      success: Boolean(search.success),
      items: compactItems,
    });
  }

  _khoaTrangThaiTimKiem(search) {
    if (!search || typeof search !== "object") return "";
    return `${this._mocCapNhatTimKiem(search)}|${this._dauVetKetQuaTimKiem(search)}`;
  }

  _ketQuaTimKiemKhopYeuCau(search, query, source) {
    if (!search || typeof search !== "object") return false;
    const q = String(search.query || "").trim().toLowerCase();
    const s = String(search.source || "").trim().toLowerCase();
    const targetQuery = String(query || "").trim().toLowerCase();
    const targetSource = String(source || "").trim().toLowerCase();
    const queryKhop = Boolean(targetQuery) && q === targetQuery;
    const sourceKhop = !targetSource || !s || s === targetSource;
    return queryKhop && sourceKhop;
  }

  _laKetQuaTimKiemMoi(search, query, source, mocTruoc, dauVetTruoc = "") {
    if (!search || typeof search !== "object") return false;
    if (!this._ketQuaTimKiemKhopYeuCau(search, query, source)) return false;
    const mocHienTai = this._mocCapNhatTimKiem(search);
    if (mocHienTai > 0 || mocTruoc > 0) {
      return mocTruoc > 0 ? mocHienTai > mocTruoc : mocHienTai > 0;
    }

    // Fallback for integrations not yet exposing updated_at_ms:
    // accept when payload fingerprint changed and query/source already match.
    const dauVetHienTai = this._dauVetKetQuaTimKiem(search);
    if (!dauVetHienTai) return false;
    if (!dauVetTruoc) return true;
    return dauVetHienTai !== dauVetTruoc;
  }

  async _choKetQuaTimKiemMoi(query, source, mocTruoc, dauVetTruoc = "", timeoutMs = 15000) {
    const batDau = Date.now();
    let lastRefreshAt = 0;
    while (Date.now() - batDau < timeoutMs) {
      const search = this._thuocTinh().last_music_search || {};
      if (this._laKetQuaTimKiemMoi(search, query, source, mocTruoc, dauVetTruoc)) {
        return true;
      }
      // Search services already write entity state directly; only use
      // Home Assistant's generic entity refresh as a gentle fallback.
      const elapsed = Date.now() - batDau;
      if (elapsed - lastRefreshAt >= 1200) {
        lastRefreshAt = elapsed;
        try {
          await this._hass.callService("homeassistant", "update_entity", {
            entity_id: this._config.entity,
          });
        } catch (_) {
          /* ignore */
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    return false;
  }

  async _xuLyTimKiem(queryOverride = null) {
    const query = String(queryOverride ?? this._query).trim();
    if (!query) return;
    this._query = query;
    const service = this._timDichVuTheoTab(this._mediaSearchTab);
    const source = this._nguonKetQuaTheoTab(this._mediaSearchTab);
    if (!service || !source) return;
    const searchHienTai = this._thuocTinh().last_music_search || {};
    const mocTruoc = this._mocCapNhatTimKiem(searchHienTai);
    const dauVetTruoc = this._dauVetKetQuaTimKiem(searchHienTai);

    this._dangChoKetQuaTimKiem = true;
    this._timKiemDangCho = { query, source, mocTruoc, dauVetTruoc };
    let daCoKetQuaMoi = false;
    try {
      await this._goiDichVu("media_player", service, { query });

      daCoKetQuaMoi = await this._choKetQuaTimKiemMoi(query, source, mocTruoc, dauVetTruoc, 5000);
      if (!daCoKetQuaMoi) {
        // Gentle fallback for slower HA state propagation.
        try {
          await this._hass.callService("homeassistant", "update_entity", {
            entity_id: this._config.entity,
          });
        } catch (_) {
          /* ignore */
        }
        daCoKetQuaMoi = await this._choKetQuaTimKiemMoi(query, source, mocTruoc, dauVetTruoc, 4000);
      }
    } finally {
      this._dangChoKetQuaTimKiem = false;
      this._timKiemDangCho = null;
      const searchSauCung = this._thuocTinh().last_music_search || {};
      const coKetQuaPhuHop = this._ketQuaTimKiemKhopYeuCau(searchSauCung, query, source);
      const coKetQuaMoi =
        coKetQuaPhuHop &&
        this._laKetQuaTimKiemMoi(searchSauCung, query, source, mocTruoc, dauVetTruoc);
      if (daCoKetQuaMoi || coKetQuaMoi) {
        this._veGiaoDienGiuFocusTimKiem();
      } else {
        this._pendingRender = true;
        this._giuFocusTimKiemKhongRender();
      }
    }
  }

  async _xuLyPhatMuc(item, source) {
    const normalizedSource = String(source || item?.source || "").toLowerCase();
    if (this._laMucPlaylist(item, normalizedSource)) {
      const playlistId = this._chuoiKhongRongDauTien(
        item?.playlist_id,
        item?.playlistId,
        item?.id
      );
      if (!playlistId) return;
      await this._goiDichVu("media_player", "playlist_play", {
        playlist_id: playlistId,
      });
      if (this._mediaSearchTab === "playlists") {
        this._playlistDetailVisibleId = String(playlistId).trim();
      }
    } else if (normalizedSource.includes("zing")) {
      const songId = this._chuoiKhongRongDauTien(item?.song_id, item?.songId, item?.id);
      if (!songId) return;
      await this._goiDichVu("media_player", "play_zing", { song_id: songId });
    } else {
      const videoId = this._chuoiKhongRongDauTien(item?.video_id, item?.videoId, item?.id);
      if (!videoId) return;
      await this._goiDichVu("media_player", "play_youtube", { video_id: videoId });
    }
    this._lastPlayPauseSent = "play";
    this._forcePauseUntil = 0;
    this._optimisticPlayUntil = Date.now() + 5000;
    await this._lamMoiEntity(300, 2);
  }

  async _xuLyPhatTamDung() {
    const stateObj = this._doiTuongTrangThai();
    const playback = this._thongTinPhat();
    const playbackState = this._layTrangThaiHienThiPhat(playback, stateObj);
    const nextAction = playbackState.isPlaying ? "pause" : "play";

    await this._goiDichVu(
      "media_player",
      nextAction === "pause" ? "media_pause" : "media_play"
    );
    this._lastPlayPauseSent = nextAction;
    if (nextAction === "pause") {
      this._forcePauseUntil = Date.now() + 5000;
      this._optimisticPlayUntil = 0;
      this._livePlaying = false;
      this._dongBoTienDoDom();
      this._capNhatHenGioTienDo();
    } else {
      this._forcePauseUntil = 0;
      this._optimisticPlayUntil = Date.now() + 5000;
      if (this._liveDurationSeconds > 0 && this._livePositionSeconds < this._liveDurationSeconds) {
        this._livePlaying = true;
        this._liveTickAt = Date.now();
        this._dongBoTienDoDom();
        this._capNhatHenGioTienDo();
      }
    }
    await this._lamMoiEntity(300);
  }

  async _apDungEqMau(name) {
    const presets = {
      flat: [0, 0, 0, 0, 0],
      bass: [1200, 700, 0, -200, -100],
      vocal: [-300, 400, 900, 500, 200],
      rock: [500, 300, 100, 400, 600],
      jazz: [200, 200, 200, 400, 600],
    };
    const presetLevels = presets[name];
    if (!presetLevels) return;
    const targetCount = Math.max(1, this._eqBandCount || presetLevels.length);
    const levels = Array.from({ length: targetCount }, (_, index) =>
      this._gioiHanEqLevel(presetLevels[index] ?? 0, 0)
    );
    this._batDauCanhGacDongBoEq(1800);
    await this._goiDichVu("media_player", "set_eq_enable", { enabled: true });
    this._eqEnabled = true;
    this._eqBands = levels.slice();
    this._eqBandCount = levels.length;
    this._eqBand = Math.max(0, Math.min(this._eqBandCount - 1, this._eqBand));
    this._eqLevel = this._layEqLevelTheoBand(this._eqBand);
    this._capNhatEqGiaoDien(this.shadowRoot);
    for (let band = 0; band < levels.length; band += 1) {
      await this._goiDichVu("media_player", "set_eq_bandlevel", {
        band,
        level: levels[band],
      });
    }
    await this._lamMoiEntity(350);
  }

  _veThuVienPlaylist() {
    const playlists = this._thuVienPlaylist();
    const detail = this._chiTietPlaylistDangXem();
    const showDetail = Boolean(this._playlistDetailVisibleId);

    return `
      <div class="playlist-toolbar">
        <button id="btn-playlist-create" class="mini-btn mini-btn-primary" type="button">
          <ha-icon icon="mdi:playlist-plus"></ha-icon>
          <span>Tạo playlist</span>
        </button>
        <button id="btn-playlist-refresh" class="mini-btn" type="button">
          <ha-icon icon="mdi:refresh"></ha-icon>
          <span>${this._playlistLibraryLoading ? "Đang tải..." : "Làm mới"}</span>
        </button>
      </div>

      <div class="playlist-library">
        ${this._playlistLibraryLoading && playlists.length === 0 ? `
          <div class="empty">Đang tải danh sách playlist...</div>
        ` : playlists.length === 0 ? `
          <div class="empty">Chưa có playlist nào. Tạo playlist đầu tiên để bắt đầu.</div>
        ` : playlists.map((playlist, idx) => `
          <div class="playlist-card">
            <div class="playlist-card-main">
              <div class="playlist-card-title">${this._maHoaHtml(playlist.name || "Playlist")}</div>
              <div class="playlist-card-sub">${Number(playlist.song_count || 0)} bài hát</div>
            </div>
            <div class="playlist-card-actions">
              <button class="mini-btn playlist-view-btn" type="button" data-playlist-view-index="${idx}">
                <ha-icon icon="mdi:format-list-bulleted"></ha-icon>
                <span>Xem</span>
              </button>
              <button class="mini-btn mini-btn-danger playlist-play-btn" type="button" data-playlist-play-index="${idx}">
                <ha-icon icon="mdi:play"></ha-icon>
                <span>Phát</span>
              </button>
              <button class="mini-btn playlist-delete-btn" type="button" data-playlist-delete-index="${idx}">
                <ha-icon icon="mdi:trash-can-outline"></ha-icon>
              </button>
            </div>
          </div>
        `).join("")}
      </div>

      ${showDetail ? `
        <div class="playlist-detail-shell">
          <div class="playlist-detail-head">
            <div>
              <strong>${this._maHoaHtml(detail?.playlist_name || "Playlist")}</strong>
              <div class="playlist-card-sub">${detail ? detail.items.length : 0} bài hát</div>
            </div>
            <button id="playlist-detail-close" class="mini-btn" type="button">
              <ha-icon icon="mdi:close"></ha-icon>
              <span>Đóng</span>
            </button>
          </div>
          <div class="playlist-detail-list">
            ${this._playlistDetailLoading ? `
              <div class="empty">Đang tải bài hát trong playlist...</div>
            ` : !detail ? `
              <div class="empty">Chưa có dữ liệu playlist.</div>
            ` : detail.items.length === 0 ? `
              <div class="empty">Playlist này chưa có bài hát.</div>
            ` : detail.items.map((item, idx) => `
              <div class="playlist-song-row">
                <div class="playlist-song-meta">
                  <div class="playlist-song-title">${this._maHoaHtml(item.title || `Bài hát ${idx + 1}`)}</div>
                  <div class="playlist-song-sub">
                    ${this._maHoaHtml(item.artist || "Chưa rõ nghệ sĩ")}
                    <span>${this._dinhDangThoiLuong(item.duration_seconds)}</span>
                  </div>
                </div>
                <button
                  class="mini-btn playlist-song-remove-btn"
                  type="button"
                  data-playlist-song-index="${Number(item.index ?? idx)}"
                >
                  <ha-icon icon="mdi:trash-can-outline"></ha-icon>
                </button>
              </div>
            `).join("")}
          </div>
        </div>
      ` : ""}
    `;
  }

  _veDialogPlaylist() {
    const dialog = this._playlistDialog;
    if (!dialog.open) return "";
    const playlists = this._thuVienPlaylist();
    const pendingTitle = dialog.pendingItem?.title || dialog.pendingItem?.name || "";
    const confirmLabel =
      dialog.mode === "create"
        ? (dialog.busy ? "Đang tạo..." : "Tạo playlist")
        : (dialog.busy ? "Đang xử lý..." : "Xác nhận");

    return `
      <div class="playlist-dialog-backdrop">
        <div class="playlist-dialog" role="dialog" aria-modal="true" aria-label="Playlist">
          <div class="playlist-dialog-head">
            <strong>${dialog.mode === "create" ? "Tạo playlist" : "Thêm vào playlist"}</strong>
            <button id="playlist-dialog-cancel" class="mini-btn" type="button">
              <ha-icon icon="mdi:close"></ha-icon>
            </button>
          </div>

          ${dialog.mode === "add" ? `
            <div class="playlist-dialog-note">
              Bài hát: <strong>${this._maHoaHtml(pendingTitle || "Unknown")}</strong>
            </div>
            <label class="playlist-field">
              <span>Chọn playlist có sẵn</span>
              <select id="playlist-select" class="text-input playlist-select">
                <option value="">-- Chọn playlist --</option>
                ${playlists.map((playlist) => `
                  <option value="${this._maHoaHtml(playlist.id)}" ${String(dialog.selectedPlaylistId) === String(playlist.id) ? "selected" : ""}>
                    ${this._maHoaHtml(playlist.name || "Playlist")} (${Number(playlist.song_count || 0)} bài)
                  </option>
                `).join("")}
              </select>
            </label>
          ` : ""}

          <label class="playlist-field">
            <span>${dialog.mode === "create" ? "Tên playlist" : "Hoặc tạo playlist mới"}</span>
            <input
              id="playlist-new-name"
              class="text-input"
              type="text"
              placeholder="VD: Nhạc buổi sáng"
              value="${this._maHoaHtml(dialog.newPlaylistName)}"
            />
          </label>

          ${dialog.mode === "add" && playlists.length === 0 ? `
            <div class="playlist-dialog-note">Chưa có playlist nào. Bạn có thể nhập tên để tạo mới ngay.</div>
          ` : ""}
          ${dialog.error ? `<div class="playlist-dialog-error">${this._maHoaHtml(dialog.error)}</div>` : ""}

          <div class="playlist-dialog-actions">
            <button id="playlist-dialog-confirm" class="mini-btn mini-btn-primary" type="button" ${dialog.busy ? "disabled" : ""}>
              <span>${this._maHoaHtml(confirmLabel)}</span>
            </button>
          </div>
        </div>
      </div>
    `;
  }

  _veTabMedia(stateObj) {
    const playback = this._thongTinPhat();
    const playbackState = this._layTrangThaiHienThiPhat(playback, stateObj);
    const isPlaying = playbackState.isPlaying;
    const currentState = playbackState.currentState;
    const playPauseIcon = isPlaying ? "mdi:pause" : "mdi:play";
    const playPauseTitle = isPlaying ? "Tạm dừng" : "Phát";
    const source =
      currentState === "idle" && this._laTieuDeNghi(playback.title)
        ? "CHO PHAT"
        : this._nhanNguon(playback.source);
    const volumePercent = Math.round(this._volumeLevel * 100);
    const searchData = this._duLieuTimKiemTheoTab();
    const searchItems = Array.isArray(searchData.items) ? searchData.items : [];
    const listSource = searchData.source || playback.search?.source || playback.play?.source || "youtube";
    const isPlaylistManagerTab = this._mediaSearchTab === "playlists";
    const positionSeconds = this._epKieuGiayPhat(playback.position, 0);
    const durationSeconds = this._epKieuGiayPhat(playback.duration, 0);

    this._dongBoTienDoTrucTiep(playback.track_key || "", positionSeconds, durationSeconds, isPlaying);
    const livePositionSeconds = this._livePositionSeconds;
    const liveDurationSeconds = this._liveDurationSeconds > 0 ? this._liveDurationSeconds : durationSeconds;

    const progressPercent =
      liveDurationSeconds > 0
        ? Math.max(0, Math.min(100, (livePositionSeconds / liveDurationSeconds) * 100))
        : 0;
    const positionLabel = this._dinhDangDongHo(livePositionSeconds, "0:00");
    const durationLabel = liveDurationSeconds > 0 ? this._dinhDangThoiLuong(liveDurationSeconds) : "--:--";
    const coverUrl = this._maHoaHtml(playback.thumbnail_url || "");
    const waveBars = this._veCotSong();

    return `
      <section class="panel panel-media">
        <div class="hero ${isPlaying ? "is-playing" : "is-paused"}">
          ${coverUrl ? `<img class="hero-bg-img" src="${coverUrl}" alt="" />` : ""}
          <div class="hero-overlay"></div>
          <div class="hero-content">
          <div class="hero-top">
            <div class="hero-copy">
              <h2 class="song-title">${this._maHoaHtml(playback.title)}</h2>
              <div class="song-sub">${this._maHoaHtml(playback.artist || "Chưa rõ nghệ sĩ")}</div>
            </div>
            <span class="pill">${this._maHoaHtml(source)}</span>
          </div>

          <div class="player-stage">
            <div class="cover-disc ${isPlaying ? "spinning" : ""}">
              ${coverUrl ? `<img src="${coverUrl}" alt="" />` : `<ha-icon icon="mdi:music-note"></ha-icon>`}
            </div>
            <div class="wave-area">
              <div class="waveform">
                ${waveBars}
              </div>
              <div class="controls-row">
                <button id="btn-prev" class="icon-btn" title="Bài trước"><ha-icon icon="mdi:skip-previous"></ha-icon></button>
                <button id="btn-playpause" class="icon-btn icon-btn-primary" title="${playPauseTitle}"><ha-icon icon="${playPauseIcon}"></ha-icon></button>
                <button id="btn-stop" class="icon-btn" title="Dừng"><ha-icon icon="mdi:stop"></ha-icon></button>
                <button id="btn-next" class="icon-btn" title="Bài tiếp theo"><ha-icon icon="mdi:skip-next"></ha-icon></button>
              </div>
            </div>
          </div>

          <div class="timeline-row">
            <span id="playback-position" class="meta">${positionLabel}</span>
            <span id="playback-duration" class="meta">${durationLabel}</span>
          </div>
          <div
            id="playback-progress-track"
            class="progress-track"
            role="slider"
            aria-label="Thanh tua phát nhạc"
            aria-valuemin="0"
            aria-valuemax="${Math.max(0, Math.round(liveDurationSeconds))}"
            aria-valuenow="${Math.max(0, Math.round(livePositionSeconds))}"
          >
            <div id="playback-progress" class="progress-fill" style="width:${progressPercent.toFixed(2)}%"></div>
            <span id="playback-progress-thumb" class="progress-thumb" style="left:${progressPercent.toFixed(2)}%"></span>
          </div>

          <div class="meta-row">
            <span class="meta">Trạng thái: ${this._maHoaHtml(this._layNhanTrangThaiPhat(currentState))}</span>
            <span class="meta">${volumePercent}%</span>
          </div>
          </div>
        </div>

        <div class="subtabs">
          <button class="subtab ${this._mediaSearchTab === "songs" ? "active" : ""}" data-media-tab="songs">Youtube</button>
          <button class="subtab ${this._mediaSearchTab === "playlist" ? "active" : ""}" data-media-tab="playlist">Playlist</button>
          <button class="subtab ${this._mediaSearchTab === "zing" ? "active" : ""}" data-media-tab="zing">Zing MP3</button>
          <button class="subtab ${this._mediaSearchTab === "playlists" ? "active" : ""}" data-media-tab="playlists">Playlists</button>
        </div>

        ${isPlaylistManagerTab ? this._veThuVienPlaylist() : `
          <div class="search-row">
            <input id="media-query" class="text-input" type="text" placeholder="${this._maHoaHtml(this._placeholderTimKiemMedia())}" value="${this._maHoaHtml(this._query)}" />
            <button id="btn-search" class="icon-btn icon-btn-primary" title="Tìm kiếm"><ha-icon icon="mdi:magnify"></ha-icon></button>
          </div>
        `}

        <div class="volume-wrap">
          <div class="label-line">
            <span><ha-icon icon="mdi:volume-high"></ha-icon> Âm lượng</span>
            <strong>${volumePercent}%</strong>
          </div>
          <input id="media-volume" type="range" min="0" max="100" step="1" value="${volumePercent}" />
        </div>

        ${isPlaylistManagerTab ? "" : `
          <div class="results">
            ${searchItems.length === 0 ? `
              <div class="empty">
                Chưa có kết quả tìm kiếm. Nhập từ khóa và bấm Tìm kiếm.
              </div>
            ` : searchItems.map((item, idx) => {
              const itemId = this._layIdMucMedia(item);
              const itemTitle = item.title || `Bản nhạc ${idx + 1}`;
              const itemArtist = item.artist || item.channel || "Chưa rõ nghệ sĩ";
              const metaValue = this._laMucPlaylist(item, listSource)
                ? `${Number(item.song_count || 0)} bài`
                : this._dinhDangThoiLuong(item.duration_seconds);
              const canAdd = this._coTheThemPlaylist(item, listSource);
              return `
              <div
                class="result-item ${itemId ? "playable" : ""}"
                data-search-index="${idx}"
                role="${itemId ? "button" : ""}"
                tabindex="${itemId ? "0" : "-1"}"
                title="${itemId ? "Nhấn Enter hoặc bấm để phát" : ""}"
              >
                <div class="thumb-wrap">
                  ${item.thumbnail_url ? `<img class="thumb" src="${this._maHoaHtml(item.thumbnail_url)}" alt="" />` : `<div class="thumb fallback"><ha-icon icon="mdi:music-note"></ha-icon></div>`}
                </div>
                <div class="result-meta">
                  <div class="result-title">${this._maHoaHtml(itemTitle)}</div>
                  <div class="result-artist">${this._maHoaHtml(itemArtist)}</div>
                  <div class="result-duration">${this._maHoaHtml(metaValue)}</div>
                </div>
                <div class="result-actions">
                  ${canAdd ? `
                    <button
                      class="mini-btn mini-btn-accent add-btn"
                      type="button"
                      data-search-index="${idx}"
                      title="Thêm vào playlist"
                    >
                      <ha-icon icon="mdi:plus"></ha-icon>
                    </button>
                  ` : ""}
                  <button
                    class="mini-btn mini-btn-danger play-btn"
                    type="button"
                    data-search-index="${idx}"
                  >
                    <ha-icon icon="mdi:play"></ha-icon>
                    <span>Phát</span>
                  </button>
                </div>
              </div>
            `;
            }).join("")}
          </div>
        `}
        ${this._veDialogPlaylist()}
      </section>
    `;
  }

  _veTabDieuKhien() {
    return `
      <section class="panel" aria-label="Control">
        <div class="tile">
          <div class="label-line">
            <strong>Từ khóa đánh thức</strong>
            <label class="switch">
              <input id="wake-enabled" type="checkbox" ${this._wakeEnabled ? "checked" : ""} />
              <span class="slider"></span>
            </label>
          </div>
          <div class="small">Độ nhạy đề xuất 0.95-0.99</div>
          <div class="label-line">
            <span>${this._wakeSensitivity.toFixed(2)}</span>
            <button id="wake-refresh" class="mini-btn">Refresh</button>
          </div>
          <input id="wake-sensitivity" type="range" min="0" max="1" step="0.01" value="${this._wakeSensitivity}" ${!this._wakeEnabled ? "disabled" : ""} />
        </div>

        <div class="tile">
          <div class="label-line">
            <strong>Chống Điếc AI</strong>
            <label class="switch">
              <input id="ai-enabled" type="checkbox" ${this._antiDeafEnabled ? "checked" : ""} />
              <span class="slider"></span>
            </label>
          </div>
          <div class="small">Khuyến nghị tắt nếu không dùng server Việt AI Box.</div>
        </div>

        <div class="tile">
          <div class="label-line">
            <strong>DLNA</strong>
            <label class="switch">
              <input id="dlna-enabled" type="checkbox" ${this._dlnaEnabled ? "checked" : ""} />
              <span class="slider"></span>
            </label>
          </div>
          <div class="label-line">
            <strong>AirPlay</strong>
            <label class="switch">
              <input id="airplay-enabled" type="checkbox" ${this._airplayEnabled ? "checked" : ""} />
              <span class="slider"></span>
            </label>
          </div>
          <div class="label-line">
            <strong>Bluetooth</strong>
            <label class="switch">
              <input id="bluetooth-enabled" type="checkbox" ${this._bluetoothEnabled ? "checked" : ""} />
              <span class="slider"></span>
            </label>
          </div>
        </div>
      </section>
    `;
  }

  _veTabChat() {
    const attrs = this._thuocTinh();
    const chatState = attrs.chat_state || {};
    const history = this._chatHistory.slice(-30);
    const statusLabel = (() => {
      const candidate = [chatState.state, chatState.chat_state, chatState.status].find((value) => {
        if (value === undefined || value === null) return false;
        return String(value).trim() !== "";
      });
      if (candidate !== undefined) return String(candidate);
      if (
        "button_text" in chatState ||
        "buttonText" in chatState ||
        "button_enabled" in chatState ||
        "buttonEnabled" in chatState ||
        "enabled" in chatState
      ) {
        return "ready";
      }
      if (String(this._doiTuongTrangThai()?.state || "").toLowerCase() === "unavailable") return "unavailable";
      return "unknown";
    })();
    const normalizedStatus = this._chuanHoaNhanTrangThaiChat(statusLabel);
    const buttonTextLabel = this._layMoTaNutChat(chatState, statusLabel);
    const statusToneClass = (() => {
      if (CHAT_ENABLED_STATES.has(normalizedStatus)) return "is-ready";
      if (CHAT_DISABLED_STATES.has(normalizedStatus)) return "is-alert";
      return "is-idle";
    })();
    const historyMarkup =
      history.length === 0
        ? `
            <div class="chat-empty">
              <strong>Chưa có lịch sử chat</strong>
              <span>Hãy gửi một tin nhắn hoặc dùng Đánh thức để bắt đầu phiên trò chuyện.</span>
            </div>
          `
        : history
            .map((item) => {
              const roleRaw = String(
                item.message_type || item.role || item.sender || "server"
              )
                .trim()
                .toLowerCase();
              const isUser = roleRaw === "user" || roleRaw === "human" || roleRaw === "client";
              const roleLabel = isUser ? "Bạn" : "AI";
              const content = item.content || item.message || item.text || "";
              return `
                <div class="chat-row ${isUser ? "user" : "server"}">
                  <div class="chat-item ${isUser ? "user" : "server"}">
                    <div class="chat-head">${this._maHoaHtml(roleLabel)}</div>
                    <div class="chat-content">${this._maHoaHtml(content)}</div>
                  </div>
                </div>
              `;
            })
            .join("");

    return `
      <section class="panel panel-chat">
        <div class="chat-shell">
          <div class="chat-shell-header">
            <div class="chat-shell-title-wrap">
              <div class="chat-shell-icon">
                <ha-icon icon="mdi:chat-processing"></ha-icon>
              </div>
              <div class="chat-shell-title-stack">
                <h3 class="chat-shell-title">Chat</h3>
                <div class="chat-shell-subtitle">${this._maHoaHtml(buttonTextLabel)}</div>
              </div>
            </div>
            <div class="chat-shell-tools">
              <span class="chat-shell-pill chat-state-pill ${statusToneClass}">${this._maHoaHtml(this._layNhanTrangThaiChatHienThi(statusLabel))}</span>
              <button id="chat-refresh" class="chat-tool-btn" title="Refresh">
                <ha-icon icon="mdi:refresh"></ha-icon>
              </button>
            </div>
          </div>

          <div class="results chat-results chat-shell-history">
            ${historyMarkup}
          </div>

          <div class="chat-shell-footer">
            <div class="chat-quick-actions">
              <button id="chat-wakeup" class="chat-quick-btn chat-quick-btn-primary">
                <ha-icon icon="mdi:microphone"></ha-icon>
                <span>Đánh thức</span>
              </button>
              <button id="chat-testmic" class="chat-quick-btn">
                <ha-icon icon="mdi:waveform"></ha-icon>
                <span>Thử mic</span>
              </button>
            </div>
            <div class="chat-composer">
              <input id="chat-input" class="text-input chat-composer-input" type="text" placeholder="Nhập tin nhắn cho AI..." value="${this._maHoaHtml(this._chatInput)}" />
              <button id="chat-send" class="chat-send-btn" title="Gửi tin nhắn">
                <ha-icon icon="mdi:send"></ha-icon>
              </button>
            </div>
          </div>
        </div>
      </section>
    `;
  }

  _veTabHeThong() {
    const eqBandColumns = Math.max(1, this._eqBandCount || EQ_BAND_LABELS.length);
    const lightModes = [
      [0, "Mặc định"],
      [1, "Xoay vòng"],
      [2, "Nhảy 1"],
      [3, "Đơn sắc"],
      [4, "Nhảy 2"],
      [7, "Hơi thở"],
    ];
    return `
      <section class="panel panel-system" aria-label="System">
        <div class="tile">
          <div class="audio-engine-shell">
            <div class="audio-engine-head">
              <div class="audio-engine-title-wrap">
                <div class="audio-engine-icon">
                  <ha-icon icon="mdi:tune-vertical-variant"></ha-icon>
                </div>
                <div class="audio-engine-copy">
                  <strong>Bộ âm thanh</strong>
                  <span>Bộ cân bằng đồng bộ trực tiếp với loa</span>
                </div>
              </div>
              <div class="audio-engine-actions">
                <div class="audio-engine-tabs">
                  <button type="button" class="audio-engine-tab active">Equalizer</button>
                </div>
                <label class="switch">
                  <input id="eq-enabled" type="checkbox" ${this._eqEnabled ? "checked" : ""} />
                  <span class="slider"></span>
                </label>
              </div>
            </div>

            <div class="audio-engine-meta">
              <span id="eq-status-chip" class="audio-engine-chip ${this._eqEnabled ? "" : "is-off"}">
                ${this._eqEnabled ? "EQ bật" : "EQ tắt"}
              </span>
              <span class="audio-engine-hint">Kéo từng dải tần rồi thả ra để gửi xuống loa</span>
            </div>

            <div class="eq-vertical-shell">
              ${Array.from({ length: eqBandColumns }, (_, index) => {
                const value = this._layEqLevelTheoBand(index, 0);
                return `
                  <div class="eq-band-column">
                    <div class="eq-band-level" data-eq-value="${index}">${this._dinhDangEqLevel(value)}</div>
                    <div class="eq-band-slider-wrap">
                      <input
                        id="eq-slider-${index}"
                        class="eq-vertical-slider"
                        data-eq-band="${index}"
                        type="range"
                        min="-1500"
                        max="1500"
                        step="100"
                        value="${value}"
                        orient="vertical"
                      />
                    </div>
                    <div class="eq-band-name ${index === this._eqBand ? "is-active" : ""}" data-eq-name="${index}">
                      ${this._maHoaHtml(this._layNhanEqBand(index))}
                    </div>
                  </div>
                `;
              }).join("")}
            </div>

            <div class="actions-inline eq-presets">
            <button class="mini-btn eq-preset" data-preset="flat">Phẳng</button>
            <button class="mini-btn eq-preset" data-preset="bass">Bass Boost</button>
            <button class="mini-btn eq-preset" data-preset="vocal">Giọng hát</button>
            <button class="mini-btn eq-preset" data-preset="rock">Nhạc rock</button>
            <button class="mini-btn eq-preset" data-preset="jazz">Nhạc jazz</button>
            </div>
          </div>
        </div>

        <div class="tile">
          <div class="label-line">
            <strong>Tăng cường bass</strong>
            <label class="switch">
              <input id="bass-enabled" type="checkbox" ${this._bassEnabled ? "checked" : ""} />
              <span class="slider"></span>
            </label>
          </div>
          <div class="label-line"><span>Strength</span><strong>${Math.round(this._bassStrength / 10)}%</strong></div>
          <input id="bass-strength" type="range" min="0" max="1000" step="10" value="${this._bassStrength}" />
        </div>

        <div class="tile">
          <div class="label-line">
            <strong>Độ lớn âm thanh (Loudness)</strong>
            <label class="switch">
              <input id="loudness-enabled" type="checkbox" ${this._loudnessEnabled ? "checked" : ""} />
              <span class="slider"></span>
            </label>
          </div>
          <div class="label-line"><span>Gain</span><strong>${(this._loudnessGain / 100).toFixed(1)} dB</strong></div>
          <input id="loudness-gain" type="range" min="-3000" max="3000" step="1" value="${this._loudnessGain}" />
        </div>

        <div class="tile">
          <h4 class="sub-section-title"><ha-icon icon="mdi:lightbulb"></ha-icon> Điều khiển đèn</h4>
          <div class="subtabs">
            <button class="subtab ${this._lightingTab === "main" ? "active" : ""}" data-lighting-tab="main">Đèn Chính (RGB)</button>
            <button class="subtab ${this._lightingTab === "edge" ? "active" : ""}" data-lighting-tab="edge">Đèn viền</button>
          </div>

          ${this._lightingTab === "main" ? `
            <div class="tile in-tile">
              <div class="label-line">
                <strong>Trạng thái đèn chính</strong>
                <label class="switch">
                  <input id="main-light-enabled" type="checkbox" ${this._mainLightEnabled ? "checked" : ""} />
                  <span class="slider"></span>
                </label>
              </div>
              <div class="label-line"><span>Độ sáng</span><strong>${this._mainLightBrightness}</strong></div>
              <input id="main-light-brightness" type="range" min="1" max="200" step="1" value="${this._mainLightBrightness}" />
              <div class="label-line"><span>Tốc độ</span><strong>${this._mainLightSpeed}</strong></div>
              <input id="main-light-speed" type="range" min="1" max="100" step="1" value="${this._mainLightSpeed}" />
              <div class="actions-inline modes">
                ${lightModes
                  .map(
                    ([mode, label]) => `
                      <button class="mini-btn light-mode ${this._mainLightMode === mode ? "active" : ""}" data-mode="${mode}">${label}</button>
                    `
                  )
                  .join("")}
              </div>
            </div>
          ` : `
            <div class="tile in-tile">
              <div class="label-line">
                <strong>Trạng thái đèn viền</strong>
                <label class="switch">
                  <input id="edge-light-enabled" type="checkbox" ${this._edgeLightEnabled ? "checked" : ""} />
                  <span class="slider"></span>
                </label>
              </div>
              <div class="label-line"><span>Cường độ</span><strong>${this._edgeLightIntensity}</strong></div>
              <input id="edge-light-intensity" type="range" min="0" max="100" step="1" value="${this._edgeLightIntensity}" />
            </div>
          `}
        </div>

        <div class="tile">
          <button id="system-reboot" class="danger-btn"><ha-icon icon="mdi:restart"></ha-icon> Reboot Speaker</button>
        </div>
      </section>
    `;
  }

  _veGiaoDien() {
    if (!this.shadowRoot) return;
    if (!this._config) {
      this._xoaHenGioTienDo();
      this.shadowRoot.innerHTML = `<ha-card><div style="padding:16px;">Thẻ Phicomm R1 đang thiếu cấu hình.</div></ha-card>`;
      return;
    }

    const stateObj = this._doiTuongTrangThai();
    if (!stateObj) {
      this._xoaHenGioTienDo();
      this.shadowRoot.innerHTML = `
        <ha-card>
          <div style="padding:16px;">Không tìm thấy entity <strong>${this._maHoaHtml(this._config.entity)}</strong>.</div>
        </ha-card>
      `;
      return;
    }

    const tabs = [
      { key: "media", icon: "mdi:music-note", label: "Media" },
      { key: "control", icon: "mdi:tune-variant", label: "Control" },
      { key: "chat", icon: "mdi:chat-processing", label: "Chat" },
      { key: "system", icon: "mdi:cog", label: "System" },
    ];

    let body = "";
    if (this._activeTab === "media") body = this._veTabMedia(stateObj);
    if (this._activeTab === "control") body = this._veTabDieuKhien();
    if (this._activeTab === "chat") body = this._veTabChat();
    if (this._activeTab === "system") body = this._veTabHeThong();
    const maxHeightCss = this._config?.max_height || "";
    const cardShellClass = `card-shell${maxHeightCss ? " constrained" : ""}`;
    const cardShellStyle = maxHeightCss
      ? ` style="--card-max-height:${this._maHoaHtml(maxHeightCss)};"`
      : "";

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          --bg-card: #071430;
          --bg-soft: #0d2048;
          --bg-tile: #14274c;
          --line: #29418f;
          --text: #f2f5ff;
          --muted: #a7b5d4;
          --accent: #7a63ff;
          --accent-2: #4f8dff;
          --danger: #ef4444;
          display: block;
          width: 100%;
          max-width: none;
        }

        * {
          box-sizing: border-box;
        }

        ha-card {
          width: 100%;
          max-width: none;
          margin: 0;
          border-radius: 0;
          overflow: visible;
          border: 0;
          background:
            radial-gradient(1400px 400px at 0% -20%, rgba(84, 81, 255, 0.18), transparent 52%),
            radial-gradient(1000px 380px at 100% -10%, rgba(66, 167, 255, 0.16), transparent 58%),
            linear-gradient(180deg, #040b1d 0%, var(--bg-card) 100%);
          color: var(--text);
          box-shadow: none;
          padding: 4px 0 0;
        }

        .card-shell {
          display: flex;
          flex-direction: column;
          min-height: 0;
        }

        .card-shell.constrained {
          max-height: var(--card-max-height);
          min-height: 0;
        }

        .card-body {
          min-height: 0;
        }

        .card-shell.constrained .card-body {
          flex: 1 1 auto;
          min-height: 0;
          overflow-y: auto;
          overflow-x: hidden;
          overscroll-behavior: contain;
          scrollbar-width: none;
          -ms-overflow-style: none;
        }

        .card-shell.constrained .card-body::-webkit-scrollbar {
          width: 0;
          height: 0;
          display: none;
        }

        .top-tabs {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 6px;
          padding: 6px 8px;
          border: 1px solid rgba(101, 125, 255, 0.35);
          border-radius: 12px;
          background: rgba(10, 22, 48, 0.86);
          margin: 0 0 10px;
          flex: 0 0 auto;
          position: relative;
          z-index: 1;
        }

        .tab-btn {
          border: 0;
          background: rgba(255, 255, 255, 0.03);
          color: var(--muted);
          border-radius: 10px;
          padding: 10px 8px;
          font-size: 13px;
          font-weight: 700;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          cursor: pointer;
          transition: all 0.2s ease;
          min-width: 0;
        }

        .tab-btn ha-icon {
          --mdc-icon-size: 20px;
        }

        .tab-btn span {
          display: block;
          min-width: 0;
          max-width: 100%;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .tab-btn.active {
          color: #fff;
          background: linear-gradient(120deg, #6466f1, #8b5cf6);
          box-shadow: 0 6px 14px rgba(122, 99, 255, 0.32);
        }

        .panel {
          border: 1px solid rgba(71, 105, 235, 0.45);
          border-radius: 16px;
          padding: 12px 10px;
          background: linear-gradient(180deg, rgba(9, 25, 58, 0.7), rgba(6, 18, 43, 0.85));
        }

        .panel-media {
          padding: 0;
          overflow: hidden;
        }

        .hero {
          position: relative;
          padding: 14px 14px 12px;
          border-bottom: 1px solid rgba(70, 106, 233, 0.35);
          overflow: hidden;
          background:
            radial-gradient(850px 260px at 35% 0%, rgba(122, 99, 255, 0.2), transparent 65%),
            linear-gradient(180deg, rgba(16, 34, 74, 0.92), rgba(6, 18, 43, 0.94));
        }

        .hero-bg-img {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          object-fit: cover;
          filter: saturate(1.05) brightness(0.33) blur(1px);
          transform: scale(1.03);
          pointer-events: none;
        }

        .hero-overlay {
          position: absolute;
          inset: 0;
          background:
            linear-gradient(180deg, rgba(8, 20, 48, 0.44) 0%, rgba(7, 19, 46, 0.82) 64%, rgba(6, 18, 43, 0.94) 100%),
            radial-gradient(500px 180px at 18% 100%, rgba(116, 77, 255, 0.2), transparent 72%);
          pointer-events: none;
        }

        .hero-content {
          position: relative;
          z-index: 1;
        }

        .hero-top {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 12px;
        }

        .hero-copy {
          flex: 1;
          min-width: 0;
        }

        .song-title {
          margin: 0;
          font-size: 16px;
          line-height: 1.18;
          font-weight: 800;
          letter-spacing: 0.1px;
          display: -webkit-box;
          -webkit-line-clamp: 3;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }

        .song-sub {
          margin-top: 4px;
          color: #d3dffa;
          font-size: 13px;
          font-weight: 600;
        }

        .pill {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          min-width: 0;
          height: 36px;
          padding: 0 12px;
          border-radius: 11px;
          max-width: 100%;
          white-space: nowrap;
          word-break: keep-all;
          font-size: 13px;
          font-weight: 800;
          letter-spacing: 0.8px;
          background: rgba(7, 16, 40, 0.9);
          border: 1px solid rgba(79, 141, 255, 0.5);
          box-shadow: inset 0 0 0 1px rgba(86, 144, 255, 0.12);
        }

        .player-stage {
          margin-top: 10px;
          display: grid;
          grid-template-columns: 92px minmax(0, 1fr);
          gap: 12px;
          align-items: end;
        }

        .cover-disc {
          width: 92px;
          height: 92px;
          border-radius: 50%;
          overflow: hidden;
          border: 3px solid rgba(118, 159, 255, 0.5);
          box-shadow: 0 8px 26px rgba(11, 18, 38, 0.45);
          display: flex;
          align-items: center;
          justify-content: center;
          background: radial-gradient(circle at 30% 25%, rgba(100, 105, 245, 0.46), rgba(13, 24, 52, 0.95));
          will-change: transform;
        }

        .cover-disc img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          border-radius: 50%;
        }

        .cover-disc ha-icon {
          color: #d8e4ff;
          --mdc-icon-size: 34px;
        }

        .hero.is-playing .cover-disc.spinning {
          animation: discSpin 8s linear infinite;
        }

        .hero.is-playing .cover-disc {
          box-shadow:
            0 0 0 2px rgba(121, 98, 255, 0.25),
            0 8px 28px rgba(101, 110, 255, 0.35);
        }

        .wave-area {
          position: relative;
          min-height: 116px;
          border-radius: 12px;
          overflow: hidden;
          background: linear-gradient(180deg, rgba(27, 46, 86, 0.38), rgba(15, 31, 68, 0.22));
          border: 1px solid rgba(101, 125, 255, 0.22);
        }

        .waveform {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: flex-end;
          gap: 4px;
          padding: 0 8px 10px;
        }

        .wave-bar {
          width: 5px;
          height: var(--h);
          border-radius: 6px;
          background: linear-gradient(180deg, rgba(128, 93, 255, 0.96), rgba(86, 130, 255, 0.9));
          transform-origin: bottom center;
          transform: scaleY(0.32);
          opacity: 0.5;
          box-shadow: 0 0 12px rgba(118, 93, 255, 0.3);
        }

        .hero.is-playing .wave-bar {
          animation: waveDance calc(760ms + (var(--i) * 17ms)) ease-in-out infinite;
          opacity: 0.95;
        }

        .controls-row {
          position: absolute;
          left: 50%;
          top: 50%;
          transform: translate(-50%, -48%);
          display: flex;
          justify-content: center;
          gap: 12px;
          margin: 0;
        }

        .icon-btn {
          border: 0;
          width: 52px;
          height: 52px;
          border-radius: 14px;
          background: rgba(16, 32, 66, 0.88);
          color: #fff;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          box-shadow: inset 0 0 0 1px rgba(132, 157, 255, 0.11);
        }

        .icon-btn ha-icon {
          --mdc-icon-size: 28px;
        }

        .icon-btn:hover {
          background: rgba(27, 46, 86, 0.96);
        }

        .icon-btn-primary {
          background: linear-gradient(120deg, #4f8dff, #7a63ff);
          box-shadow: 0 10px 24px rgba(79, 141, 255, 0.28);
        }

        .timeline-row {
          margin-top: 8px;
          display: flex;
          justify-content: space-between;
          color: #dfebff;
          font-size: 13px;
          font-weight: 700;
        }

        .progress-track {
          margin-top: 8px;
          height: 10px;
          width: 100%;
          border-radius: 999px;
          background: rgba(117, 136, 170, 0.45);
          overflow: visible;
          cursor: pointer;
          position: relative;
        }

        .progress-fill {
          height: 100%;
          border-radius: 999px;
          background: linear-gradient(90deg, #764dff 0%, #8b5cf6 52%, #637bff 100%);
          box-shadow: 0 0 14px rgba(120, 94, 255, 0.42);
          pointer-events: none;
        }

        .progress-thumb {
          position: absolute;
          top: 50%;
          transform: translate(-50%, -50%);
          width: 14px;
          height: 14px;
          border-radius: 999px;
          background: #c4d7ff;
          box-shadow: 0 0 0 2px rgba(88, 127, 255, 0.35), 0 0 10px rgba(88, 127, 255, 0.45);
          opacity: 0;
          transition: opacity 0.16s ease;
          pointer-events: none;
        }

        .progress-track:hover .progress-thumb {
          opacity: 1;
        }

        @media (hover: none) {
          .progress-thumb {
            opacity: 1;
          }
        }

        .meta-row {
          margin-top: 8px;
          display: flex;
          justify-content: space-between;
          color: var(--muted);
          font-size: 13px;
        }

        @keyframes waveDance {
          0%, 100% { transform: scaleY(0.28); }
          50% { transform: scaleY(1); }
        }

        @keyframes discSpin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        .subtabs {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
          gap: 8px;
          padding: 10px 10px 8px;
        }

        .subtab {
          border: 1px solid rgba(70, 106, 233, 0.4);
          border-radius: 10px;
          padding: 10px 8px;
          background: rgba(255, 255, 255, 0.03);
          color: var(--muted);
          font-weight: 700;
          cursor: pointer;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .panel-media .subtabs {
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 6px;
          padding: 10px 10px 6px;
        }

        .panel-media .subtab {
          min-width: 0;
          padding: 8px 6px;
          font-size: 13px;
          letter-spacing: 0;
        }

        .subtab.active {
          background: linear-gradient(120deg, rgba(100, 102, 241, 0.9), rgba(139, 92, 246, 0.88));
          color: #fff;
          border-color: transparent;
        }

        .search-row {
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 10px;
          padding: 8px 10px;
        }

        .search-row .icon-btn {
          width: 44px;
          height: 44px;
          border-radius: 12px;
        }

        .search-row .icon-btn ha-icon {
          --mdc-icon-size: 22px;
        }

        .text-input {
          width: 100%;
          min-height: 44px;
          border-radius: 12px;
          border: 1px solid rgba(79, 141, 255, 0.35);
          background: rgba(11, 24, 54, 0.9);
          color: #fff;
          padding: 10px 12px;
          font-size: 15px;
          outline: none;
        }

        .text-input:focus {
          border-color: rgba(122, 99, 255, 0.9);
          box-shadow: 0 0 0 1px rgba(122, 99, 255, 0.6);
        }

        .volume-wrap {
          padding: 8px 10px 6px;
        }

        .label-line {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          margin-bottom: 8px;
          color: var(--text);
        }

        .small {
          color: var(--muted);
          font-size: 13px;
          margin: 0 0 8px;
        }

        input[type="range"] {
          width: 100%;
          accent-color: #4f8dff;
          cursor: pointer;
        }

        .results {
          display: flex;
          flex-direction: column;
          gap: 10px;
          padding: 10px 10px 12px;
          max-height: 440px;
          overflow: auto;
          overflow-x: hidden;
        }

        .panel-media .results {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(min(100%, 360px), 1fr));
          gap: 12px;
          align-items: start;
          scrollbar-width: thin;
          scrollbar-color: rgba(108, 127, 255, 0.72) rgba(9, 18, 40, 0.34);
        }

        .panel-media .results::-webkit-scrollbar {
          width: 6px;
          height: 6px;
        }

        .panel-media .results::-webkit-scrollbar-track {
          background: rgba(9, 18, 40, 0.34);
          border-radius: 999px;
        }

        .panel-media .results::-webkit-scrollbar-thumb {
          background: linear-gradient(180deg, rgba(89, 128, 255, 0.94), rgba(126, 98, 255, 0.9));
          border-radius: 999px;
          border: 1px solid rgba(11, 20, 42, 0.16);
        }

        .panel-media .results::-webkit-scrollbar-thumb:hover {
          background: linear-gradient(180deg, rgba(112, 146, 255, 0.98), rgba(142, 114, 255, 0.94));
        }

        .panel-media .empty {
          grid-column: 1 / -1;
        }

        .empty {
          border: 1px dashed rgba(79, 141, 255, 0.35);
          border-radius: 12px;
          padding: 14px;
          color: var(--muted);
          text-align: center;
          font-size: 14px;
        }

        .playlist-toolbar {
          display: flex;
          gap: 8px;
          padding: 8px 10px 4px;
          flex-wrap: wrap;
        }

        .playlist-library,
        .playlist-detail-list {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .playlist-library {
          padding: 6px 10px 10px;
        }

        .playlist-card,
        .playlist-detail-shell {
          border: 1px solid rgba(70, 106, 233, 0.35);
          border-radius: 12px;
          background: rgba(255, 255, 255, 0.03);
        }

        .playlist-card {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          padding: 12px;
        }

        .playlist-card-main,
        .playlist-song-meta {
          min-width: 0;
          flex: 1;
        }

        .playlist-card-title,
        .playlist-song-title {
          font-size: 13px;
          font-weight: 700;
          color: #fff;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .playlist-card-sub,
        .playlist-song-sub {
          font-size: 11px;
          color: var(--muted);
        }

        .playlist-song-sub {
          display: flex;
          align-items: center;
          gap: 8px;
          justify-content: space-between;
        }

        .playlist-card-actions {
          display: flex;
          align-items: center;
          gap: 6px;
          flex-shrink: 0;
        }

        .playlist-view-btn,
        .playlist-delete-btn,
        .playlist-song-remove-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
        }

        .playlist-detail-shell {
          margin: 0 10px 12px;
          padding: 12px;
        }

        .playlist-detail-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 10px;
        }

        .playlist-song-row {
          display: flex;
          align-items: center;
          gap: 10px;
          border: 1px solid rgba(70, 106, 233, 0.22);
          border-radius: 10px;
          background: rgba(8, 19, 45, 0.58);
          padding: 10px;
        }

        .playlist-dialog-backdrop {
          position: fixed;
          inset: 0;
          z-index: 25;
          background: rgba(3, 8, 20, 0.72);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 16px;
        }

        .playlist-dialog {
          width: min(100%, 360px);
          border-radius: 16px;
          border: 1px solid rgba(91, 125, 255, 0.4);
          background: linear-gradient(180deg, rgba(12, 21, 49, 0.98), rgba(10, 17, 39, 0.98));
          box-shadow: 0 18px 42px rgba(0, 0, 0, 0.35);
          padding: 14px;
        }

        .playlist-dialog-head,
        .playlist-dialog-actions,
        .playlist-field {
          display: flex;
          gap: 10px;
        }

        .playlist-dialog-head {
          align-items: center;
          justify-content: space-between;
          margin-bottom: 12px;
        }

        .playlist-field {
          flex-direction: column;
          margin-bottom: 10px;
        }

        .playlist-field span,
        .playlist-dialog-note {
          color: var(--muted);
          font-size: 12px;
        }

        .playlist-dialog-note {
          margin-bottom: 10px;
          line-height: 1.45;
        }

        .playlist-select {
          appearance: none;
        }

        .playlist-dialog-error {
          border: 1px solid rgba(248, 88, 92, 0.4);
          background: rgba(234, 45, 50, 0.1);
          color: #ffd7d8;
          border-radius: 10px;
          padding: 10px 12px;
          font-size: 12px;
          margin-bottom: 10px;
        }

        .playlist-dialog-actions {
          justify-content: flex-end;
        }

        .result-item {
          display: grid;
          grid-template-columns: 56px minmax(0, 1fr) auto;
          gap: 12px;
          align-items: center;
          border: 1px solid rgba(70, 106, 233, 0.35);
          border-radius: 12px;
          padding: 10px 12px;
          background: rgba(255, 255, 255, 0.02);
          width: 100%;
          box-sizing: border-box;
          min-height: 78px;
          height: 100%;
          align-self: stretch;
        }

        .result-meta {
          grid-column: 2;
          min-width: 0;
          max-width: 100%;
          overflow: hidden;
        }

        .result-item.playable {
          cursor: pointer;
          touch-action: manipulation;
          -webkit-tap-highlight-color: transparent;
          user-select: none;
        }

        .result-item.playable:hover {
          border-color: rgba(122, 99, 255, 0.75);
          box-shadow: inset 0 0 0 1px rgba(79, 141, 255, 0.3);
          background: rgba(122, 99, 255, 0.08);
        }

        .result-item.playable:focus {
          outline: 1px solid rgba(122, 99, 255, 0.85);
          outline-offset: 2px;
        }

        .thumb-wrap {
          width: 56px;
          height: 56px;
          border-radius: 9px;
          overflow: hidden;
          background: rgba(255, 255, 255, 0.08);
        }

        .thumb {
          width: 56px;
          height: 56px;
          object-fit: cover;
          display: block;
        }

        .thumb.fallback {
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--muted);
        }

        .result-title {
          display: -webkit-box;
          width: 100%;
          max-width: 100%;
          font-size: 13px;
          font-weight: 700;
          color: #fff;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: normal;
          line-height: 1;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
        }

        .result-artist {
          font-size: 12px;
          color: var(--muted);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .result-duration {
          font-size: 10px;
          font-weight: 500;
          color: rgba(165, 184, 214, 0.78);
        }

        .result-actions {
          grid-column: 3;
          grid-row: 1;
          display: flex;
          gap: 4px;
          align-items: center;
          justify-content: flex-end;
          flex-shrink: 0;
          align-self: center;
          margin-top: 0;
        }

        .result-actions ha-icon {
          --mdc-icon-size: 15px;
        }

        .mini-btn {
          border: 1px solid rgba(80, 122, 255, 0.45);
          border-radius: 10px;
          background: rgba(255, 255, 255, 0.04);
          color: #dbe6ff;
          font-weight: 700;
          padding: 9px 12px;
          cursor: pointer;
          white-space: nowrap;
        }

        .mini-btn:hover {
          background: rgba(255, 255, 255, 0.08);
        }

        .mini-btn.active {
          background: linear-gradient(120deg, #3578eb, #5d5eea);
          border-color: rgba(93, 117, 235, 0.85);
          color: #fff;
        }

        .mini-btn-primary {
          background: linear-gradient(120deg, #3578eb, #5d5eea);
          border-color: rgba(93, 117, 235, 0.85);
          color: #fff;
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }

        .mini-btn-accent {
          min-width: 28px;
          min-height: 28px;
          border-radius: 9px;
          padding: 0 6px;
          background: #2f6dff;
          border-color: rgba(60, 120, 255, 0.9);
          color: #fff;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          justify-content: center;
        }

        .mini-btn-danger {
          min-width: 64px;
          min-height: 28px;
          border-radius: 9px;
          padding: 0 8px;
          background: #ea2d32;
          border-color: rgba(248, 88, 92, 0.9);
          color: #fff;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
        }

        .result-actions .play-btn {
          font-size: 11px;
          font-weight: 800;
        }

        .actions-inline {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 8px;
        }

        .audio-engine-shell {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }

        .audio-engine-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 14px;
          flex-wrap: wrap;
        }

        .audio-engine-title-wrap {
          display: flex;
          align-items: center;
          gap: 12px;
          min-width: 0;
        }

        .audio-engine-icon {
          width: 44px;
          height: 44px;
          border-radius: 14px;
          border: 1px solid rgba(97, 132, 255, 0.34);
          background: linear-gradient(180deg, rgba(40, 76, 170, 0.34), rgba(16, 31, 69, 0.22));
          display: inline-flex;
          align-items: center;
          justify-content: center;
          color: #8fb5ff;
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
          flex: none;
        }

        .audio-engine-icon ha-icon {
          --mdc-icon-size: 22px;
        }

        .audio-engine-copy {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .audio-engine-copy strong {
          font-size: 22px;
          font-weight: 800;
          letter-spacing: -0.02em;
        }

        .audio-engine-copy span {
          color: var(--muted);
          font-size: 13px;
        }

        .audio-engine-actions {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 12px;
          flex-wrap: wrap;
        }

        .audio-engine-tabs {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 6px;
          border-radius: 16px;
          border: 1px solid rgba(82, 109, 199, 0.28);
          background: rgba(8, 19, 42, 0.8);
        }

        .audio-engine-tab {
          border: 0;
          border-radius: 12px;
          padding: 10px 18px;
          font-size: 13px;
          font-weight: 800;
          letter-spacing: -0.01em;
          color: #fff;
          background: linear-gradient(120deg, #3578eb, #5d5eea);
          box-shadow: 0 10px 18px rgba(64, 98, 255, 0.24);
        }

        .audio-engine-meta {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          flex-wrap: wrap;
        }

        .audio-engine-chip {
          display: inline-flex;
          align-items: center;
          min-height: 30px;
          padding: 0 12px;
          border-radius: 999px;
          border: 1px solid rgba(75, 124, 255, 0.38);
          background: rgba(38, 88, 214, 0.18);
          color: #dbe6ff;
          font-size: 12px;
          font-weight: 800;
        }

        .audio-engine-chip.is-off {
          border-color: rgba(148, 163, 184, 0.22);
          background: rgba(148, 163, 184, 0.08);
          color: rgba(219, 230, 255, 0.72);
        }

        .audio-engine-hint {
          color: rgba(219, 230, 255, 0.62);
          font-size: 12px;
        }

        .eq-vertical-shell {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(68px, 1fr));
          gap: 12px;
          align-items: end;
          padding: 8px 4px 0;
        }

        .eq-band-column {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 10px;
          min-width: 0;
        }

        .eq-band-level {
          min-height: 18px;
          font-size: 12px;
          font-weight: 800;
          color: #8fb5ff;
          letter-spacing: 0.02em;
          text-align: center;
        }

        .eq-band-slider-wrap {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 100%;
          min-height: 246px;
        }

        .eq-vertical-slider {
          width: 28px;
          height: 220px;
          margin: 0;
          padding: 0;
          writing-mode: vertical-lr;
          direction: rtl;
          -webkit-appearance: slider-vertical;
          appearance: auto;
          accent-color: var(--accent-2);
          cursor: ns-resize;
        }

        .eq-band-name {
          font-size: 14px;
          font-weight: 800;
          color: rgba(219, 230, 255, 0.78);
          letter-spacing: -0.01em;
          text-align: center;
        }

        .eq-band-name.is-active {
          color: #fff;
          text-shadow: 0 0 18px rgba(79, 141, 255, 0.28);
        }

        .eq-presets {
          margin-top: 2px;
        }

        .eq-presets .mini-btn {
          border-radius: 999px;
          padding: 9px 14px;
        }

        .tile {
          border: 1px solid rgba(70, 106, 233, 0.4);
          border-radius: 14px;
          background: rgba(255, 255, 255, 0.03);
          padding: 10px;
          margin-bottom: 8px;
        }

        .tile.in-tile {
          margin: 8px 0 0;
        }

        .section-title {
          margin: 2px 0 14px;
          font-size: 30px;
          font-weight: 800;
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .sub-section-title {
          margin: 0 0 8px;
          font-size: 20px;
          font-weight: 800;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .panel-chat {
          padding: 0;
          border: 0;
          background: transparent;
        }

        .chat-shell {
          position: relative;
          overflow: hidden;
          border: 1px solid rgba(87, 107, 230, 0.42);
          border-radius: 18px;
          background:
            radial-gradient(500px 220px at 84% -8%, rgba(122, 99, 255, 0.2), transparent 62%),
            linear-gradient(180deg, rgba(16, 28, 58, 0.96), rgba(7, 16, 36, 0.98));
          box-shadow:
            0 18px 44px rgba(4, 11, 28, 0.42),
            inset 0 1px 0 rgba(150, 173, 255, 0.08);
        }

        .chat-shell-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 12px 14px;
          border-bottom: 1px solid rgba(87, 107, 230, 0.26);
          background: rgba(255, 255, 255, 0.03);
        }

        .chat-shell-title-wrap {
          min-width: 0;
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .chat-shell-icon {
          flex: 0 0 auto;
          width: 36px;
          height: 36px;
          border-radius: 12px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: linear-gradient(135deg, rgba(100, 102, 241, 0.92), rgba(79, 141, 255, 0.88));
          color: #fff;
          box-shadow: 0 10px 22px rgba(86, 106, 255, 0.28);
        }

        .chat-shell-icon ha-icon {
          --mdc-icon-size: 20px;
        }

        .chat-shell-title-stack {
          min-width: 0;
        }

        .chat-shell-title {
          margin: 0;
          font-size: 20px;
          font-weight: 800;
          line-height: 1;
        }

        .chat-shell-subtitle {
          margin-top: 4px;
          color: var(--muted);
          font-size: 12.5px;
          line-height: 1.25;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .chat-shell-tools {
          flex: 0 0 auto;
          display: flex;
          align-items: center;
          justify-content: flex-end;
          flex-wrap: wrap;
          gap: 8px;
        }

        .chat-shell-pill {
          min-height: 32px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 0 11px;
          border-radius: 999px;
          border: 1px solid rgba(92, 120, 214, 0.26);
          background: rgba(255, 255, 255, 0.05);
          color: #dbe6ff;
          font-size: 12.5px;
          font-weight: 700;
          letter-spacing: 0.02em;
        }

        .chat-state-pill.is-ready {
          background: rgba(34, 197, 94, 0.14);
          border-color: rgba(74, 222, 128, 0.35);
          color: #b7f5c9;
        }

        .chat-state-pill.is-alert {
          background: rgba(239, 68, 68, 0.12);
          border-color: rgba(248, 113, 113, 0.3);
          color: #ffc0c0;
        }

        .chat-state-pill.is-idle {
          background: rgba(96, 165, 250, 0.12);
          border-color: rgba(96, 165, 250, 0.25);
          color: #c8d9ff;
        }

        .chat-tool-btn {
          width: 34px;
          height: 34px;
          border: 1px solid rgba(96, 125, 229, 0.26);
          border-radius: 11px;
          background: rgba(255, 255, 255, 0.04);
          color: #dbe6ff;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
        }

        .chat-tool-btn ha-icon {
          --mdc-icon-size: 18px;
        }

        .chat-tool-btn:hover {
          background: rgba(255, 255, 255, 0.08);
        }

        .chat-shell-history {
          position: relative;
          max-height: 420px;
          overflow: auto;
          padding: 14px;
          gap: 12px;
          scrollbar-width: thin;
          scrollbar-color: rgba(110, 128, 255, 0.72) rgba(9, 18, 40, 0.36);
          border-top: 1px solid rgba(87, 107, 230, 0.12);
          border-bottom: 1px solid rgba(87, 107, 230, 0.16);
          background:
            radial-gradient(520px 280px at 74% 50%, rgba(122, 99, 255, 0.12), transparent 62%),
            radial-gradient(300px 160px at 18% 8%, rgba(79, 141, 255, 0.1), transparent 58%),
            linear-gradient(180deg, rgba(11, 21, 46, 0.74), rgba(7, 14, 33, 0.92));
        }

        .chat-shell-history::-webkit-scrollbar {
          width: 6px;
          height: 6px;
        }

        .chat-shell-history::-webkit-scrollbar-track {
          background: rgba(9, 18, 40, 0.36);
          border-radius: 999px;
        }

        .chat-shell-history::-webkit-scrollbar-thumb {
          background: linear-gradient(180deg, rgba(91, 129, 255, 0.95), rgba(128, 100, 255, 0.9));
          border-radius: 999px;
          border: 1px solid rgba(12, 20, 42, 0.18);
        }

        .chat-shell-history::-webkit-scrollbar-thumb:hover {
          background: linear-gradient(180deg, rgba(114, 148, 255, 0.98), rgba(145, 116, 255, 0.94));
        }

        .chat-empty {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 8px;
          min-height: 180px;
          border: 1px dashed rgba(96, 125, 229, 0.3);
          border-radius: 16px;
          padding: 18px;
          text-align: center;
          background: rgba(255, 255, 255, 0.03);
          color: var(--muted);
          font-size: 13px;
          line-height: 1.45;
        }

        .chat-empty strong {
          color: #eef4ff;
          font-size: 15px;
        }

        .chat-row {
          display: flex;
        }

        .chat-row.user {
          justify-content: flex-end;
        }

        .chat-row.server {
          justify-content: flex-start;
        }

        .chat-item {
          max-width: min(84%, 720px);
          padding: 10px 12px 11px;
          border-radius: 17px;
          box-shadow: 0 10px 24px rgba(5, 12, 28, 0.16);
          backdrop-filter: blur(8px);
        }

        .chat-item.user {
          border: 1px solid rgba(97, 150, 255, 0.42);
          border-bottom-right-radius: 7px;
          background: linear-gradient(135deg, rgba(46, 101, 248, 0.96), rgba(73, 123, 255, 0.86));
        }

        .chat-item.server {
          border: 1px solid rgba(56, 201, 108, 0.28);
          border-bottom-left-radius: 7px;
          background: linear-gradient(135deg, rgba(25, 173, 79, 0.96), rgba(30, 154, 76, 0.88));
        }

        .chat-head {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-height: 20px;
          padding: 0 7px;
          margin-bottom: 6px;
          border-radius: 999px;
          background: rgba(9, 17, 36, 0.16);
          color: rgba(255, 255, 255, 0.86);
          font-size: 10px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          line-height: 1;
        }

        .chat-content {
          white-space: pre-wrap;
          word-break: break-word;
          line-height: 1.45;
          font-size: 14px;
          color: #f8fbff;
        }

        .chat-shell-footer {
          display: flex;
          flex-direction: column;
          gap: 10px;
          padding: 12px 14px 14px;
          background: rgba(6, 12, 30, 0.9);
        }

        .chat-quick-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .chat-quick-btn {
          min-height: 34px;
          border: 1px solid rgba(96, 125, 229, 0.28);
          border-radius: 11px;
          background: rgba(255, 255, 255, 0.04);
          color: #dbe6ff;
          padding: 0 12px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
          font-size: 12.5px;
          font-weight: 700;
          cursor: pointer;
        }

        .chat-quick-btn ha-icon {
          --mdc-icon-size: 16px;
        }

        .chat-quick-btn:hover {
          background: rgba(255, 255, 255, 0.08);
        }

        .chat-quick-btn-primary {
          background: linear-gradient(120deg, rgba(100, 102, 241, 0.92), rgba(79, 141, 255, 0.88));
          border-color: rgba(93, 117, 235, 0.8);
          color: #fff;
        }

        .chat-composer {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 10px;
          align-items: center;
        }

        .chat-composer-input {
          min-height: 44px;
          padding: 10px 13px;
          border-radius: 14px;
          background: rgba(10, 20, 46, 0.95);
        }

        .chat-send-btn {
          width: 44px;
          height: 44px;
          border: 0;
          border-radius: 14px;
          background: linear-gradient(120deg, #3578eb, #5d5eea);
          color: #fff;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          box-shadow: 0 12px 24px rgba(76, 97, 255, 0.28);
        }

        .chat-send-btn ha-icon {
          --mdc-icon-size: 21px;
        }

        .chat-send-btn:hover {
          filter: brightness(1.06);
        }

        .switch {
          position: relative;
          width: 50px;
          height: 30px;
          display: inline-block;
        }

        .switch input {
          opacity: 0;
          width: 0;
          height: 0;
        }

        .slider {
          position: absolute;
          inset: 0;
          background: #3d5075;
          border-radius: 999px;
          transition: 0.2s;
          cursor: pointer;
        }

        .slider::before {
          content: "";
          position: absolute;
          width: 24px;
          height: 24px;
          left: 3px;
          top: 3px;
          border-radius: 50%;
          background: #fff;
          transition: 0.2s;
        }

        .switch input:checked + .slider {
          background: linear-gradient(120deg, #4f8dff, #7a63ff);
        }

        .switch input:checked + .slider::before {
          transform: translateX(20px);
        }

        .danger-btn {
          width: 100%;
          min-height: 44px;
          border-radius: 12px;
          border: 1px solid rgba(255, 120, 120, 0.45);
          background: linear-gradient(120deg, rgba(239, 68, 68, 0.25), rgba(220, 38, 38, 0.35));
          color: #fff;
          font-size: 15px;
          font-weight: 800;
          display: inline-flex;
          gap: 8px;
          align-items: center;
          justify-content: center;
          cursor: pointer;
        }

        @media (max-width: 900px) {
          .song-title {
            font-size: 16px;
            -webkit-line-clamp: 3;
          }
          .section-title {
            font-size: 24px;
          }
          .audio-engine-copy strong {
            font-size: 18px;
          }
          .eq-band-slider-wrap {
            min-height: 206px;
          }
          .eq-vertical-slider {
            height: 180px;
          }
          .eq-band-name {
            font-size: 12px;
          }
          .pill {
            min-width: 0;
            height: 32px;
            font-size: 12px;
            padding: 0 10px;
          }
          .player-stage {
            grid-template-columns: 72px minmax(0, 1fr);
            gap: 10px;
          }
          .cover-disc {
            width: 72px;
            height: 72px;
            border-width: 2px;
          }
          .wave-area {
            min-height: 98px;
          }
          .waveform {
            gap: 3px;
            padding: 0 6px 8px;
          }
          .wave-bar {
            width: 4px;
          }
          .controls-row {
            gap: 8px;
          }
          .icon-btn {
            width: 42px;
            height: 42px;
            border-radius: 12px;
          }
          .icon-btn ha-icon {
            --mdc-icon-size: 22px;
          }
          .subtabs {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .panel-media .subtabs {
            grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: 4px;
            padding: 8px 10px 4px;
          }

          .panel-media .subtab {
            min-width: 0;
            padding: 7px 4px;
            font-size: 11px;
            border-radius: 9px;
            letter-spacing: -0.01em;
          }
          .search-row .icon-btn {
            width: 40px;
            height: 40px;
          }
          .search-row .icon-btn ha-icon {
            --mdc-icon-size: 20px;
          }
          .top-tabs {
            grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: 4px;
            padding: 4px;
            margin-bottom: 8px;
            border-radius: 10px;
          }
          .tab-btn {
            padding: 8px 4px;
            font-size: 11px;
            gap: 4px;
            border-radius: 9px;
          }
          .tab-btn ha-icon {
            --mdc-icon-size: 16px;
          }
          .result-item {
            grid-template-columns: 48px minmax(0, 1fr) auto;
            gap: 8px;
            padding: 8px 10px;
          }

          .thumb-wrap,
          .thumb {
            width: 48px;
            height: 48px;
          }

          .result-title {
            font-size: 12px;
          }

          .result-artist {
            font-size: 11px;
          }

          .result-duration {
            font-size: 14px;
          }

          .result-actions {
            gap: 5px;
            margin-top: 0;
            align-self: center;
          }

          .mini-btn-accent {
            min-width: 26px;
            min-height: 26px;
            padding: 0 5px;
          }

          .mini-btn-danger {
            min-width: 60px;
            min-height: 26px;
            padding: 0 7px;
          }

          .playlist-toolbar {
            gap: 6px;
          }

          .playlist-card {
            flex-direction: column;
            align-items: stretch;
          }

          .playlist-card-actions,
          .playlist-detail-head {
            flex-wrap: wrap;
          }

          .playlist-detail-shell {
            margin: 0 10px 10px;
            padding: 10px;
          }

          .playlist-song-row {
            padding: 8px;
          }

          .playlist-dialog {
            width: min(100%, 340px);
            padding: 12px;
          }

          .chat-shell-header {
            padding: 10px 11px;
            gap: 10px;
            align-items: flex-start;
          }

          .chat-shell-title-wrap {
            gap: 9px;
            width: 100%;
          }

          .chat-shell-icon {
            width: 32px;
            height: 32px;
            border-radius: 10px;
          }

          .chat-shell-title {
            font-size: 18px;
          }

          .chat-shell-subtitle {
            font-size: 11.5px;
            white-space: normal;
          }

          .chat-shell-tools {
            width: 100%;
            justify-content: flex-start;
          }

          .chat-shell-pill {
            min-height: 29px;
            padding: 0 9px;
            font-size: 11.5px;
          }

          .chat-tool-btn {
            width: 30px;
            height: 30px;
            border-radius: 10px;
          }

          .chat-tool-btn ha-icon {
            --mdc-icon-size: 16px;
          }

          .chat-shell-history {
            max-height: 320px;
            padding: 10px;
            gap: 8px;
          }

          .chat-item {
            max-width: 92%;
            padding: 8px 9px 9px;
            border-radius: 14px;
          }

          .chat-head {
            min-height: 18px;
            padding: 0 6px;
            margin-bottom: 5px;
            font-size: 9px;
          }

          .chat-content {
            font-size: 12.5px;
            line-height: 1.4;
          }

          .chat-shell-footer {
            padding: 10px;
            gap: 8px;
          }

          .chat-quick-actions {
            gap: 6px;
          }

          .chat-quick-btn {
            min-height: 30px;
            padding: 0 10px;
            font-size: 11.5px;
          }

          .chat-composer {
            gap: 8px;
          }

          .chat-composer-input {
            min-height: 38px;
            padding: 8px 11px;
            font-size: 13px;
          }

          .chat-send-btn {
            width: 38px;
            height: 38px;
            border-radius: 12px;
          }

          .chat-send-btn ha-icon {
            --mdc-icon-size: 18px;
          }
        }

        @media (max-width: 420px) {
          .top-tabs {
            gap: 3px;
            padding: 3px;
          }

          .tab-btn {
            padding: 7px 3px;
            font-size: 10.5px;
            gap: 3px;
            border-radius: 8px;
          }

          .tab-btn ha-icon {
            --mdc-icon-size: 14px;
          }

          .chat-shell-history::-webkit-scrollbar {
            width: 5px;
            height: 5px;
          }

          .panel-media .results::-webkit-scrollbar {
            width: 5px;
            height: 5px;
          }

          .panel-media .subtabs {
            gap: 3px;
            padding: 7px 10px 4px;
          }

          .panel-media .subtab {
            padding: 6px 3px;
            font-size: 10px;
            border-radius: 8px;
          }
        }

        @media (max-width: 720px) {
          .audio-engine-head {
            flex-direction: column;
            align-items: stretch;
          }

          .audio-engine-actions {
            justify-content: space-between;
          }

          .audio-engine-tabs {
            width: 100%;
            justify-content: center;
          }

          .audio-engine-tab {
            flex: 1;
            text-align: center;
          }

          .eq-vertical-shell {
            gap: 8px;
            grid-template-columns: repeat(5, minmax(48px, 1fr));
          }

          .eq-band-slider-wrap {
            min-height: 176px;
          }

          .eq-vertical-slider {
            width: 24px;
            height: 150px;
          }
        }

        .panel-system {
          border: 0;
          border-radius: 0;
          background: transparent;
          padding: 0;
          box-shadow: none;
        }

        .panel-system .section-title {
          margin: 0 0 10px;
          gap: 8px;
          font-size: 26px;
        }

        .panel-system .section-title ha-icon {
          --mdc-icon-size: 22px;
        }

        .panel-system .sub-section-title {
          margin: 0 0 6px;
          gap: 6px;
          font-size: 17px;
        }

        .panel-system .sub-section-title ha-icon {
          --mdc-icon-size: 18px;
        }

        .panel-system .tile {
          padding: 9px 10px;
          margin-bottom: 6px;
          border-radius: 13px;
        }

        .panel-system .tile.in-tile {
          margin: 6px 0 0;
          padding: 8px 9px;
        }

        .panel-system .label-line {
          margin-bottom: 6px;
        }

        .panel-system .actions-inline {
          gap: 6px;
          margin-top: 6px;
        }

        .panel-system .audio-engine-shell {
          gap: 10px;
        }

        .panel-system .audio-engine-head {
          gap: 10px;
        }

        .panel-system .audio-engine-title-wrap {
          gap: 10px;
        }

        .panel-system .audio-engine-icon {
          width: 36px;
          height: 36px;
          border-radius: 12px;
        }

        .panel-system .audio-engine-icon ha-icon {
          --mdc-icon-size: 18px;
        }

        .panel-system .audio-engine-copy {
          gap: 2px;
        }

        .panel-system .audio-engine-copy strong {
          font-size: 18px;
        }

        .panel-system .audio-engine-copy span {
          font-size: 12px;
          line-height: 1.3;
        }

        .panel-system .audio-engine-actions {
          gap: 8px;
        }

        .panel-system .audio-engine-tabs {
          padding: 4px;
          border-radius: 14px;
        }

        .panel-system .audio-engine-tab {
          padding: 8px 14px;
          border-radius: 10px;
          font-size: 12px;
          box-shadow: 0 8px 14px rgba(64, 98, 255, 0.2);
        }

        .panel-system .audio-engine-meta {
          gap: 8px;
        }

        .panel-system .audio-engine-chip {
          min-height: 26px;
          padding: 0 10px;
          font-size: 11px;
        }

        .panel-system .audio-engine-hint {
          font-size: 11px;
          line-height: 1.3;
        }

        .panel-system .eq-vertical-shell {
          grid-template-columns: repeat(5, minmax(52px, 1fr));
          gap: 8px;
          padding: 4px 2px 0;
        }

        .panel-system .eq-band-column {
          gap: 8px;
        }

        .panel-system .eq-band-level {
          min-height: 16px;
          font-size: 11px;
        }

        .panel-system .eq-band-slider-wrap {
          min-height: 192px;
        }

        .panel-system .eq-vertical-slider {
          width: 20px;
          height: 168px;
        }

        .panel-system .eq-band-name {
          font-size: 12px;
        }

        .panel-system .eq-presets {
          margin-top: 0;
        }

        .panel-system .mini-btn {
          padding: 7px 11px;
          border-radius: 10px;
          font-size: 12px;
        }

        .panel-system .eq-presets .mini-btn {
          padding: 7px 12px;
          border-radius: 999px;
        }

        .panel-system .subtabs {
          gap: 6px;
          padding: 6px 0 4px;
        }

        .panel-system .subtab {
          min-height: 38px;
          padding: 8px 6px;
          border-radius: 10px;
          font-size: 13px;
        }

        .panel-system .switch {
          width: 44px;
          height: 26px;
        }

        .panel-system .slider::before {
          width: 20px;
          height: 20px;
        }

        .panel-system .switch input:checked + .slider::before {
          transform: translateX(18px);
        }

        .panel-system .danger-btn {
          min-height: 40px;
          border-radius: 11px;
          font-size: 14px;
          gap: 7px;
        }

        .panel-system .danger-btn ha-icon {
          --mdc-icon-size: 20px;
        }

        .panel-system input[type="range"]:not(.eq-vertical-slider) {
          height: 18px;
          background: transparent;
          appearance: none;
          -webkit-appearance: none;
        }

        .panel-system input[type="range"]:not(.eq-vertical-slider)::-webkit-slider-runnable-track {
          height: 6px;
          border-radius: 999px;
          background: rgba(117, 136, 170, 0.45);
        }

        .panel-system input[type="range"]:not(.eq-vertical-slider)::-webkit-slider-thumb {
          width: 16px;
          height: 16px;
          margin-top: -5px;
          border: 0;
          border-radius: 50%;
          background: #4f8dff;
          box-shadow: 0 0 0 2px rgba(79, 141, 255, 0.18);
          cursor: pointer;
          -webkit-appearance: none;
        }

        .panel-system input[type="range"]:not(.eq-vertical-slider)::-moz-range-track {
          height: 6px;
          border: 0;
          border-radius: 999px;
          background: rgba(117, 136, 170, 0.45);
        }

        .panel-system input[type="range"]:not(.eq-vertical-slider)::-moz-range-progress {
          height: 6px;
          border-radius: 999px;
          background: #4f8dff;
        }

        .panel-system input[type="range"]:not(.eq-vertical-slider)::-moz-range-thumb {
          width: 16px;
          height: 16px;
          border: 0;
          border-radius: 50%;
          background: #4f8dff;
          box-shadow: 0 0 0 2px rgba(79, 141, 255, 0.18);
          cursor: pointer;
        }

        @media (max-width: 900px) {
          .panel-system .section-title {
            font-size: 24px;
          }

          .panel-system .audio-engine-copy strong {
            font-size: 17px;
          }

          .panel-system .eq-band-slider-wrap {
            min-height: 178px;
          }

          .panel-system .eq-vertical-slider {
            height: 154px;
          }
        }

        @media (max-width: 720px) {
          .panel-system {
            padding: 0;
          }

          .panel-system .section-title {
            font-size: 22px;
          }

          .panel-system .audio-engine-head {
            gap: 8px;
          }

          .panel-system .audio-engine-actions {
            gap: 7px;
          }

          .panel-system .eq-vertical-shell {
            grid-template-columns: repeat(5, minmax(42px, 1fr));
            gap: 6px;
          }

          .panel-system .eq-band-slider-wrap {
            min-height: 156px;
          }

          .panel-system .eq-vertical-slider {
            width: 18px;
            height: 132px;
          }

          .panel-system .mini-btn {
            padding: 7px 10px;
            font-size: 11.5px;
          }

          .panel-system .subtab {
            min-height: 36px;
            font-size: 12px;
          }
        }
      </style>

      <ha-card>
        <div class="${cardShellClass}"${cardShellStyle}>
          <div class="top-tabs">
            ${tabs
              .map(
                (tab) => `
                  <button class="tab-btn ${this._activeTab === tab.key ? "active" : ""}" data-tab="${tab.key}">
                    <ha-icon icon="${tab.icon}"></ha-icon>
                    <span>${tab.label}</span>
                  </button>
                `
              )
              .join("")}
          </div>
          <div class="card-body">
            ${body}
          </div>
        </div>
      </ha-card>
    `;

    if (this._activeTab === "chat") {
      this._damBaoTrangThaiChat();
    }
    if (this._activeTab === "control") {
      this._damBaoTrangThaiDieuKhien();
    }
    if (this._activeTab === "system") {
      this._damBaoTrangThaiHeThong();
    }

    this._ganSuKien();
    this._dongBoTienDoDom();
    this._capNhatHenGioTienDo();
  }

  async _damBaoTrangThaiChat() {
    const attrs = this._thuocTinh();
    const chat = attrs.chat_state || {};
    const hasData =
      ["state", "chat_state", "status", "button_text", "button_enabled"].some((key) => key in chat) &&
      Object.keys(chat).length > 0;
    const now = Date.now();
    const shouldFetchState = !hasData && now - this._lastChatStateRequestAt >= 7000;
    const shouldFetchHistory = !this._chatHistoryLoaded && now - this._lastChatHistoryRequestAt >= 7000;
    if (!shouldFetchState && !shouldFetchHistory) return;
    if (shouldFetchState) this._lastChatStateRequestAt = now;
    if (shouldFetchHistory) this._lastChatHistoryRequestAt = now;
    try {
      if (shouldFetchState) {
        await this._goiDichVu("phicomm_r1", "chat_get_state");
      }
      if (shouldFetchHistory) {
        await this._goiDichVu("phicomm_r1", "chat_get_history");
      }
      await this._lamMoiEntity(220);
    } catch (err) {
      console.warn("chat bootstrap failed", err);
    }
  }

  async _guiTinNhanChat() {
    const text = this._layGiaTriChatInput().trim();
    if (!text) return;

    this._themTinNhanChatTam(text, "user");
    this._chatInput = "";
    this._lastChatHistoryRequestAt = 0;
    this._veGiaoDienGiuFocusChat();
    this._cuonCuoiKhungChat();

    try {
      await this._goiDichVu("phicomm_r1", "chat_send_text", { text });
      await this._goiDichVu("phicomm_r1", "chat_get_history");
      await this._lamMoiEntity(220, 2);
      this._cuonCuoiKhungChat();
    } catch (err) {
      console.warn("chat_send_text failed", err);
    }
  }

  async _damBaoTrangThaiDieuKhien() {
    const now = Date.now();
    if (now - this._lastControlStateRequestAt < 7000) return;
    this._lastControlStateRequestAt = now;
    try {
      await this._lamMoiEntity(180);
      await this._goiDichVu("phicomm_r1", "wake_word_get_enabled");
      await this._goiDichVu("phicomm_r1", "wake_word_get_sensitivity");
      await this._goiDichVu("phicomm_r1", "custom_ai_get_enabled");
      await this._lamMoiEntity(220);
    } catch (err) {
      console.warn("control bootstrap refresh failed", err);
    }
  }

  async _damBaoTrangThaiHeThong() {
    const now = Date.now();
    if (now - this._lastSystemStateRequestAt < 7000) return;
    this._lastSystemStateRequestAt = now;
    try {
      await this._goiDichVu("phicomm_r1", "refresh_state");
      await this._lamMoiEntity(250, 2);
    } catch (err) {
      console.warn("system bootstrap refresh failed", err);
    }
  }

  _ganSuKien() {
    const root = this.shadowRoot;
    if (!root) return;

    root.querySelectorAll("[data-tab]").forEach((el) => {
      el.addEventListener("click", () => {
        this._activeTab = el.dataset.tab || "media";
        this._veGiaoDien();
      });
    });

    root.querySelectorAll("[data-media-tab]").forEach((el) => {
      el.addEventListener("click", async () => {
        const nextTab = el.dataset.mediaTab || "songs";
        const changedTab = this._mediaSearchTab !== nextTab;
        this._mediaSearchTab = nextTab;
        this._veGiaoDien();
        if (changedTab && nextTab === "playlists") {
          await this._taiThuVienPlaylist();
        }
      });
    });

    root.querySelectorAll("[data-lighting-tab]").forEach((el) => {
      el.addEventListener("click", () => {
        this._lightingTab = el.dataset.lightingTab || "main";
        this._veGiaoDien();
      });
    });

    const mediaQuery = root.getElementById("media-query");
    if (mediaQuery) {
      mediaQuery.addEventListener("focus", () => {
        this._mediaQueryFocused = true;
      });
      mediaQuery.addEventListener("input", (ev) => {
        this._query = ev.target.value;
      });
      mediaQuery.addEventListener("compositionstart", () => {
        this._mediaDangCompose = true;
      });
      mediaQuery.addEventListener("compositionend", async (ev) => {
        this._mediaDangCompose = false;
        this._query = ev.target.value;
        if (!this._mediaTimKiemSauCompose) return;
        this._mediaTimKiemSauCompose = false;
        await this._xuLyTimKiem(ev.target.value);
      });
      mediaQuery.addEventListener("keydown", async (ev) => {
        if (ev.key !== "Enter") return;
        ev.preventDefault();
        ev.stopPropagation();
        if (ev.isComposing || this._mediaDangCompose) {
          this._mediaTimKiemSauCompose = true;
          return;
        }
        this._query = mediaQuery.value;
        await this._xuLyTimKiem(mediaQuery.value);
      });
      mediaQuery.addEventListener("blur", () => {
        this._mediaQueryFocused = false;
        // Defer pending-render flush so click on adjacent buttons
        // (especially Search) is not swallowed by an immediate re-render.
        setTimeout(() => {
          this._xuLyRenderCho();
        }, 0);
      });
    }

    const btnSearch = root.getElementById("btn-search");
    if (btnSearch) {
      btnSearch.addEventListener("mousedown", (ev) => {
        // Keep focus on input so blur-driven re-render cannot cancel first click.
        ev.preventDefault();
      });
      btnSearch.addEventListener("click", async () => {
        const currentQuery = mediaQuery ? mediaQuery.value : this._query;
        await this._xuLyTimKiem(currentQuery);
      });
    }

    const progressTrack = root.getElementById("playback-progress-track");
    if (progressTrack) {
      const seekToClientX = async (clientX) => {
        const duration = this._liveDurationSeconds > 0
          ? this._liveDurationSeconds
          : this._epKieuGiayPhat(this._thongTinPhat().duration, 0);
        if (duration <= 0) return;
        const rect = progressTrack.getBoundingClientRect();
        if (!rect.width) return;
        const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        const target = Math.floor(duration * ratio);
        this._livePositionSeconds = target;
        this._liveDurationSeconds = duration;
        this._liveTickAt = Date.now();
        this._dongBoTienDoDom();
        await this._goiDichVu("media_player", "seek", { position: target });
        await this._lamMoiEntity(180);
      };
      progressTrack.addEventListener("click", async (ev) => {
        await seekToClientX(ev.clientX);
      });
      progressTrack.addEventListener(
        "touchend",
        async (ev) => {
          const touch = ev.changedTouches?.[0];
          if (!touch) return;
          ev.preventDefault();
          await seekToClientX(touch.clientX);
        },
        { passive: false }
      );
    }

    const btnPrev = root.getElementById("btn-prev");
    if (btnPrev) {
      btnPrev.addEventListener("click", async () => {
        await this._goiDichVu("media_player", "media_previous_track");
      });
    }

    const btnPlayPause = root.getElementById("btn-playpause");
    if (btnPlayPause) {
      btnPlayPause.addEventListener("click", async () => {
        await this._xuLyPhatTamDung();
      });
    }

    const btnStop = root.getElementById("btn-stop");
    if (btnStop) {
      btnStop.addEventListener("click", async () => {
        this._forcePauseUntil = Date.now() + 5000;
        this._optimisticPlayUntil = 0;
        this._liveTrackKey = "";
        this._livePositionSeconds = 0;
        this._liveDurationSeconds = 0;
        this._livePlaying = false;
        this._nowPlayingCache = this._taoNowPlayingCache();
        this._dongBoTienDoDom();
        this._capNhatHenGioTienDo();
        await this._goiDichVu("media_player", "media_stop");
        this._lastPlayPauseSent = "pause";
        await this._lamMoiEntity(300);
      });
    }

    const btnNext = root.getElementById("btn-next");
    if (btnNext) {
      btnNext.addEventListener("click", async () => {
        await this._goiDichVu("media_player", "media_next_track");
      });
    }

    const volumeSlider = root.getElementById("media-volume");
    if (volumeSlider) {
      volumeSlider.addEventListener("input", (ev) => {
        this._volumeLevel = Number(ev.target.value) / 100;
      });
      volumeSlider.addEventListener("change", async (ev) => {
        this._volumeLevel = Number(ev.target.value) / 100;
        await this._goiDichVu("media_player", "volume_set", {
          volume_level: this._volumeLevel,
        });
      });
    }

    const layKetQuaTimKiemHienTai = () => this._duLieuTimKiemTheoTab().items || [];
    const layMucTimKiemTuElement = (element) => {
      const index = Number(element?.dataset?.searchIndex);
      if (!Number.isFinite(index) || index < 0) return null;
      return layKetQuaTimKiemHienTai()[index] || null;
    };

    root.querySelectorAll(".play-btn").forEach((el) => {
      el.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        const item = layMucTimKiemTuElement(el);
        if (!item) return;
        await this._xuLyPhatMuc(
          item,
          item.source || this._nguonKetQuaTheoTab(this._mediaSearchTab)
        );
      });
    });

    root.querySelectorAll(".add-btn").forEach((el) => {
      el.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        const item = layMucTimKiemTuElement(el);
        if (!item) return;
        await this._moDialogThemPlaylist(
          item,
          item.source || this._nguonKetQuaTheoTab(this._mediaSearchTab)
        );
      });
    });

    root.querySelectorAll(".result-item.playable").forEach((el) => {
      el.addEventListener("click", async (ev) => {
        if (ev.target && (ev.target.closest(".play-btn") || ev.target.closest(".add-btn"))) return;
        const item = layMucTimKiemTuElement(el);
        if (!item) return;
        await this._xuLyPhatMuc(
          item,
          item.source || this._nguonKetQuaTheoTab(this._mediaSearchTab)
        );
      });
      el.addEventListener("keydown", async (ev) => {
        if (ev.key !== "Enter" && ev.key !== " ") return;
        ev.preventDefault();
        const item = layMucTimKiemTuElement(el);
        if (!item) return;
        await this._xuLyPhatMuc(
          item,
          item.source || this._nguonKetQuaTheoTab(this._mediaSearchTab)
        );
      });
    });

    const playlistCreateBtn = root.getElementById("btn-playlist-create");
    if (playlistCreateBtn) {
      playlistCreateBtn.addEventListener("click", () => {
        this._moDialogTaoPlaylist();
      });
    }

    const playlistRefreshBtn = root.getElementById("btn-playlist-refresh");
    if (playlistRefreshBtn) {
      playlistRefreshBtn.addEventListener("click", async () => {
        await this._taiThuVienPlaylist();
      });
    }

    root.querySelectorAll("[data-playlist-view-index]").forEach((el) => {
      el.addEventListener("click", async () => {
        const index = Number(el.dataset.playlistViewIndex);
        const playlist = this._thuVienPlaylist()[index];
        if (!playlist?.id) return;
        await this._taiChiTietPlaylist(playlist.id);
      });
    });

    root.querySelectorAll("[data-playlist-play-index]").forEach((el) => {
      el.addEventListener("click", async () => {
        const index = Number(el.dataset.playlistPlayIndex);
        const playlist = this._thuVienPlaylist()[index];
        if (!playlist?.id) return;
        await this._taiChiTietPlaylist(playlist.id, false);
        await this._xuLyPhatMuc(
          { id: playlist.id, playlist_id: playlist.id, kind: "playlist", title: playlist.name },
          "youtube_playlist"
        );
      });
    });

    root.querySelectorAll("[data-playlist-delete-index]").forEach((el) => {
      el.addEventListener("click", async () => {
        const index = Number(el.dataset.playlistDeleteIndex);
        const playlist = this._thuVienPlaylist()[index];
        if (!playlist?.id) return;
        if (!confirm(`Xóa playlist "${playlist.name || "Playlist"}"?`)) return;
        this._playlistLibraryLoading = true;
        this._veGiaoDien();
        try {
          await this._goiDichVu("media_player", "playlist_delete", {
            playlist_id: playlist.id,
          });
          if (String(this._playlistDetailVisibleId) === String(playlist.id)) {
            this._playlistDetailVisibleId = "";
          }
        } finally {
          this._playlistLibraryLoading = false;
          this._veGiaoDien();
        }
      });
    });

    const playlistDetailClose = root.getElementById("playlist-detail-close");
    if (playlistDetailClose) {
      playlistDetailClose.addEventListener("click", () => {
        this._playlistDetailVisibleId = "";
        this._veGiaoDien();
      });
    }

    root.querySelectorAll("[data-playlist-song-index]").forEach((el) => {
      el.addEventListener("click", async () => {
        const detail = this._chiTietPlaylistDangXem();
        const playlistId = String(detail?.playlist_id || this._playlistDetailVisibleId || "").trim();
        const songIndex = Number(el.dataset.playlistSongIndex);
        if (!playlistId || !Number.isFinite(songIndex)) return;
        if (!confirm(`Xóa bài #${songIndex + 1} khỏi playlist?`)) return;
        this._playlistDetailLoading = true;
        this._veGiaoDien();
        try {
          await this._goiDichVu("media_player", "playlist_remove_song", {
            playlist_id: playlistId,
            song_index: songIndex,
          });
          await this._taiChiTietPlaylist(playlistId, false);
          await this._taiThuVienPlaylist(false);
        } finally {
          this._playlistDetailLoading = false;
          this._veGiaoDien();
        }
      });
    });

    const playlistDialogCancel = root.getElementById("playlist-dialog-cancel");
    if (playlistDialogCancel) {
      playlistDialogCancel.addEventListener("click", () => {
        if (this._playlistDialog.busy) return;
        this._dongDialogPlaylist();
      });
    }

    const playlistDialogConfirm = root.getElementById("playlist-dialog-confirm");
    if (playlistDialogConfirm) {
      playlistDialogConfirm.addEventListener("click", async () => {
        await this._xacNhanDialogPlaylist();
      });
    }

    const playlistSelect = root.getElementById("playlist-select");
    if (playlistSelect) {
      playlistSelect.addEventListener("change", (ev) => {
        this._playlistDialog = {
          ...this._playlistDialog,
          selectedPlaylistId: ev.target.value,
        };
      });
    }

    const playlistNewName = root.getElementById("playlist-new-name");
    if (playlistNewName) {
      playlistNewName.addEventListener("input", (ev) => {
        this._playlistDialog = {
          ...this._playlistDialog,
          newPlaylistName: ev.target.value,
        };
      });
      playlistNewName.addEventListener("keydown", async (ev) => {
        if (ev.key !== "Enter") return;
        ev.preventDefault();
        await this._xacNhanDialogPlaylist();
      });
    }

    const wakeEnabled = root.getElementById("wake-enabled");
    if (wakeEnabled) {
      wakeEnabled.addEventListener("change", async (ev) => {
        const desired = Boolean(ev.target.checked);
        this._wakeEnabled = desired;
        this._datCongTacCho("wake_enabled", desired);
        try {
          await this._goiDichVu("phicomm_r1", "wake_word_set_enabled", {
            enabled: desired,
          });
          await this._lamMoiEntity(250, 2);
        } catch (err) {
          console.warn("wake_word_set_enabled failed", err);
          this._xoaCongTacCho("wake_enabled");
          this._wakeEnabled = !desired;
          ev.target.checked = this._wakeEnabled;
        }
      });
    }

    const wakeSensitivity = root.getElementById("wake-sensitivity");
    if (wakeSensitivity) {
      wakeSensitivity.addEventListener("input", (ev) => {
        this._wakeSensitivity = Number(ev.target.value);
      });
      wakeSensitivity.addEventListener("change", async (ev) => {
        this._wakeSensitivity = Number(ev.target.value);
        await this._goiDichVu("phicomm_r1", "wake_word_set_sensitivity", {
          sensitivity: this._wakeSensitivity,
        });
        await this._lamMoiEntity(300);
      });
    }

    const wakeRefresh = root.getElementById("wake-refresh");
    if (wakeRefresh) {
      wakeRefresh.addEventListener("click", async () => {
        await this._goiDichVu("phicomm_r1", "wake_word_get_enabled");
        await this._goiDichVu("phicomm_r1", "wake_word_get_sensitivity");
        await this._lamMoiEntity(220);
      });
    }

    const aiEnabled = root.getElementById("ai-enabled");
    if (aiEnabled) {
      aiEnabled.addEventListener("change", async (ev) => {
        const desired = Boolean(ev.target.checked);
        this._antiDeafEnabled = desired;
        this._datCongTacCho("anti_deaf_enabled", desired);
        try {
          await this._goiDichVu("phicomm_r1", "anti_deaf_ai_set_enabled", {
            enabled: desired,
          });
          await this._lamMoiEntity(250, 2);
        } catch (err) {
          console.warn("anti_deaf_ai_set_enabled failed", err);
          this._xoaCongTacCho("anti_deaf_enabled");
          this._antiDeafEnabled = !desired;
          ev.target.checked = this._antiDeafEnabled;
        }
      });
    }

    const dlnaEnabled = root.getElementById("dlna-enabled");
    if (dlnaEnabled) {
      dlnaEnabled.addEventListener("change", async (ev) => {
        const desired = Boolean(ev.target.checked);
        this._dlnaEnabled = desired;
        this._datCongTacCho("dlna_enabled", desired);
        try {
          await this._goiDichVu("phicomm_r1", "set_dlna", {
            enabled: desired,
          });
          await this._lamMoiEntity(250, 2);
        } catch (err) {
          console.warn("set_dlna failed", err);
          this._xoaCongTacCho("dlna_enabled");
          this._dlnaEnabled = !desired;
          ev.target.checked = this._dlnaEnabled;
        }
      });
    }

    const airplayEnabled = root.getElementById("airplay-enabled");
    if (airplayEnabled) {
      airplayEnabled.addEventListener("change", async (ev) => {
        const desired = Boolean(ev.target.checked);
        this._airplayEnabled = desired;
        this._datCongTacCho("airplay_enabled", desired);
        try {
          await this._goiDichVu("phicomm_r1", "set_airplay", {
            enabled: desired,
          });
          await this._lamMoiEntity(250, 2);
        } catch (err) {
          console.warn("set_airplay failed", err);
          this._xoaCongTacCho("airplay_enabled");
          this._airplayEnabled = !desired;
          ev.target.checked = this._airplayEnabled;
        }
      });
    }

    const bluetoothEnabled = root.getElementById("bluetooth-enabled");
    if (bluetoothEnabled) {
      bluetoothEnabled.addEventListener("change", async (ev) => {
        const desired = Boolean(ev.target.checked);
        this._bluetoothEnabled = desired;
        this._datCongTacCho("bluetooth_enabled", desired);
        try {
          await this._goiDichVu("phicomm_r1", "set_bluetooth", {
            enabled: desired,
          });
          await this._lamMoiEntity(250, 2);
        } catch (err) {
          console.warn("set_bluetooth failed", err);
          this._xoaCongTacCho("bluetooth_enabled");
          this._bluetoothEnabled = !desired;
          ev.target.checked = this._bluetoothEnabled;
        }
      });
    }

    const chatInput = root.getElementById("chat-input");
    if (chatInput) {
      chatInput.addEventListener("compositionstart", () => {
        this._chatDangCompose = true;
      });
      chatInput.addEventListener("compositionend", (ev) => {
        this._chatDangCompose = false;
        this._chatInput = ev.target.value;
      });
      chatInput.addEventListener("input", (ev) => {
        this._chatInput = ev.target.value;
      });
      chatInput.addEventListener("keydown", async (ev) => {
        if (ev.isComposing || this._chatDangCompose) return;
        if (ev.key === "Enter") {
          ev.preventDefault();
          await this._guiTinNhanChat();
        }
      });
      chatInput.addEventListener("blur", () => {
        setTimeout(() => {
          this._xuLyRenderCho();
        }, 0);
      });
    }

    const chatSend = root.getElementById("chat-send");
    if (chatSend) {
      chatSend.addEventListener("mousedown", (ev) => {
        ev.preventDefault();
      });
      chatSend.addEventListener("click", async () => {
        await this._guiTinNhanChat();
      });
    }

    const chatWakeup = root.getElementById("chat-wakeup");
    if (chatWakeup) {
      chatWakeup.addEventListener("click", async () => {
        await this._goiDichVu("phicomm_r1", "chat_wake_up");
        await this._lamMoiEntity(280);
      });
    }

    const chatTestMic = root.getElementById("chat-testmic");
    if (chatTestMic) {
      chatTestMic.addEventListener("click", async () => {
        await this._goiDichVu("phicomm_r1", "chat_test_mic");
        await this._lamMoiEntity(280);
      });
    }

    const chatRefresh = root.getElementById("chat-refresh");
    if (chatRefresh) {
      chatRefresh.addEventListener("click", async () => {
        this._lastChatStateRequestAt = Date.now();
        this._lastChatHistoryRequestAt = Date.now();
        await this._goiDichVu("phicomm_r1", "chat_get_state");
        await this._goiDichVu("phicomm_r1", "chat_get_history");
        await this._lamMoiEntity(280);
      });
    }

    const eqEnabled = root.getElementById("eq-enabled");
    if (eqEnabled) {
      eqEnabled.addEventListener("change", async (ev) => {
        this._eqEnabled = Boolean(ev.target.checked);
        this._batDauCanhGacDongBoEq(1400);
        this._capNhatEqGiaoDien(root);
        await this._goiDichVu("media_player", "set_eq_enable", {
          enabled: this._eqEnabled,
        });
        await this._lamMoiEntity(250, 2);
      });
    }

    root.querySelectorAll("[data-eq-band]").forEach((slider) => {
      const docBand = Math.max(0, Math.round(Number(slider.dataset.eqBand || 0)));
      slider.addEventListener("input", (ev) => {
        const band = Math.max(0, Math.min(this._eqBandCount - 1, docBand));
        const level = this._gioiHanEqLevel(ev.target.value, this._layEqLevelTheoBand(band, 0));
        if (!Array.isArray(this._eqBands) || this._eqBands.length < this._eqBandCount) {
          this._eqBands = Array.from({ length: this._eqBandCount }, (_, index) =>
            this._layEqLevelTheoBand(index, 0)
          );
        }
        this._eqBand = band;
        this._eqLevel = level;
        this._eqBands[band] = level;
        this._batDauCanhGacDongBoEq(1000);
        this._capNhatEqGiaoDien(root);
      });
      slider.addEventListener("change", async (ev) => {
        const band = Math.max(0, Math.min(this._eqBandCount - 1, docBand));
        const level = this._gioiHanEqLevel(ev.target.value, this._layEqLevelTheoBand(band, 0));
        if (!Array.isArray(this._eqBands) || this._eqBands.length < this._eqBandCount) {
          this._eqBands = Array.from({ length: this._eqBandCount }, (_, index) =>
            this._layEqLevelTheoBand(index, 0)
          );
        }
        this._eqBand = band;
        this._eqLevel = level;
        this._eqBands[band] = level;
        this._batDauCanhGacDongBoEq(1600);
        if (!this._eqEnabled) {
          this._eqEnabled = true;
          this._capNhatEqGiaoDien(root);
          await this._goiDichVu("media_player", "set_eq_enable", {
            enabled: true,
          });
        }
        await this._goiDichVu("media_player", "set_eq_bandlevel", {
          band,
          level,
        });
        await this._lamMoiEntity(220, 2);
        this._xuLyRenderCho();
      });
      slider.addEventListener("blur", () => {
        setTimeout(() => this._xuLyRenderCho(), 0);
      });
    });

    root.querySelectorAll(".eq-preset").forEach((el) => {
      el.addEventListener("click", async () => {
        await this._apDungEqMau(el.dataset.preset || "");
      });
    });

    const bassEnabled = root.getElementById("bass-enabled");
    if (bassEnabled) {
      bassEnabled.addEventListener("change", async (ev) => {
        this._bassEnabled = Boolean(ev.target.checked);
        await this._goiDichVu("phicomm_r1", "set_bass_enable", {
          enabled: this._bassEnabled,
        });
        await this._lamMoiEntity(250, 2);
      });
    }

    const bassStrength = root.getElementById("bass-strength");
    if (bassStrength) {
      bassStrength.addEventListener("input", (ev) => {
        this._bassStrength = Number(ev.target.value);
      });
      bassStrength.addEventListener("change", async (ev) => {
        this._bassStrength = Number(ev.target.value);
        await this._goiDichVu("phicomm_r1", "set_bass_strength", {
          strength: this._bassStrength,
        });
        await this._lamMoiEntity(250, 2);
      });
    }

    const loudnessEnabled = root.getElementById("loudness-enabled");
    if (loudnessEnabled) {
      loudnessEnabled.addEventListener("change", async (ev) => {
        this._loudnessEnabled = Boolean(ev.target.checked);
        await this._goiDichVu("phicomm_r1", "set_loudness_enable", {
          enabled: this._loudnessEnabled,
        });
        await this._lamMoiEntity(250, 2);
      });
    }

    const loudnessGain = root.getElementById("loudness-gain");
    if (loudnessGain) {
      loudnessGain.addEventListener("input", (ev) => {
        this._loudnessGain = Number(ev.target.value);
      });
      loudnessGain.addEventListener("change", async (ev) => {
        this._loudnessGain = Number(ev.target.value);
        await this._goiDichVu("phicomm_r1", "set_loudness_gain", {
          gain: this._loudnessGain,
        });
        await this._lamMoiEntity(250, 2);
      });
    }

    const mainLightEnabled = root.getElementById("main-light-enabled");
    if (mainLightEnabled) {
      mainLightEnabled.addEventListener("change", async (ev) => {
        const desired = Boolean(ev.target.checked);
        this._mainLightEnabled = desired;
        this._datCongTacCho("main_light_enabled", desired);
        try {
          await this._goiDichVu("phicomm_r1", "set_main_light", {
            enabled: desired,
          });
          await this._lamMoiEntity(250, 2);
        } catch (err) {
          console.warn("set_main_light failed", err);
          this._xoaCongTacCho("main_light_enabled");
          this._mainLightEnabled = !desired;
          ev.target.checked = this._mainLightEnabled;
        }
      });
    }

    const mainBrightness = root.getElementById("main-light-brightness");
    if (mainBrightness) {
      mainBrightness.addEventListener("input", (ev) => {
        this._mainLightBrightness = Number(ev.target.value);
      });
      mainBrightness.addEventListener("change", async (ev) => {
        this._mainLightBrightness = Number(ev.target.value);
        await this._goiDichVu("phicomm_r1", "set_light_brightness", {
          brightness: this._mainLightBrightness,
        });
        await this._lamMoiEntity(250, 2);
      });
    }

    const mainSpeed = root.getElementById("main-light-speed");
    if (mainSpeed) {
      mainSpeed.addEventListener("input", (ev) => {
        this._mainLightSpeed = Number(ev.target.value);
      });
      mainSpeed.addEventListener("change", async (ev) => {
        this._mainLightSpeed = Number(ev.target.value);
        await this._goiDichVu("phicomm_r1", "set_light_speed", {
          speed: this._mainLightSpeed,
        });
        await this._lamMoiEntity(250, 2);
      });
    }

    root.querySelectorAll(".light-mode").forEach((el) => {
      el.addEventListener("click", async () => {
        const mode = Number(el.dataset.mode || "0");
        this._mainLightMode = mode;
        await this._goiDichVu("phicomm_r1", "set_light_mode", { mode });
        await this._lamMoiEntity(250, 2);
      });
    });

    const edgeEnabled = root.getElementById("edge-light-enabled");
    if (edgeEnabled) {
      edgeEnabled.addEventListener("change", async (ev) => {
        this._edgeLightEnabled = Boolean(ev.target.checked);
        await this._goiDichVu("phicomm_r1", "set_edge_light", {
          enabled: this._edgeLightEnabled,
          intensity: this._edgeLightIntensity,
        });
        await this._lamMoiEntity(250, 2);
      });
    }

    const edgeIntensity = root.getElementById("edge-light-intensity");
    if (edgeIntensity) {
      edgeIntensity.addEventListener("input", (ev) => {
        this._edgeLightIntensity = Number(ev.target.value);
      });
      edgeIntensity.addEventListener("change", async (ev) => {
        this._edgeLightIntensity = Number(ev.target.value);
        await this._goiDichVu("phicomm_r1", "set_edge_light", {
          enabled: this._edgeLightEnabled,
          intensity: this._edgeLightIntensity,
        });
        await this._lamMoiEntity(250, 2);
      });
    }

    const rebootBtn = root.getElementById("system-reboot");
    if (rebootBtn) {
      rebootBtn.addEventListener("click", async () => {
        await this._goiDichVu("phicomm_r1", "reboot");
      });
    }
  }
}

if (!customElements.get("phicomm-r1-card")) {
  customElements.define("phicomm-r1-card", PhicommR1Card);
}

window.customCards = window.customCards || [];
if (!window.customCards.find((card) => card.type === "phicomm-r1-card")) {
  window.customCards.push({
    type: "phicomm-r1-card",
    name: "Phicomm R1 Card",
    description: "Tabbed dashboard card for Phicomm R1 integration",
    preview: true,
  });
}
