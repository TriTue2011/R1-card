# AI BOX WebUI Card for Home Assistant

[![HACS](https://img.shields.io/badge/HACS-Custom-orange.svg)](https://hacs.xyz/)
![Version](https://img.shields.io/badge/version-7.5.0-blue.svg)

Custom Lovelace card điều khiển toàn diện thiết bị AI BOX (Phicomm R1) ngay trong Home Assistant.

**Card name:** `custom:aibox-webui-card`  
**Hỗ trợ:** LAN (WS) · Cloudflare Tunnel (WSS) · Multi-Room · Sync Playback

---

## Tính năng

### ♪ Media
- Phát nhạc YouTube / Zing MP3
- Waveform visualizer 2 kiểu: **Classic** (bars mượt) và **Peak Ball** (thanh đẩy + hình tròn rơi)
- Seek bar, repeat, shuffle
- Tìm kiếm bài hát / playlist (YouTube, Zing MP3, YouTube Playlist)
- Quản lý playlist: tạo, xóa, xem danh sách, thêm/xóa bài
- **Song Cache:** bộ nhớ tạm lưu kết quả tìm kiếm và bài trong playlist để hỗ trợ multiroom

### ⚙ Control
- Wake Word **"Ô Kề Na Bu"** — bật/tắt + chỉnh độ nhạy
- **30 giọng TTS** tiếng Việt (Chống Điếc AI) + preview giọng
- DLNA / AirPlay / Bluetooth toggle
- LED RGB + đèn viền Edge
- **Audio Engine:** EQ 5 băng tần, presets, Bass Boost, Loudness, Surround
- Dải trầm / cao riêng biệt (DAC Mixer L/R)
- Báo thức nâng cao: giờ, lặp lại, theo ngày trong tuần, volume, YouTube alarm

### 💬 Chat
- Gửi text và nhận phản hồi AI
- Wake Up / Interrupt / End Session
- TikTok Reply toggle
- Ảnh nền chat tuỳ chỉnh

### ✦ System
- CPU / RAM realtime
- MAC Address (xem, random, khôi phục thực)
- OTA Server chọn nguồn firmware
- WiFi: quét, kết nối, xóa mạng đã lưu
- Home Assistant integration (URL, Agent ID, API Key)
- Thông tin kết nối WS / WSS

---

## 🏠 Multi-Room — Nhiều Loa

Card hỗ trợ điều khiển đồng thời nhiều loa Phicomm R1 trong nhiều phòng khác nhau.

### Chuyển phòng
Chọn phòng bằng cách nhấn **Room Pill** tương ứng trên thanh room bar. Card tự lưu phòng đang chọn vào localStorage và khôi phục khi tải lại.

### Broadcast (Đồng phát)
Bên cạnh mỗi room pill (trừ phòng đang chọn) có icon **⭕ / 🔗** — tick vào để bật chế độ broadcast sang phòng đó. Khi bật:
- Lệnh phát nhạc, pause, resume, seek, stop được gửi đồng thời đến tất cả phòng đã tick
- Khi bật broadcast, bài đang phát ở phòng chính được gửi ngay sang phòng mới kết nối
- Trạng thái broadcast được lưu và khôi phục giữa các lần tải lại trang

### Volume từng phòng
Khi có ít nhất 1 phòng được broadcast, thanh **Room Volumes** xuất hiện hiển thị slider âm lượng độc lập cho từng phòng. Phòng chính được đánh dấu **★**.

### Sync Playback
Khi phát nhạc đồng bộ trên nhiều phòng, độ trễ mạng có thể làm lệch thời gian phát. Thanh **SYNC** cung cấp:

| Nút | Chức năng |
|---|---|
| **⏱ Sync Now** | Pause tất cả → Seek đồng loạt → Resume — đưa tất cả về cùng vị trí |
| **🔄 Auto ON/OFF** | Tự động sync 1 lần mỗi bài sau khi bắt đầu phát |
| **⚙** | Mở panel chỉnh thời gian sync |

#### Cài đặt thời gian Sync
| Tham số | Mặc định | Mô tả |
|---|---|---|
| `auto_sync_delay_ms` | `5000` | Chờ bao lâu sau khi bài bắt đầu rồi auto-sync |
| `sync_pause_ms` | `400` | Thời gian pause để các client ổn định |
| `sync_resume_delay_ms` | `3000` | Chờ sau seek rồi mới resume (để buffer) |

### Đồng bộ bài hát sang phòng (Song Sync)
Khi master chuyển bài (next/prev/auto-next hoặc phát từ danh sách), card tự động xác định bài mới và gửi lệnh phát đúng bài đó sang các phòng broadcast:

1. Tra cứu **Song Cache** (kết quả search hoặc bài trong playlist đã tải)
2. Nếu là YouTube — extract `video_id` từ thumbnail URL
3. Nếu là Zing + đang phát playlist — re-fetch playlist để lấy `song_id`
4. Fallback: gửi lệnh `next` để room tự advance queue

Tắt tính năng này bằng cách set `sync_send_song: false` trong config.

---

## Yêu cầu

- Home Assistant với Lovelace
- AI BOX firmware v6.x trở lên trên Phicomm R1
- Truy cập LAN hoặc qua Cloudflare Tunnel

---

## Cài đặt

### HACS (khuyến nghị)

1. HACS → **Custom repositories**
2. Add: `https://github.com/TriTue2011/R1-card` — Category: **Dashboard**
3. Download → Reload browser (Ctrl+F5)

### Thủ công

1. Copy `aibox-webui-card.js` vào `config/www/aibox-webui-card.js`
2. **Settings → Dashboards → Resources**
3. Add resource: `/local/aibox-webui-card.js` — Type: **JavaScript Module**
4. Reload browser (Ctrl+F5)

---

## Cấu hình

### LAN — 1 loa

```yaml
type: custom:aibox-webui-card
host: 192.168.1.100
mode: auto
```

### Tunnel — 1 loa

```yaml
type: custom:aibox-webui-card
host: 192.168.1.100
tunnel_host: your-tunnel.trycloudflare.com
speaker_tunnel_host: your-speaker-tunnel.trycloudflare.com
mode: auto
```

> Card tự append `?ip=<speaker_ip>` vào tunnel URL.

### Multi-Room — Nhiều loa

```yaml
type: custom:aibox-webui-card
mode: auto
title: Your name
default_collapsed: false
sync_send_song: true
auto_sync_delay_ms: 5000
sync_pause_ms: 400
sync_resume_delay_ms: 2000
rooms:
  - name: "Phòng khách"
    host: "192.168.1.100"
    tunnel_host: your-tunnel.trycloudflare.com
    speaker_tunnel_host: your-speaker-tunnel.trycloudflare.com
  - name: "Phòng ngủ"
    host: "192.168.1.101"
    tunnel_host: your-tunnel.trycloudflare.com
    speaker_tunnel_host: your-speaker-tunnel.trycloudflare.com
```

Nhiều loa dùng chung tunnel domain — card phân biệt qua `?ip=` trong mỗi kết nối.

---

## Tham số cấu hình

### Card (toàn cục)

| Tham số | Mặc định | Mô tả |
|---|---|---|
| `host` | *(hostname)* | IP loa Phicomm R1 |
| `mode` | `auto` | `auto` · `lan` · `tunnel` |
| `title` | `AI BOX` | Tiêu đề hiển thị |
| `default_tab` | `media` | Tab mặc định: `media` / `control` / `chat` / `system` |
| `default_collapsed` | `false` | Thu gọn card khi tải lần đầu |
| `show_background` | `true` | Hiển thị ảnh nền chat |
| `sync_send_song` | `true` | Tự động gửi bài hát sang phòng broadcast khi chuyển bài |
| `auto_sync_delay_ms` | `5000` | Chờ bao lâu sau khi bài bắt đầu phát rồi auto-sync (ms) |
| `sync_pause_ms` | `400` | Thời gian pause để client ổn định trước khi seek (ms) |
| `sync_resume_delay_ms` | `3000` | Chờ sau khi seek xong rồi mới resume (ms) |
| `ws_port` | `8082` | Port WebSocket chính |
| `speaker_port` | `8080` | Port WebSocket loa |
| `http_port` | `8081` | Port HTTP |
| `tunnel_host` | | Domain tunnel cho WS 8082 |
| `tunnel_port` | `443` | Port tunnel |
| `tunnel_path` | `/` | Path tunnel |
| `speaker_tunnel_host` | | Domain tunnel cho Speaker WS 8080 |
| `speaker_tunnel_port` | `443` | Port tunnel speaker |
| `speaker_tunnel_path` | `/` | Path tunnel speaker |
| `reconnect_ms` | `1500` | Thời gian chờ reconnect (ms) |
| `connect_timeout_ms` | `2500` | Timeout mỗi lần thử kết nối (ms) |
| `rooms` | `null` | Mảng room cho multi-device |

### Mỗi room (khi dùng `rooms`)

| Tham số | Bắt buộc | Mô tả |
|---|---|---|
| `name` | ✅ | Tên phòng hiển thị |
| `host` | ✅ | IP loa |
| `tunnel_host` | | Domain tunnel WS chính |
| `tunnel_port` | | Port tunnel WS (mặc định 443) |
| `tunnel_path` | | Path tunnel WS (mặc định `/`) |
| `speaker_tunnel_host` | | Domain tunnel Speaker WS |
| `speaker_tunnel_port` | | Port tunnel speaker (mặc định 443) |
| `speaker_tunnel_path` | | Path tunnel speaker (mặc định `/`) |

---

## Waveform Visualizer

Khi đang phát nhạc, thanh waveform hiển thị phía trên seek bar. Nhấn nút **`⚬`** / **`≡`** nhỏ góc trái waveform để đổi kiểu:

| Nút | Kiểu | Mô tả |
|---|---|---|
| `⚬` | **Peak Ball** | Thanh bắn lên đẩy hình tròn, hình tròn từ từ rơi xuống |
| `≡` | **Classic** | Thanh nhảy lên xuống mượt mà liên tục |

Waveform tự ẩn khi dừng / tạm dừng nhạc.

---

## Collapse Card

Nhấn nút **▲ / ▼** góc trên phải header để thu gọn / mở rộng card. Khi thu gọn:
- Tất cả WebSocket (chính + loa + broadcast rooms) được ngắt kết nối
- Auto-sync bị tạm dừng
- Giúp tiết kiệm tài nguyên trình duyệt khi không cần dùng

Mở lại card sẽ tự động kết nối lại và khôi phục trạng thái.

---

## Tuỳ chỉnh giao diện (card_mod)

Card hỗ trợ [card-mod](https://github.com/thomasloven/lovelace-card-mod) để tuỳ chỉnh toàn bộ màu sắc, viền, nền.

> **Yêu cầu:** Cài card-mod qua HACS trước khi dùng.

### Nền trong suốt hoàn toàn

```yaml
card_mod:
  style: |
    ha-card {
      background: transparent !important;
      box-shadow: none !important;
      border: none !important;
    }
    ha-card .wrap {
      background: transparent !important;
      border: none !important;
      box-shadow: none !important;
    }
```

### Glassmorphism (trong suốt + blur)

Trông đẹp nhất khi dashboard có ảnh nền.

```yaml
card_mod:
  style: |
    ha-card {
      background: transparent !important;
      box-shadow: none !important;
      border: none !important;
    }
    ha-card .wrap {
      background: rgba(255,255,255,0.05) !important;
      backdrop-filter: blur(20px) !important;
      -webkit-backdrop-filter: blur(20px) !important;
      border: 1px solid rgba(255,255,255,0.1) !important;
      box-shadow: none !important;
    }
```

### Tuỳ chỉnh từng màu chi tiết

Dưới đây là config đầy đủ với ghi chú từng element. Thay màu hex theo ý muốn.

```yaml
card_mod:
  style: |
    ha-card {
      background: transparent !important;
      box-shadow: none !important;
      border: none !important;
    }
    ha-card .wrap {
      background: transparent !important;
      border: none !important;
      box-shadow: none !important;
    }

    /* ═══ VIỀN CÁC ELEMENT ═══ */
    ha-card .tabs,
    ha-card .media-card,
    ha-card .mc-vis,
    ha-card .toggle-item,
    ha-card .slider-row,
    ha-card .collapsible-header,
    ha-card .collapsible-body,
    ha-card .sys-info-item,
    ha-card .chat-wrap,
    ha-card .alarm-item,
    ha-card .ctrl-section,
    ha-card .search-results,
    ha-card .result-item,
    ha-card .pl-item,
    ha-card .form-row,
    ha-card .room-bar,
    ha-card .room-pill,
    ha-card .mc-top,
    ha-card .mc-seek-wrap,
    ha-card .mc-bg {
      background: transparent !important;
      box-shadow: none !important;
      border-color: #FF6B00 !important; /* 🔶 Màu viền tất cả element */
    }

    /* ═══ CHỮ CHUNG ═══ */
    ha-card .title-text { color: #1a1a1a !important; }
    ha-card .conn-label { color: #1a1a1a !important; }
    ha-card .mc-title { color: #1a1a1a !important; }
    ha-card .mc-artist { color: #555555 !important; }
    ha-card .time-txt { color: #1a1a1a !important; }
    ha-card .vol-icon { color: #1a1a1a !important; }
    ha-card .vol-label { color: #1a1a1a !important; }

    /* ═══ TAB CHÍNH ═══ */
    ha-card .tab { color: #1a1a1a !important; }
    ha-card .tab.active {
      color: #1a1a1a !important;
      background: rgba(255,107,0,0.12) !important;
      border-color: #FF6B00 !important;
    }

    /* ═══ ROOM PILLS ═══ */
    ha-card .room-pill,
    ha-card .room-pill span { color: #1a1a1a !important; }
    ha-card .room-pill.active {
      background: rgba(255,107,0,0.15) !important;
      border-color: #FF6B00 !important;
      color: #1a1a1a !important;
    }

    /* ═══ SYNC BAR ═══ */
    ha-card .sync-bar { border-color: #FF6B00 !important; }
    ha-card .sync-bar-label { color: #FF6B00 !important; }
    ha-card .sync-btn {
      border-color: #FF6B00 !important;
      background: rgba(255,107,0,0.15) !important;
      color: #FF6B00 !important;
    }
    ha-card .sync-room-badge.ok {
      border-color: rgba(255,107,0,0.4) !important;
      color: #FF6B00 !important;
    }

    /* ═══ ROOM VOLUMES ═══ */
    ha-card .room-volumes { border-color: #FF6B00 !important; }
    ha-card .room-vol-name { color: #1a1a1a !important; }
    ha-card .room-vol-label { color: #1a1a1a !important; }

    /* ═══ CONTROL TAB ═══ */
    ha-card .tog-name { color: #1a1a1a !important; }
    ha-card .tog-desc { color: #555555 !important; }
    ha-card .section-label { color: #FF6B00 !important; }
    ha-card .s-name { color: #1a1a1a !important; }
    ha-card .s-val { color: #FF6B00 !important; }

    /* ═══ SEARCH TABS ═══ */
    ha-card .stab { color: #1a1a1a !important; }
    ha-card .stab.active { color: #FF6B00 !important; }

    /* ═══ SUB TABS ═══ */
    ha-card .sub-tab { color: #1a1a1a !important; }
    ha-card .sub-tab.active { color: #FF6B00 !important; }

    /* ═══ SYSTEM TAB ═══ */
    ha-card .sys-label { color: #888888 !important; }
    ha-card .sys-value { color: #1a1a1a !important; }

    /* ═══ ALARM ═══ */
    ha-card .alarm-time { color: #1a1a1a !important; }
    ha-card .alarm-meta { color: #555555 !important; }

    /* ═══ SEARCH RESULTS ═══ */
    ha-card .result-title { color: #1a1a1a !important; }
    ha-card .result-sub { color: #555555 !important; }

    /* ═══ PLAYLIST ═══ */
    ha-card .pl-name { color: #1a1a1a !important; }
    ha-card .pl-count { color: #888888 !important; }

    /* ═══ WIFI ═══ */
    ha-card .wifi-ssid { color: #1a1a1a !important; }
    ha-card .wifi-rssi { color: #888888 !important; }

    /* ═══ FORM ═══ */
    ha-card .form-label { color: #555555 !important; }
    ha-card .search-inp,
    ha-card .form-inp,
    ha-card .chat-inp {
      background: transparent !important;
      border-color: #FF6B00 !important;
      color: #1a1a1a !important;
    }

    /* ═══ EQ ═══ */
    ha-card .eq-band-val { color: #FF6B00 !important; }
    ha-card .eq-band label { color: #1a1a1a !important; }

    /* ═══ OFFLINE OVERLAY ═══ */
    ha-card .offline-title { color: #FF4500 !important; }
    ha-card .offline-room { color: #1a1a1a !important; }

    /* ═══ DOT KẾT NỐI ═══ */
    ha-card .dot.on {
      background: #FF6B00 !important;
      box-shadow: 0 0 10px rgba(255,107,0,0.6) !important;
    }

    /* ═══ SOURCE LABEL ═══ */
    ha-card .mc-source {
      background: rgba(255,107,0,0.2) !important;
      border-color: #FF6B00 !important;
      color: #FF6B00 !important;
    }

    /* ═══ NÚT PLAY TO ═══ */
    ha-card .ctrl-btn.play {
      background: linear-gradient(135deg, #FF6B00, #e65c00) !important;
      border-color: #FF6B00 !important;
      box-shadow: 0 4px 20px rgba(255,107,0,0.4) !important;
    }

    /* ═══ WAVEFORM ═══ */
    ha-card .wv-bar {
      background: linear-gradient(to top, rgba(255,107,0,0.6), rgba(255,150,50,0.9)) !important;
    }
    ha-card .wv-ball {
      background: #FF6B00 !important;
      box-shadow: 0 0 4px rgba(255,107,0,0.8) !important;
    }

    /* ═══ SEEK BAR ═══ */
    ha-card .mc-seek-fill {
      background: linear-gradient(to right, #FF6B00, #ffaa55) !important;
    }
    ha-card .mc-seek-thumb { background: #FF6B00 !important; }

    /* ═══ TOGGLE SWITCH ═══ */
    ha-card .sw.on {
      background: rgba(255,107,0,0.2) !important;
      border-color: rgba(255,107,0,0.5) !important;
    }
    ha-card .sw.on::after { background: #FF6B00 !important; }

    /* ═══ SLIDER THUMB ═══ */
    ha-card input[type=range]::-webkit-slider-thumb {
      background: #FF6B00 !important;
      border-color: rgba(255,150,50,0.5) !important;
    }

    /* ═══ BUTTONS ═══ */
    ha-card .search-btn,
    ha-card .form-btn {
      background: rgba(255,107,0,0.2) !important;
      border-color: #FF6B00 !important;
      color: #FF6B00 !important;
    }
    ha-card .send-btn {
      background: rgba(255,107,0,0.2) !important;
      border-color: rgba(255,107,0,0.4) !important;
      color: #FF6B00 !important;
    }
    ha-card .chat-action-btn {
      border-color: rgba(255,107,0,0.3) !important;
      background: rgba(255,107,0,0.1) !important;
      color: #FF4500 !important;
    }

    /* ═══ STAT BAR ═══ */
    ha-card .stat-bar.cpu {
      background: linear-gradient(90deg, #FF6B00, #ffaa55) !important;
    }
    ha-card .stat-bar.ram {
      background: linear-gradient(90deg, #0891b2, #38bdf8) !important;
    }
```

### Bảng tham chiếu CSS class

| Class | Vị trí hiển thị |
|---|---|
| `.wrap` | Container toàn bộ card |
| `.tabs` | Thanh tab chính (Media/Control/Chat/System) |
| `.tab` | Từng nút tab |
| `.tab.active` | Tab đang được chọn |
| `.room-bar` | Thanh chọn room (multi-room) |
| `.room-pill` | Từng nút room |
| `.room-pill.active` | Room đang được chọn |
| `.sync-bar` | Thanh sync playback |
| `.sync-btn` | Nút Sync Now / Auto / Settings |
| `.sync-room-badge` | Badge trạng thái kết nối từng phòng |
| `.sync-room-badge.ok` | Badge phòng đã kết nối |
| `.sync-room-badge.pending` | Badge phòng đang chờ kết nối |
| `.room-volumes` | Khu vực slider âm lượng từng phòng |
| `.room-vol-name` | Tên phòng trong slider volume |
| `.room-vol-label` | Giá trị volume từng phòng |
| `.media-card` | Card media (tên bài, controls) |
| `.mc-title` | Tên bài hát |
| `.mc-artist` | Tên nghệ sĩ |
| `.mc-vis` | Khu vực waveform + thumbnail |
| `.mc-source` | Badge IDLE / YOUTUBE / ZING |
| `.mc-seek-fill` | Thanh tiến trình nhạc |
| `.wv-bar` | Thanh waveform |
| `.wv-ball` | Hình tròn đỉnh waveform (Peak Ball mode) |
| `.ctrl-btn.play` | Nút Play to tròn |
| `.toggle-item` | Hàng toggle (DLNA, AirPlay...) |
| `.tog-name` | Tên toggle |
| `.sw.on` | Switch đang bật |
| `.slider-row` | Hàng slider |
| `.s-name` | Tên slider |
| `.s-val` | Giá trị slider |
| `.section-label` | Tiêu đề section (📡 CONTROL...) |
| `.collapsible-header` | Header có thể thu gọn (Audio Engine, Lighting) |
| `.stab` | Tab tìm kiếm (Songs/Playlist/Zing) |
| `.sub-tab` | Sub-tab (Equalizer/Surround, Đèn Chính/Viền) |
| `.eq-band-val` | Giá trị dB mỗi băng EQ |
| `.alarm-time` | Giờ báo thức |
| `.alarm-meta` | Mô tả báo thức |
| `.sys-label` | Label system (CPU, RAM...) |
| `.sys-value` | Giá trị system |
| `.stat-bar.cpu` | Thanh tiến trình CPU |
| `.stat-bar.ram` | Thanh tiến trình RAM |
| `.chat-wrap` | Khung chat |
| `.chat-action-btn` | Nút Wake Up / Test Mic / Clear |
| `.send-btn` | Nút gửi chat |
| `.result-title` | Tên bài trong kết quả tìm kiếm |
| `.result-sub` | Nghệ sĩ / kênh trong kết quả tìm kiếm |
| `.form-inp` | Ô nhập liệu form |
| `.search-inp` | Ô tìm kiếm |
| `.form-btn` | Nút trong form |
| `.dot.on` | Chấm tròn kết nối (khi đã kết nối) |
| `.offline-title` | Tiêu đề overlay offline |

---

## Troubleshooting

| Triệu chứng | Nguyên nhân | Cách xử lý |
|---|---|---|
| Không kết nối được | Sai IP hoặc loa offline | Kiểm tra IP, port 8082/8080 |
| HTTPS không kết nối | Thiếu tunnel | Thêm `tunnel_host` + `speaker_tunnel_host` |
| Overlay "Thiết bị offline" liên tục | Loa tắt hoặc mạng LAN bị chặn | Dùng tunnel hoặc kiểm tra firewall |
| Volume không thay đổi | Speaker WS chưa kết nối | Kiểm tra `speaker_port` hoặc `speaker_tunnel_host` |
| Waveform không hiện | Nhạc chưa phát hoặc `isPlaying = false` | Chắc chắn nhạc đang chạy, không phải pause |
| Phòng broadcast không phát đúng bài | Song Cache chưa có bài | Tìm kiếm bài trước hoặc mở playlist để card load cache |
| Sync lệch tiếng | `sync_resume_delay_ms` quá thấp | Tăng lên 3000–5000ms để buffer đủ |
| Phòng mới tick không tự phát | `sync_send_song: false` | Đặt `sync_send_song: true` trong config |
| card_mod không áp dụng | card-mod chưa cài | Cài card-mod qua HACS |

---

## Changelog

### v7.5 (2026-03-05)
- **Multi-Room Song Sync**: tự động gửi đúng bài (không chỉ lệnh next) sang phòng broadcast khi chuyển bài
- **Song Cache**: lưu bộ nhớ tạm kết quả search + bài trong playlist để phục vụ sync
- **NowPlaying Cache**: cache trạng thái phát hiện tại để gửi ngay khi phòng mới kết nối
- **Zing song_id tracking**: xử lý thiếu `song_id` trong `playback_state` của Zing
- **Stop guard**: tránh server restore lại trạng thái sau khi user nhấn Stop
- **Room Volume Guard**: chống flicker khi broadcast volume đến nhiều phòng
- **Auto-sync settings panel**: chỉnh `auto_sync_delay_ms`, `sync_pause_ms`, `sync_resume_delay_ms` trực tiếp trên UI
- **Collapse card**: tắt toàn bộ WebSocket khi thu gọn, bật lại khi mở rộng
- Thêm nút **+ Thêm vào Playlist** trong kết quả tìm kiếm

---

## License

MIT
