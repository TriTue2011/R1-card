# Phicomm R1 cho Home Assistant

[![HACS](https://img.shields.io/badge/HACS-Custom-orange.svg)](https://hacs.xyz/)

Integration + Custom Card cho Home Assistant, điều khiển toàn diện thiết bị Phicomm R1 (AI BOX).

**Không cần bridge, không cần tunnel domain** — HA kết nối trực tiếp đến R1 qua WebSocket native.

---

## 1. Cài đặt qua HACS

1. HACS -> **Custom repositories**
2. Add: `https://github.com/TriTue2011/R1-card` — Category: **Integration**
3. Tìm và cài **Phicomm R1**
4. Restart Home Assistant

## 2. Cấu hình integration

Vào **Settings -> Devices & Services -> Add Integration** rồi tìm **Phicomm R1**.

Thiết lập khuyến nghị:

- `Tên`: `Phicomm R1`
- `Host`: IP của loa
- `Cổng`: `8080`
- `Cổng WS media (YouTube/Zing)`: `8082`
- `Chu kỳ cập nhật`: `15`
- `Dùng /media-dispatch để điều khiển phát`: bật
- `Chế độ giao thức`: `auto`

Gợi ý chọn giao thức:

- `auto`: nên dùng cho lần cài đầu tiên
- `ws_native`: dùng khi muốn ưu tiên kết nối native (khuyến nghị)
- `http_bridge`: chỉ dùng nếu bạn biết chắc mình đang dùng bridge cũ

## 3. Cài đặt Card UI

Download file `phicomm-r1-card.js` từ thư mục `www/phicomm_r1/` và copy vào `config/www/phicomm_r1/`

Sau đó vào **Settings -> Dashboards -> Resources -> Add resource**:
- URL nhập: `/local/phicomm_r1/phicomm-r1-card.js`
- Resource type: **JavaScript module** -> Save

## 4. Tạo card trên Lovelace

Sử dụng cấu hình sau:

```yaml
type: custom:phicomm-r1-card
entity: media_player.phicomm_r1
title: Phicomm R1
```

Nếu entity của bạn có tên khác thì thay `media_player.phicomm_r1` bằng đúng entity đang dùng trong Home Assistant.

Bạn cũng có thể dùng thêm option `max_height` để giới hạn chiều cao của card:

```yaml
type: custom:phicomm-r1-card
entity: media_player.phicomm_r1
title: Phicomm R1
max_height: 500px
```

---

## Tính năng

### Media
- Phát nhạc YouTube / Zing MP3
- Seek bar, repeat, shuffle
- Tìm kiếm bài hát / playlist (YouTube, Zing MP3)
- Quản lý playlist: tạo, xóa, xem danh sách, thêm/xóa bài

### Control
- Wake Word — bật/tắt + chỉnh độ nhạy
- TTS tiếng Việt (Chống Điếc AI)
- DLNA / AirPlay / Bluetooth toggle
- LED RGB + đèn viền Edge
- Audio Engine: EQ 5 băng tần, presets, Bass Boost, Loudness
- Báo thức nâng cao

### Chat
- Gửi text và nhận phản hồi AI
- Wake Up / Test Mic
- Lịch sử chat

### System
- CPU / RAM realtime
- Reboot
- Thông tin thiết bị

---

## So sánh với phiên bản cũ (standalone card)

| | Phiên bản cũ | Phiên bản mới |
|---|---|---|
| Kiến trúc | Card JS kết nối WebSocket trực tiếp | HA Integration + Card |
| Bridge | Cần tunnel/domain khi HTTPS | Không cần |
| Kết nối | Browser -> R1 | HA Server -> R1 |
| Multi-room | Quản lý trong card | Thêm nhiều integration entry |
| Cấu hình | YAML trong card | Config flow UI |

---

## Troubleshooting

| Triệu chứng | Nguyên nhân | Cách xử lý |
|---|---|---|
| Không kết nối được | Sai IP hoặc loa offline | Kiểm tra IP, port 8080/8082 |
| Entity unavailable | Integration chưa kết nối | Kiểm tra giao thức, thử `ws_native` |
| Card không hiển thị | Chưa add resource | Thêm resource JS trong Dashboard settings |

---

## License

MIT
