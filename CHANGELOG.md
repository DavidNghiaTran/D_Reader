# CHANGELOG — D_Reader

Tổng hợp chi tiết toàn bộ các lỗi đã sửa và tính năng đã thêm, theo thứ tự thực hiện.
Mỗi mục ghi rõ: **triệu chứng** người dùng gặp → **nguyên nhân gốc** → **file đã sửa**
→ **cách sửa**. Dùng file này để tra cứu lại lý do một đoạn code được viết như vậy,
hoặc để biết đã từng gặp lỗi tương tự chưa trước khi debug lại từ đầu.

> Các quy tắc/ràng buộc rút ra từ những lần sửa lỗi này đã được ghi đầy đủ vào
> `CLAUDE.md` (dùng cho AI coding agent đọc trước khi sửa code) — file này chỉ ghi lại
> **lịch sử** để tham khảo, còn `CLAUDE.md` mới là nơi giữ **quy tắc bắt buộc**.

---

## Mục lục

1. [Nghe truyện: nội dung nhảy chương liên tục](#1)
2. [Nghe truyện: không chọn được điểm bắt đầu khi bấm vào đoạn văn](#2)
3. [Nghe truyện: lỗi âm thanh khi chuyển sang nghe đoạn khác giữa chừng](#3)
4. [Highlight câu đang đọc bị mờ, không rõ ràng](#4)
5. [Lưu tiến trình đọc chưa chắc chắn, dễ mất khi rời trang](#5)
6. [Thêm giọng đọc FPT.AI (7 giọng mới)](#6)
7. [Giọng FPT.AI đọc sai/lộn xộn, không ra tiếng Việt](#7)
8. [Giọng Google/FPT.AI lỗi âm thanh sau khi nghe liên tục ~30 phút](#8)
9. [Thêm tính năng điều chỉnh âm lượng](#9)
10. [TTS đọc thành lời cả dấu câu (`.` `,` `"` `"`)](#10)
11. [TTS đọc "chấm chấm chấm" với dòng chỉ có dấu ba chấm](#11)
12. [Tích hợp VieNeu-TTS (self-hosted, 25 giọng)](#12)
13. [Khắc phục nhảy vệt highlight và giật khung màn hình khi ấn đúp hoặc đọc tốc độ cao (3.0x)](#13)

---

<a id="1"></a>
## 1. Nghe truyện: nội dung nhảy chương liên tục

**Triệu chứng:** khi bật nghe truyện, nội dung tự động nhảy qua nhiều chương liên
tục, không đọc ổn định một chương nào.

**Nguyên nhân gốc (2 lớp cộng hưởng):**
- `reader.js` cấu hình epub.js với `flow: "scrolled"` — đây **không phải giá trị hợp
  lệ** của epub.js (giá trị đúng chỉ có `"paginated" | "scrolled-doc" |
  "scrolled-continuous" | "auto"`), khiến `rendition.next()/prev()` hoạt động không
  ổn định, không đảm bảo mỗi lần gọi là sang đúng 1 chương.
- Có **2 cơ chế độc lập** cùng cố khởi động lại TTS sau khi chuyển chương: một
  `setTimeout(800ms)` đoán giờ trong `tts-engine.js`, và một `setTimeout(100ms)` khác
  trong sự kiện `relocated` ở `reader.js`. Hai timer đoán giờ tranh nhau reset state,
  có lúc làm mảng câu đọc về rỗng → lập tức kích hoạt chuyển chương tiếp → lặp lại
  liên tục.

**File đã sửa:** `reader.js`, `tts-engine.js`

**Cách sửa:**
- Đổi `flow: "scrolled"` → `flow: "scrolled-doc"` (mỗi chương render riêng, cuộn được
  bên trong, next/prev di chuyển đúng 1 chương).
- Bỏ toàn bộ `setTimeout` đoán giờ, thay bằng **Promise thật** từ `rendition.next()`.
  `Reader.nextPage(fromTts)` giờ trả về Promise, `TTSEngine` `.then()` Promise đó rồi
  mới đọc chương mới — chỉ còn **một luồng điều khiển duy nhất**.
- Thêm phát hiện "hết truyện" (so sánh href trước/sau khi gọi `nextPage()`) để tránh
  lặp vô hạn ở chương cuối.

---

<a id="2"></a>
## 2. Nghe truyện: không chọn được điểm bắt đầu khi bấm vào đoạn văn

**Triệu chứng:** bấm vào bất kỳ vị trí nào trong một đoạn văn, TTS luôn đọc lại từ
**đầu đoạn** thay vì đúng chỗ vừa bấm.

**Nguyên nhân gốc:** một đoạn văn không có định dạng đặc biệt (không in đậm/nghiêng)
thường nằm gọn trong **một** text node DOM duy nhất. Code cũ lấy nguyên
`textNode.nodeValue` (toàn bộ nội dung node đó) làm điểm bắt đầu, bất kể click ở đâu
trong node — nên luôn resolve về đầu đoạn.

**File đã sửa:** `reader.js`

**Cách sửa:** lấy đúng **offset ký tự nơi click** (`range.startOffset` /
`caretPosition.offset`) làm điểm bắt đầu snippet gửi cho TTS, thay vì lấy từ đầu node.

---

<a id="3"></a>
## 3. Nghe truyện: lỗi âm thanh khi chuyển sang nghe đoạn khác giữa chừng

**Triệu chứng:** đang nghe mà bấm sang nghe đoạn khác → âm thanh lỗi, đè lên nhau,
hoặc giọng đọc tự động bị đổi sang giọng máy không rõ lý do.

**Nguyên nhân gốc:** `start()` gọi `stop()` → `audioPlayer.pause()` ngay lúc
`audioPlayer.play()` của câu cũ chưa kịp hoàn tất → trình duyệt reject Promise đó với
`AbortError`. Code cũ hiểu nhầm đây là lỗi mạng thật, tự động đổi
`selectedVoiceUri = ''` (chuyển sang giọng máy) và gọi lại `speakSentenceQueue()` —
**chồng lên** luồng audio mới vừa bấm.

**File đã sửa:** `tts-engine.js`

**Cách sửa:** thêm cơ chế **"playback token"** (`this.playToken`, tăng mỗi lần
`stop()` chạy). Mọi callback bất đồng bộ (`onended`, `onerror`, `play().catch()`, cả
cho giọng máy local) đều chốt token lúc bắt đầu và kiểm tra token còn khớp không
trước khi hành động — callback "cũ" (đã bị `stop()`/`start()` mới ghi đè) sẽ tự bỏ
qua. Đồng thời bỏ qua riêng lỗi `AbortError` (do chính mình chủ động ngắt, không phải
lỗi thật).

---

<a id="4"></a>
## 4. Highlight câu đang đọc bị mờ, không rõ ràng

**Triệu chứng:** highlight câu đang đọc quá mờ, khó nhận biết.

**Nguyên nhân gốc:** mỗi chương EPUB render trong 1 iframe riêng biệt. Style theme
của epub.js (`applyRenditionTheme()`) ép `background`/`color` của mọi `span` về đồng
bộ theme bằng `!important`. Highlight span chỉ set màu bằng inline style **không có
`!important`** → bị luật theme đè mất, chỉ còn hiệu ứng glow rất mờ còn sót lại.

**File đã sửa:** `reader.js`, `tts-engine.js`, `css/app.css`

**Cách sửa:** bơm 1 `<style id="tts-highlight-style">` riêng vào **từng chương** qua
`rendition.hooks.content.register(...)`, định nghĩa `.tts-karaoke-highlight` với toàn
bộ rule màu có `!important` để luôn thắng theme. Nâng cấp hiệu ứng: nền vàng đậm
(`#facc15`) + chữ đậm navy, bo góc, và **hiệu ứng pulse/glow nhấp nháy** quanh câu
đang đọc. `tts-engine.js` giờ chỉ gán `span.className`, không set inline style màu
nữa.

---

<a id="5"></a>
## 5. Lưu tiến trình đọc chưa chắc chắn, dễ mất khi rời trang

**Triệu chứng:** đọc/nghe một lúc rồi rời trang (bấm "Thư viện", đóng tab...) → mở lại
không đúng vị trí vừa dừng.

**Nguyên nhân gốc:** cơ chế lưu cũ dùng debounce **3 giây** — nếu rời trang trước khi
đủ 3 giây, tiến trình mấy giây cuối chưa kịp lưu.

**File đã sửa:** `reader.js`, `index.html`, `css/app.css`

**Cách sửa:** thêm `Reader.flushSaveProgress()` — hủy debounce đang chờ, lưu **ngay
lập tức** — được gọi khi: bấm nút "Thư viện", chuyển tab/khóa màn hình
(`visibilitychange`), đóng tab (`pagehide`). Request lưu luôn kèm `keepalive: true`
để không bị hủy giữa chừng lúc trang đang unload. Thêm chỉ báo nhỏ "✓ Đã lưu" hiện
thoáng qua trên thanh công cụ mỗi lần lưu thành công.

---

<a id="6"></a>
## 6. Thêm giọng đọc FPT.AI (7 giọng mới)

**Yêu cầu:** thêm giọng đọc tiếng Việt miễn phí khác ngoài Google/Edge.

**File mới:** `service/FptAiTtsService.java`
**File đã sửa:** `service/TtsService.java`, `controller/TtsController.java` (gián
tiếp qua TtsService), `tts-engine.js`, `application.yml`

**Cách làm:** tích hợp API `POST https://api.fpt.ai/hmi/tts/v5` — khác Edge/Google,
API này **bất đồng bộ**: gửi text → nhận về 1 URL → phải polling URL đó (có backoff)
cho tới khi file mp3 sẵn sàng (vài giây tuỳ độ dài văn bản). 7 giọng: `banmai, leminh,
thuminh, myan, giahuy, lannhi, linhsan`. Cần API key miễn phí đăng ký tại
console.fpt.ai, cấu hình qua biến môi trường `FPT_TTS_API_KEY`.

---

<a id="7"></a>
## 7. Giọng FPT.AI đọc sai/lộn xộn, không ra tiếng Việt

**Triệu chứng:** chọn giọng FPT.AI, có tiếng phát ra nhưng lộn xộn, không giống tiếng
Việt.

**Nguyên nhân gốc (encoding):** backend gửi đúng byte UTF-8 lên FPT.AI nhưng **không
khai báo rõ `Content-Type` kèm charset**, khiến server dễ hiểu sai bảng mã, đọc sai
dấu tiếng Việt (ký tự đa byte trong UTF-8).

**File đã sửa:** `FptAiTtsService.java`, `application.yml`

**Cách sửa:**
- Thêm header `Content-Type: text/plain; charset=utf-8` khi gửi văn bản lên FPT.AI.
- Ép toàn bộ Spring Boot server dùng UTF-8 tường minh
  (`server.servlet.encoding.force: true`) cho cả request/response, đảm bảo tham số
  `text` nhận từ `@RequestParam` luôn được giải mã đúng ngay từ đầu.

---

<a id="8"></a>
## 8. Giọng Google/FPT.AI lỗi âm thanh sau khi nghe liên tục ~30 phút

**Triệu chứng:** dùng giọng Google, nghe liên tục hơn ~30 phút thì bắt đầu lỗi âm
thanh giống hệt lỗi FPT.AI đã gặp trước đó.

**Nguyên nhân gốc (rate limit):** cả Google Translate TTS lẫn FPT.AI đều là API miễn
phí **không chính thức**. Sau khi gọi quá nhiều lần trong thời gian ngắn (mỗi câu = 1
request, dễ xảy ra khi nghe liên tục), chúng bắt đầu **âm thầm trả về HTTP 200 kèm 1
đoạn audio ngắn/lỗi** thay vì báo lỗi rõ ràng — nghe như lộn xộn dù không có
exception.

**File đã sửa:** `TtsService.java`, `tts-engine.js`

**Cách sửa:**
- Thêm kiểm tra **kích thước audio trả về** so với độ dài văn bản gửi đi — nếu quá
  nhỏ bất thường (dấu hiệu bị giới hạn tần suất), coi là lỗi thật, ném exception thay
  vì âm thầm phát audio hỏng. Có retry 1 lần trước khi báo lỗi hẳn.
- Frontend: khi phải fallback sang giọng máy do lỗi, hiện thông báo rõ ràng ("Giọng
  online bị gián đoạn, có thể do giới hạn tần suất truy cập...") thay vì đổi giọng âm
  thầm không giải thích.

---

<a id="9"></a>
## 9. Thêm tính năng điều chỉnh âm lượng

**Yêu cầu:** thêm thanh trượt điều chỉnh âm lượng khi nghe truyện.

**File mới:** không (chỉ sửa file có sẵn)
**File đã sửa:** `index.html`, `reader.js`, `tts-engine.js`,
`entity/ReaderSetting.java`, `service/SettingService.java`, `schema.sql`

**Cách làm:** thêm thanh trượt `inputTtsVolume` (0–100%) cạnh Tốc độ/Cao độ, áp dụng
trực tiếp qua API chuẩn trình duyệt: `audioPlayer.volume` (giọng online) và
`utterance.volume` (giọng máy local). Lưu vào cột `tts_volume` trong bảng
`reader_settings`, tự khôi phục đúng giá trị mỗi lần mở lại sách qua hàm
`TTSEngine.syncControlsFromSettings()` (hàm này cũng tiện thể vá luôn lỗi có sẵn từ
trước: tốc độ/cao độ trước đây không tự khôi phục khi mở lại sách).

---

<a id="10"></a>
## 10. TTS đọc thành lời cả dấu câu (`.` `,` `"` `"`)

**Triệu chứng:** AI đọc truyện đọc thành lời cả các dấu câu như dấu chấm, phẩy, ngoặc
kép thay vì coi đó là khoảng dừng câu.

**Nguyên nhân gốc (2 lớp):**
1. `EdgeTtsService.escapeXml()` escape thừa dấu `"` → `&quot;` và `'` → `&apos;` khi
   nhúng văn bản vào SSML. Theo chuẩn XML, escape này chỉ cần thiết khi text nằm
   trong **thuộc tính** XML, không cần khi nằm trong **nội dung phần tử** (đúng như
   cách `<speak>...</speak>` đang dùng) — escape thừa khiến Edge nhận nguyên văn chữ
   `&quot;` thay vì ký tự dấu câu, engine SSML có thể đọc nhầm cụm này thành lời.
2. `sanitizeText()` (frontend) chưa xử lý dấu ngoặc kép/nháy kiểu chữ và dấu ba chấm
   Unicode (`…`), để nguyên các cụm dấu câu liền nhau (`."`, `,"` — rất phổ biến khi
   đóng lời thoại) khiến một số giọng "vấp" và đọc sai.

**File đã sửa:** `EdgeTtsService.java`, `tts-engine.js`

**Cách sửa:**
- `escapeXml()`: chỉ escape `&`, `<`, `>` — bỏ escape `"` và `'`.
- `sanitizeText()`: strip hẳn mọi dấu ngoặc kép/nháy kiểu chữ (`" " ' ' „ ‟ « »`),
  chuẩn hoá `…` thành `.`, gộp các cụm dấu câu lặp liền nhau (`!!`, `??`, `,,`) về 1
  dấu — áp dụng cho cả 4 engine vì hàm này chạy trước khi gửi text đi bất kể chọn
  giọng nào.

---

<a id="11"></a>
## 11. TTS đọc "chấm chấm chấm" với dòng chỉ có dấu ba chấm

**Triệu chứng:** sau khi sửa mục 10, vẫn còn trường hợp TTS đọc "chấm chấm chấm" với
những dòng thoại chỉ có `"..."` (thể hiện sự im lặng — rất phổ biến trong truyện).

**Nguyên nhân gốc:** khác lỗi ở mục 10 — đây là do một "câu" sau khi làm sạch **không
còn chữ/số nào**, chỉ còn thuần dấu câu. TTS không có ngữ cảnh câu để hiểu đó là
khoảng lặng cần bỏ qua, nên đọc luôn tên từng ký tự.

**File đã sửa:** `tts-engine.js`

**Cách sửa:** lọc bỏ hẳn những "câu" không chứa chữ/số nào (regex
`/[\p{L}\p{N}]/u`), không gửi cho bất kỳ engine TTS nào. Áp dụng ở **2 lớp**: khi xây
mảng `this.sentences` (filter ngay khi tạo danh sách câu), và lại một lần nữa ngay
đầu `speakSentenceQueue()` làm lưới an toàn dự phòng.

---

<a id="12"></a>
## 12. Tích hợp VieNeu-TTS (self-hosted, 25 giọng)

**Yêu cầu:** tích hợp VieNeu-TTS — một engine TTS tiếng Việt mã nguồn mở, tự host
(chạy trên chính máy người dùng), không giới hạn tần suất, 25 giọng đọc.

**File mới:** `service/VieNeuTtsService.java`
**File đã sửa:** `TtsService.java`, `TtsController.java`, `tts-engine.js`,
`application.yml`

**Điểm khác biệt so với 3 engine kia:**
- **Không có rate-limit** (chạy local) nhưng **phải có server VieNeu đang chạy sẵn**
  ở `vieneu.tts.base-url` (mặc định `http://localhost:8000`) — server này khởi động
  **hoàn toàn tách biệt** với D_Reader
  (`docker compose --profile api-cpu up` hoặc `uv run python -m apps.openai_speech`
  trong chính repo VieNeu-TTS).
- 25 giọng dùng **tên đầy đủ có dấu + khoảng trắng** làm định danh trực tiếp (ví dụ
  `"Minh Quân Pro"`, `"Thái Sơn"`) — khác mã ngắn ASCII của FPT.AI, nên frontend bắt
  buộc phải `encodeURIComponent()` khi gắn vào query string.
- Trả về file **WAV**, không phải MP3 như 3 engine kia — `TtsController` set
  `Content-Type: audio/wav` riêng cho các giọng thuộc `VieNeuTtsService.SUPPORTED_VOICES`.
- Chạy CPU có thể mất vài giây/câu (RTF ~0.5–0.6 theo benchmark chính thức) —
  `VieNeuTtsService` đặt `readTimeout` dài hơn hẳn (30s) so với 3 engine còn lại, và
  bắt riêng lỗi kết nối để báo rõ "hãy chắc chắn đã bật server" nếu người dùng quên
  bật server VieNeu trước khi dùng.

<a id="13"></a>
## 13. Khắc phục nhảy vệt highlight và giật khung màn hình khi ấn đúp hoặc đọc tốc độ cao (3.0x)

**Triệu chứng:** Khi double-click vào đoạn văn để nghe hoặc khi chỉnh tốc độ đọc cao (ví dụ 3.0x), vệt sáng highlight bị giật nhảy liên tục, màn hình cuộn lên xuống thất thường.

**Nguyên nhân gốc (3 nguyên nhân cộng hưởng):**
- **Race Condition do Double-click:** Click đúp bắn ra 2 sự kiện click trong ~100ms kích hoạt 2 luồng `start()` chạy song song, tranh chấp highlight và phát audio.
- **Phân mảnh TextNode (TextNode Fragmentation):** Việc chèn và tháo thẻ `<span class="tts-karaoke-highlight">` làm băm nhỏ TextNode thành nhiều mảnh rời rạc mà không gọi `parent.normalize()`, khiến `range.startOffset` tính sai vị trí ký tự khi click lại vào đoạn văn.
- **Xung đột cuộn `scrollIntoView` & ResizeObserver ở tốc độ cao:** Ở tốc độ đọc >= 2.0x, các câu ngắn phát trong 0.2 - 0.4s làm các hiệu ứng cuộn smooth chồng chéo; đồng thời highlight có padding/bolding làm rớt chữ khiến `ResizeObserver` của epub.js tái tính toán kích thước (reframe) làm giật khung nhìn.

**Cách sửa (4 bước dứt điểm):**
1. **Chuẩn hóa DOM (`normalize()`):** Hàm `clearHighlight(doc)` trong `tts-engine.js` bóc thẻ span highlight và gọi `parent.normalize()` gộp các TextNode bị cắt rời thành nguyên vẹn.
2. **Chống trùng lặp click đúp & làm sạch Selection (`reader.js`):** Thêm bộ lọc debounce 220ms, xóa sạch vùng bôi đen của double-click (`removeAllRanges()`), gọi `clearHighlight(doc)` trước khi đo tọa độ ký tự qua `handleParagraphClickToSpeak`.
3. **Khóa `playToken` & hủy fetch treo bằng `AbortController` (`tts-engine.js`):** Tăng `this.playToken` ngay đầu hàm `stop()`, hủy request tải mạng qua `AbortController.abort()`, dọn dẹp các timer đang chờ.
4. **Cuộn vùng an toàn (`scrollToHighlightSafely`):** Chỉ cuộn khi câu đọc vượt quá vùng an toàn (15% trên - 72% dưới), dùng cuộn tức thì (`auto`) khi tốc độ đọc >= 2.0x; dùng CSS `font-weight: inherit !important;` và `box-shadow` thay vì padding để không chiếm diện tích layout.

---

## Bug đã từng gặp trước đó do quên bước này (rất hay lặp lại)

Mỗi khi sửa file JS/CSS trong `static/`, **luôn bump số version** trong các thẻ
`<script src="...?v=XX">` / `<link href="...?v=XX">` ở cuối `index.html`, nếu không
trình duyệt có thể dùng bản cache cũ và khiến bạn tưởng lỗi chưa được sửa dù code đã
đúng. Phiên bản hiện tại: `v=26`.
