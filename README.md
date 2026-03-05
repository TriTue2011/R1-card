# AI BOX WebUI Card for Home Assistant

[![HACS](https://img.shields.io/badge/HACS-Custom-orange.svg)](https://hacs.xyz/)
![Version](https://img.shields.io/badge/version-6.3.0-blue.svg)

Custom Lovelace card điều khiển toàn diện thiết bị AI BOX (Phicomm R1) ngay trong Home Assistant.

**Card name:** `custom:aibox-webui-card`  
**Hỗ trợ:** LAN (WS) · Cloudflare Tunnel (WSS) · Multi-Room

---

## Tính năng

### ♪ Media
- Phát nhạc YouTube / Zing MP3
- Waveform visualizer 2 kiểu: **Classic** (bars mượt) và **Peak Ball** (thanh đẩy + hình tròn rơi)
- Seek bar, repeat, shuffle
- Tìm kiếm bài hát / playlist
- Quản lý playlist (tạo, xóa, xem danh sách)

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

## Yêu cầu

- Home Assistant với Lovelace
- AI BOX firmware v6.x trên Phicomm R1
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
title: AI BOX
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
| `show_background` | `true` | Hiển thị ảnh nền chat |
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
    ha-card .title-text { color: #1a1a1a !important; } /* Tên card góc trên trái */
    ha-card .conn-label { color: #1a1a1a !important; } /* Chữ WS / LAN bên cạnh dot */
    ha-card .mc-title { color: #1a1a1a !important; }   /* Tên bài hát */
    ha-card .mc-artist { color: #555555 !important; }  /* Tên nghệ sĩ */
    ha-card .time-txt { color: #1a1a1a !important; }   /* Thời gian 0:00 */
    ha-card .vol-icon { color: #1a1a1a !important; }   /* Icon loa 🔊 */
    ha-card .vol-label { color: #1a1a1a !important; }  /* Chữ "Mức 0" */

    /* ═══ TAB CHÍNH (Media / Control / Chat / System) ═══ */
    ha-card .tab { color: #1a1a1a !important; }        /* Tab không chọn */
    ha-card .tab.active {
      color: #1a1a1a !important;                       /* Tab đang chọn - chữ */
      background: rgba(255,107,0,0.12) !important;     /* Tab đang chọn - nền */
      border-color: #FF6B00 !important;                /* Tab đang chọn - viền */
    }

    /* ═══ ROOM PILLS ═══ */
    ha-card .room-pill,
    ha-card .room-pill span { color: #1a1a1a !important; }  /* Room không chọn */
    ha-card .room-pill.active {
      background: rgba(255,107,0,0.15) !important;          /* Room đang chọn - nền */
      border-color: #FF6B00 !important;                     /* Room đang chọn - viền */
      color: #1a1a1a !important;                            /* Room đang chọn - chữ */
    }
    ha-card .room-pill.active span { color: #1a1a1a !important; }

    /* ═══ CONTROL TAB ═══ */
    ha-card .tog-name { color: #1a1a1a !important; }      /* Tên toggle (DLNA, AirPlay...) */
    ha-card .tog-desc { color: #555555 !important; }      /* Mô tả nhỏ dưới toggle */
    ha-card .section-label { color: #FF6B00 !important; } /* Label section (📡 CONTROL...) */
    ha-card .s-name { color: #1a1a1a !important; }        /* Tên slider */
    ha-card .s-val { color: #FF6B00 !important; }         /* Giá trị slider */

    /* ═══ SEARCH TABS (Songs / Playlist / Zing) ═══ */
    ha-card .stab { color: #1a1a1a !important; }           /* Tab không chọn */
    ha-card .stab.active { color: #FF6B00 !important; }    /* Tab đang chọn */

    /* ═══ SUB TABS (Equalizer / Surround, Đèn Chính / Viền) ═══ */
    ha-card .sub-tab { color: #1a1a1a !important; }           /* Sub-tab không chọn */
    ha-card .sub-tab.active { color: #FF6B00 !important; }    /* Sub-tab đang chọn */

    /* ═══ SYSTEM TAB ═══ */
    ha-card .sys-label { color: #888888 !important; }  /* Label nhỏ (CPU, RAM...) */
    ha-card .sys-value { color: #1a1a1a !important; }  /* Giá trị (số %, địa chỉ...) */

    /* ═══ ALARM ═══ */
    ha-card .alarm-time { color: #1a1a1a !important; } /* Giờ báo thức to */
    ha-card .alarm-meta { color: #555555 !important; } /* Mô tả nhỏ (hàng ngày...) */

    /* ═══ SEARCH RESULTS ═══ */
    ha-card .result-title { color: #1a1a1a !important; } /* Tên bài hát kết quả */
    ha-card .result-sub { color: #555555 !important; }   /* Kênh / nghệ sĩ kết quả */

    /* ═══ PLAYLIST ═══ */
    ha-card .pl-name { color: #1a1a1a !important; }  /* Tên playlist */
    ha-card .pl-count { color: #888888 !important; } /* Số bài */

    /* ═══ WIFI ═══ */
    ha-card .wifi-ssid { color: #1a1a1a !important; } /* Tên WiFi */
    ha-card .wifi-rssi { color: #888888 !important; } /* Tín hiệu dBm */

    /* ═══ FORM ═══ */
    ha-card .form-label { color: #555555 !important; } /* Label form (HA URL...) */
    ha-card .search-inp,
    ha-card .form-inp,
    ha-card .chat-inp {
      background: transparent !important;
      border-color: #FF6B00 !important;               /* Viền input */
      color: #1a1a1a !important;                      /* Chữ gõ trong input */
    }

    /* ═══ EQ ═══ */
    ha-card .eq-band-val { color: #FF6B00 !important; }    /* Số dB EQ */
    ha-card .eq-band label { color: #1a1a1a !important; }  /* Label tần số (60Hz...) */

    /* ═══ OFFLINE OVERLAY ═══ */
    ha-card .offline-title { color: #FF4500 !important; } /* Chữ "Thiết bị offline" */
    ha-card .offline-room { color: #1a1a1a !important; }  /* Tên room khi offline */

    /* ═══ DOT KẾT NỐI ═══ */
    ha-card .dot.on {
      background: #FF6B00 !important;                 /* Màu chấm khi đã kết nối */
      box-shadow: 0 0 10px rgba(255,107,0,0.6) !important;
    }

    /* ═══ SOURCE LABEL (IDLE / YOUTUBE / ZING) ═══ */
    ha-card .mc-source {
      background: rgba(255,107,0,0.2) !important;
      border-color: #FF6B00 !important;
      color: #FF6B00 !important;                      /* Màu chữ source */
    }

    /* ═══ NÚT PLAY TO ═══ */
    ha-card .ctrl-btn.play {
      background: linear-gradient(135deg, #FF6B00, #e65c00) !important; /* Nền nút play */
      border-color: #FF6B00 !important;
      box-shadow: 0 4px 20px rgba(255,107,0,0.4) !important;
    }

    /* ═══ WAVEFORM ═══ */
    ha-card .wv-bar {
      background: linear-gradient(to top, rgba(255,107,0,0.6), rgba(255,150,50,0.9)) !important; /* Màu thanh sóng */
    }
    ha-card .wv-ball {
      background: #FF6B00 !important;                 /* Màu ball sóng */
      box-shadow: 0 0 4px rgba(255,107,0,0.8) !important;
    }

    /* ═══ SEEK BAR ═══ */
    ha-card .mc-seek-fill {
      background: linear-gradient(to right, #FF6B00, #ffaa55) !important; /* Màu thanh tiến trình */
    }
    ha-card .mc-seek-thumb {
      background: #FF6B00 !important;                 /* Màu nút kéo seek */
    }

    /* ═══ TOGGLE SWITCH ═══ */
    ha-card .sw.on {
      background: rgba(255,107,0,0.2) !important;     /* Nền switch khi ON */
      border-color: rgba(255,107,0,0.5) !important;
    }
    ha-card .sw.on::after {
      background: #FF6B00 !important;                 /* Màu chấm tròn switch ON */
    }

    /* ═══ SLIDER THUMB ═══ */
    ha-card input[type=range]::-webkit-slider-thumb {
      background: #FF6B00 !important;                 /* Màu nút kéo slider */
      border-color: rgba(255,150,50,0.5) !important;
    }

    /* ═══ BUTTONS ═══ */
    ha-card .search-btn,
    ha-card .form-btn {
      background: rgba(255,107,0,0.2) !important;
      border-color: #FF6B00 !important;
      color: #FF6B00 !important;                      /* Màu nút tìm kiếm / form */
    }
    ha-card .send-btn {
      background: rgba(255,107,0,0.2) !important;
      border-color: rgba(255,107,0,0.4) !important;
      color: #FF6B00 !important;                      /* Màu nút gửi chat */
    }
    ha-card .chat-action-btn {
      border-color: rgba(255,107,0,0.3) !important;
      background: rgba(255,107,0,0.1) !important;
      color: #FF4500 !important;                      /* Màu nút Wake Up / Test Mic / Clear */
    }

    /* ═══ STAT BAR ═══ */
    ha-card .stat-bar.cpu {
      background: linear-gradient(90deg, #FF6B00, #ffaa55) !important; /* Màu bar CPU */
    }
    ha-card .stat-bar.ram {
      background: linear-gradient(90deg, #0891b2, #38bdf8) !important; /* Màu bar RAM */
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
| card_mod không áp dụng | card-mod chưa cài | Cài card-mod qua HACS |

---

## License

MIT
