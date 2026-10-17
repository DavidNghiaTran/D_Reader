# CLAUDE.md — Quy tắc & Đặc tả dự án D_Reader

> File này dành cho AI coding agent (Claude Code, Cursor, Copilot, v.v.) đọc trước khi
> thực hiện bất kỳ thay đổi nào trong dự án. Mục tiêu: giúp AI hiểu đúng kiến trúc,
> tránh lặp lại các lỗi đã từng xảy ra, và tuân thủ quy ước code hiện có.
>
> **Luôn đọc file này trước khi sửa code.** Nếu có xung đột giữa yêu cầu của người
> dùng và các ràng buộc trong file này, hãy hỏi lại thay vì tự ý phá vỡ kiến trúc.

---

## 1. Tổng quan dự án

- **Tên:** D_Reader — Desktop EPUB Reader & Speech Synthesizer
- **Loại ứng dụng:** Web app cá nhân, chạy **local/single-user trên localhost**, không
  deploy public, không có hệ thống nhiều người dùng, không có đăng nhập.
- **Đối tượng dùng:** một người, đọc truyện/sách `.epub` tiếng Việt, có tính năng
  đọc-thành-tiếng (TTS) tự động chuyển chương.
- **Vì là app cá nhân local**, KHÔNG cần thêm Spring Security/JWT/OAuth trừ khi người
  dùng yêu cầu rõ ràng — nhưng vẫn cần vệ sinh input cơ bản (path traversal, giới hạn
  kích thước request...).

---

## 2. Ngăn xếp công nghệ (Tech Stack)

| Thành phần | Công nghệ |
|---|---|
| Backend | Java 17, Spring Boot 3.2.3 (Web, Data JPA), Lombok |
| Database | MySQL (local, port 3306, database `d_reader_db`) |
| Frontend | HTML/CSS/JS thuần (KHÔNG dùng framework — không React/Vue), ES6+ |
| Đọc EPUB | thư viện `epub.js` 0.3.93 (qua CDN + bản local dự phòng trong `lib/`) |
| Giải nén EPUB | `jszip.min.js` (client) + `java.util.zip.ZipFile` (server) |
| TTS Engine 1 | Google Translate TTS (endpoint không chính thức, miễn phí) |
| TTS Engine 2 | Microsoft Edge TTS (`vi-VN-HoaiMyNeural`, `vi-VN-NamMinhNeural`) qua WebSocket không chính thức |
| TTS Engine 3 (fallback) | Web Speech API trình duyệt (`window.speechSynthesis`) |
| Icon | RemixIcon (CDN) |

**Không tự ý thêm framework frontend (React/Vue/Angular) hay đổi sang TypeScript** trừ
khi người dùng yêu cầu rõ ràng — toàn bộ frontend hiện tại là vanilla JS object-literal
pattern (`const XYZ = { ... }`), phải giữ nhất quán phong cách này khi thêm code mới.

---

## 3. Sơ đồ kiến trúc & vai trò từng file

### Backend (`src/main/java/com/dreader/`)

```
controller/
  BookController      -> upload/list/get/delete sách, serve file .epub và cover ảnh
  ProgressController   -> GET/PUT vị trí đọc dở (CFI) theo bookId
  SettingController     -> GET/PUT cài đặt hiển thị + giọng đọc (bảng đơn dòng, id=1)
  TtsController         -> GET /api/tts?text=...&voice=...&lang=... trả về audio/mpeg
  HealthController      -> kiểm tra DB + storage còn sống không

service/
  BookService       -> logic upload (hash SHA-256 chống trùng), CRUD sách
  StorageService    -> lưu/xoá file vật lý trong ./storage/books, ./storage/covers
  TtsService         -> điều phối: chọn Edge TTS hay Google TTS theo tham số voice,
                        tự chia nhỏ văn bản dài cho Google TTS (giới hạn ký tự)
  EdgeTtsService     -> gọi WebSocket không chính thức của Microsoft Edge Read Aloud
  ProgressService    -> CRUD tiến độ đọc
  SettingService     -> CRUD cài đặt (luôn chỉ có 1 dòng, id cố định = 1)

util/
  EpubParser         -> đọc file .epub bằng ZipFile + DOM XML, trích: title, author,
                        description, language, publisher, isbn, cover image, số chương

entity/  -> Book, ReadingProgress, ReaderSetting (JPA entity, map thẳng theo schema.sql)
dto/     -> BookDto, ProgressRequest (KHÔNG expose entity JPA trực tiếp ra API — đã
            có convertToDto() trong BookService, PHẢI giữ pattern này khi thêm entity mới)
repository/ -> Spring Data JPA interfaces, không có custom @Query phức tạp hiện tại
```

### Frontend (`src/main/resources/static/`)

```
index.html      -> toàn bộ UI (SPA đơn trang, không router, chuyển view bằng show/hide class)
js/app.js        -> App object: điều phối chuyển đổi giữa libraryView <-> readerView
js/library.js    -> Library object: danh sách sách, upload (drag&drop), search, xoá sách
js/reader.js      -> Reader object: khởi tạo epub.js, điều hướng trang/chương, theme,
                     font, lưu tiến độ đọc, sự kiện click-to-read, sự kiện relocated
js/tts-engine.js  -> TTSEngine object (alias `TTS`): toàn bộ logic phát/dừng/tạm dừng
                     TTS, tách câu, highlight karaoke, tự động chuyển chương khi đọc hết
js/lib/           -> bản local dự phòng của epub.js/jszip (KHÔNG sửa file trong này)
```

> ⚠️ **KHÔNG tạo lại file `tts.js`.** Trước đây tồn tại 2 bản TTS song song
> (`tts.js` cũ không được `index.html` nạp, và `tts-engine.js` là bản thật đang chạy).
> Việc có 2 bản gần giống nhau từng gây nhầm lẫn nghiêm trọng khi debug. **Chỉ có
> `tts-engine.js` là nguồn sự thật duy nhất cho logic TTS.** Nếu cần refactor lớn,
> sửa trực tiếp trong file này, không tạo file mới song song.

---

## 4. Luồng dữ liệu quan trọng — PHẢI hiểu trước khi sửa TTS/Reader

### 4.1. epub.js flow config — KHÔNG ĐƯỢC đổi tuỳ tiện
Trong `reader.js`, hàm `loadBook()`:
```js
this.rendition = this.bookData.renderTo("viewer", {
    manager: "default",
    flow: "scrolled-doc",   // BẮT BUỘC — xem lý do bên dưới
    width: "100%",
    height: "100%"
});
```
- Giá trị `flow` hợp lệ của epub.js CHỈ có: `"paginated" | "scrolled-doc" |
  "scrolled-continuous" | "auto"`. **Tuyệt đối không dùng `"scrolled"`** (giá trị này
  không hợp lệ — từng gây lỗi next()/prev() nhảy sai chương liên tục).
- `"scrolled-doc"` được chọn có chủ đích: mỗi chương (spine section) được render
  riêng biệt, cuộn được bên trong, và `rendition.next()/prev()` di chuyển **đúng 1
  chương mỗi lần gọi**. Toàn bộ logic TTS (`extractCurrentPageText`,
  `speakSentenceQueue` tự động next chương...) đều giả định "1 page = 1 chương". Nếu
  đổi sang `"paginated"` hay flow khác, PHẢI viết lại toàn bộ logic TTS tương ứng.

### 4.2. Cơ chế tự động chuyển chương khi TTS đọc hết — một nguồn sự thật duy nhất
- Khi `TTSEngine.speakSentenceQueue()` đọc hết mảng `sentences` của chương hiện tại,
  nó gọi `Reader.nextPage(true)` — hàm này trả về **Promise thật** lấy từ
  `rendition.next()` (không dùng `setTimeout` đoán giờ).
- `TTSEngine` `await`/`.then()` Promise đó rồi **mới** gọi `this.start()` để đọc
  chương mới. Đây là nơi DUY NHẤT quyết định "đọc xong chương → sang chương mới → đọc
  tiếp".
- Sự kiện `rendition.on("relocated", ...)` trong `reader.js` **chỉ** dùng để khởi
  động lại TTS khi người dùng **tự tay** chuyển chương (bấm nút prev/next, phím mũi
  tên, click mục lục) trong khi TTS đang bật — được phân biệt bằng cờ
  `Reader.isTtsNavigating`.
- **QUY TẮC:** không được thêm bất kỳ `setTimeout(...)` mang tính "đoán thời gian
  navigation xong chưa" ở bất cứ đâu trong luồng TTS ↔ chuyển chương. Luôn dùng
  Promise trả về từ epub.js (`rendition.next()`, `rendition.prev()`,
  `rendition.display()` đều trả Promise). Lý do: trước đây có 2 timer độc lập
  (`setTimeout` 800ms trong TTS + `setTimeout` 100ms trong `relocated`) tranh nhau
  reset state, gây lỗi "nhảy chương liên tục" rất khó tái hiện và khó debug.

### 4.3. Click-to-read (bấm vào đoạn văn để nghe từ đó)
- Phải lấy **đúng offset ký tự nơi click** (`range.startOffset` /
  `caretPosition.offset`), KHÔNG được lấy nguyên `textNode.nodeValue` từ đầu node.
  Một đoạn văn không có định dạng in đậm/nghiêng thường nằm gọn trong 1 text node duy
  nhất — nếu lấy nguyên node, bấm vào đâu trong đoạn cũng luôn trả về y hệt toàn bộ
  đoạn, khiến TTS luôn đọc lại từ câu đầu đoạn bất kể vị trí click.
- Xem implementation hiện tại trong `reader.js` (sự kiện `rendition.on("click", ...)`)
  làm mẫu khi cần sửa.

### 4.4. Playback token — bắt buộc khi thêm/sửa bất kỳ callback audio nào
`TTSEngine.playToken` là 1 số nguyên tăng dần mỗi lần `stop()` chạy. Mọi callback bất
đồng bộ liên quan tới phát âm thanh (`audioPlayer.onended`, `audioPlayer.onerror`,
`audioPlayer.play().catch()`, `utterance.onend`, `utterance.onerror`) PHẢI chốt
`const myToken = this.playToken` ngay khi `speakSentenceQueue()` bắt đầu, và kiểm tra
`if (myToken !== this.playToken) return;` ở đầu callback trước khi làm bất cứ điều gì.

Lý do: khi người dùng bấm sang nghe đoạn khác trong lúc đang phát, `start()` gọi
`stop()` → `audioPlayer.pause()` trong lúc `play()` của câu cũ chưa kịp resolve →
trình duyệt reject Promise đó bằng `AbortError`. Nếu không có cơ chế token, callback
`.catch()` của Promise **cũ** này vẫn chạy, hiểu nhầm là lỗi thật, tự động đổi
`selectedVoiceUri` sang giọng máy local và gọi `speakSentenceQueue()` chồng lên luồng
audio **mới** vừa bấm → sinh ra âm thanh lỗi/đè lên nhau/im bặt. Ngoài token, cũng
phải luôn bỏ qua `err.name === 'AbortError'` trong `.catch()` của `play()` — đó là
kết quả của việc TỰ mình ngắt phát audio (chủ động, không phải lỗi mạng/lỗi thật).

### 4.6. Highlight câu đang đọc — phải style qua stylesheet injected vào iframe, KHÔNG dùng inline style thường
Mỗi chương EPUB render trong 1 iframe riêng với DOM/document riêng biệt — CSS của
trang chính (`app.css`, biến `:root { --tts-highlight-bg... }`) **không** lan vào được
iframe đó. Đồng thời `applyRenditionTheme()` đăng ký 1 theme epub.js ép
`background/color` của mọi `span/p/div` về giá trị đồng bộ theme bằng `!important` —
nếu style highlight chỉ set qua `span.style.xxx = ...` (không có `!important`) thì sẽ
bị luật theme đó đè mất, chỉ còn hiệu ứng rất mờ.

**Quy tắc:** style cho `.tts-karaoke-highlight` phải nằm trong `<style>` được
`Reader` bơm vào head của iframe qua `rendition.hooks.content.register(...)` (xem
`loadBook()` trong `reader.js`), và mọi rule màu sắc trong đó PHẢI có `!important`.
`tts-engine.js` chỉ cần gán `span.className = 'tts-karaoke-highlight'`, không set
inline style màu sắc nữa.

### 4.7. Lưu tiến trình đọc — luôn "flush" ngay khi có khả năng rời trang
`Reader.debouncedSaveProgress()` (delay 3s) chỉ dùng cho lưu định kỳ trong lúc đang
đọc. Bất kỳ nơi nào người dùng CÓ THỂ rời khỏi trang đọc (bấm nút quay lại thư viện,
đổi tab, đóng tab/trình duyệt, load lại trang) đều phải gọi
`Reader.flushSaveProgress()` (hủy debounce đang chờ + lưu ngay lập tức) thay vì để
debounce tự chạy — nếu không, vài giây đọc cuối cùng trước khi rời trang có thể bị
mất. Xem `bindUnloadSafety()` (lắng nghe `visibilitychange` + `pagehide`) và handler
của `btnBackToLibrary` trong `reader.js` làm mẫu. `saveProgress()` luôn gọi fetch với
`keepalive: true` để request không bị hủy giữa chừng khi trang đang unload.

### 4.8. 4 engine TTS và cách chọn
```
selectedVoiceUri === 'vi-VN-HoaiMyNeural' | 'vi-VN-NamMinhNeural'  -> Edge TTS (qua /api/tts, backend gọi WebSocket)
selectedVoiceUri === 'google-vi-online'                             -> Google Translate TTS (qua /api/tts)
selectedVoiceUri thuộc TTSEngine.fptVoiceCodes                      -> FPT.AI TTS (qua /api/tts, backend gọi REST + polling)
selectedVoiceUri thuộc TTSEngine.vieneuVoices                       -> VieNeu-TTS (qua /api/tts, backend gọi server tự host)
selectedVoiceUri === bất kỳ giá trị nào khác (voiceURI của trình duyệt) -> Web Speech API (client-side, KHÔNG gọi backend)
```
Khi thêm giọng đọc mới, phải cập nhật đồng bộ ở **cả 2 nơi**: `loadVoices()` trong
`tts-engine.js` (danh sách hiển thị) VÀ điều kiện rẽ nhánh (`TtsService.java` ở
backend, `TTSEngine.isCloudVoice()` ở frontend).

### 4.9. FPT.AI TTS — engine bất đồng bộ, khác hẳn Edge/Google
`FptAiTtsService.java` gọi API `POST https://api.fpt.ai/hmi/tts/v5`. **Khác với
Edge/Google TTS**, API này KHÔNG trả audio ngay trong response — nó trả về 1 URL
(`async`) rồi cần polling URL đó cho tới khi file mp3 tồn tại (có thể mất vài giây
đến vài chục giây tuỳ độ dài văn bản, theo tài liệu chính thức của FPT.AI có thể lên
tới ~2 phút với văn bản rất dài). `FptAiTtsService.pollForAudio()` xử lý việc chờ này
bằng backoff cố định — **không được xoá cơ chế polling này** khi refactor, nếu không
audio trả về sẽ luôn rỗng/404.

- 7 giọng hỗ trợ: `banmai, leminh, thuminh, myan, giahuy, lannhi, linhsan`
  (`FptAiTtsService.SUPPORTED_VOICES`).
- Cần API key miễn phí đăng ký tại https://console.fpt.ai (sản phẩm "Text to Speech"),
  đặt vào biến môi trường `FPT_TTS_API_KEY` hoặc trực tiếp `application.yml` mục
  `fpt.tts.api-key`. Nếu chưa cấu hình, `FptAiTtsService.isConfigured()` trả `false`
  và backend ném lỗi rõ ràng bằng tiếng Việt thay vì lỗi khó hiểu.
- Vì API này chậm hơn Edge/Google đáng kể (không trả về tức thì), đây là ứng viên số 1
  hưởng lợi từ mục "Cache audio TTS theo hash văn bản" đã liệt kê trong Backlog (§8) —
  nên ưu tiên làm cache trước khi khuyến khích người dùng dùng giọng FPT.AI cho việc
  đọc liên tục cả cuốn sách.
- **Encoding UTF-8 là điểm dễ vỡ nhất với engine này**: request lên FPT.AI PHẢI có
  header `Content-Type: text/plain; charset=utf-8` tường minh, nếu không dễ bị đọc sai
  dấu tiếng Việt (nghe như ngôn ngữ khác/lộn xộn dù không báo lỗi). `application.yml`
  cũng đã ép `server.servlet.encoding.force: true` để đảm bảo tham số `text` nhận từ
  `@RequestParam` luôn được Spring giải mã bằng UTF-8, loại trừ khả năng bị hỏng dấu
  ngay từ bước đọc request. Nếu sau này lỗi "đọc sai/lộn xộn" tái diễn dù text hiển thị
  đúng trên UI, khả năng cao là do phía server FPT.AI (giới hạn gói miễn phí, hoặc
  voice chưa được kích hoạt cho tài khoản) chứ không phải lỗi encoding trong code —

### 4.10. Google TTS/FPT.AI đều là API miễn phí KHÔNG chính thức — dễ bị giới hạn tần suất khi đọc liên tục lâu
`translate.google.com/translate_tts` không phải API công khai chính thức của Google —
sau khi gọi quá nhiều lần trong thời gian ngắn (dễ xảy ra khi nghe liên tục ~30 phút
trở lên, mỗi câu là 1 request riêng), nó có xu hướng **âm thầm trả về HTTP 200 kèm 1
đoạn audio ngắn/lỗi** thay vì báo lỗi rõ ràng — nghe như "đọc sai/lộn xộn, không ra
tiếng Việt" dù không có exception nào. `TtsService.fetchTtsAudioChunkOnce()` đã thêm
kiểm tra kích thước audio trả về (ước lượng tối thiểu dựa theo độ dài văn bản) để phát
hiện và coi các phản hồi bất thường này là lỗi thật (ném exception) thay vì phát ra
audio hỏng cho người dùng nghe. Có retry 1 lần trước khi báo lỗi hẳn.

**Quy tắc khi thêm/sửa bất kỳ engine TTS online nào (kể cả sau này thêm engine mới):**
không được coi "HTTP 200" là đủ điều kiện thành công — luôn kiểm tra thêm kích thước/
tính hợp lệ của dữ liệu audio trả về trước khi coi là thành công, vì các API miễn phí
không chính thức có thể trả về phản hồi "giả thành công" khi bị giới hạn.

### 4.11. Điều khiển âm lượng TTS
`Reader.settings.ttsVolume` (0.0–1.0, mặc định 1.0) lưu ở cột `tts_volume` trong bảng
`reader_settings`. Áp dụng trực tiếp qua API chuẩn của trình duyệt — không cần xử lý
DSP thủ công: `audioPlayer.volume` (HTML5 Audio, dùng cho Edge/Google/FPT.AI qua
`/api/tts`) và `utterance.volume` (SpeechSynthesisUtterance, dùng cho giọng máy local).
Lưu ý: `SpeechSynthesisUtterance.volume` chỉ có hiệu lực khi utterance được TẠO MỚI —
đổi âm lượng giữa chừng lúc giọng máy đang đọc 1 câu sẽ không có tác dụng ngay, chỉ áp
dụng từ câu tiếp theo (khác với `audioPlayer.volume` áp dụng tức thì kể cả đang phát).
`TTSEngine.syncControlsFromSettings()` đồng bộ cả 3 thanh trượt (tốc độ/cao độ/âm
lượng) với cài đặt đã lưu mỗi khi mở sách — nếu thêm thanh trượt TTS mới, nhớ cập nhật
hàm này để tránh nó bị reset về mặc định HTML mỗi lần mở lại sách.

### 4.12. Lỗi TTS đọc thành lời cả dấu câu (`.` `,` `"` `"`) — 2 nguyên nhân đã xử lý
1. **`EdgeTtsService.escapeXml()` từng escape thừa dấu `"` và `'` thành `&quot;`/
   `&apos;`** khi nhúng text vào SSML — về chuẩn XML, escape này chỉ cần thiết khi text
   nằm trong THUỘC TÍNH XML, không cần khi nằm trong NỘI DUNG PHẦN TỬ (đúng như cách
   `<speak>...</speak>` đang dùng). Việc escape thừa khiến chuỗi gửi cho Edge chứa
   nguyên văn `&quot;`/`&apos;` thay vì ký tự dấu câu, engine SSML có thể đọc nhầm cụm
   này thành lời. **Đã sửa: chỉ escape `&`, `<`, `>`.** Nếu sau này thêm text vào SSML
   ở chỗ khác, PHẢI nhớ quy tắc này — không escape quote trừ khi text nằm trong thuộc
   tính XML thật sự.
2. **`TTSEngine.sanitizeText()` (frontend) đã strip hẳn mọi loại dấu ngoặc kép/nháy
   kiểu chữ** (`" " ' ' „ ‟ « »` — giữ lại dấu `'` thẳng vì có thể là dấu nháy đơn
   trong tên riêng nước ngoài), chuẩn hoá dấu `…` (1 ký tự) thành `.`, và gộp các cụm
   dấu câu lặp liền nhau (`!!`, `??`, `,,`...) về 1 dấu duy nhất — áp dụng cho **cả 4
   engine** vì hàm này chạy trước khi text được gửi đi bất kể chọn giọng nào. Đây là
   bước tiền xử lý bắt buộc phải giữ nguyên khi thêm engine TTS mới — không được bỏ
   qua `sanitizeText()` cho bất kỳ engine nào.
3. **"Câu" chỉ toàn dấu câu (không có chữ/số nào) không được gửi cho TTS** — ví dụ
   dòng thoại chỉ có `"..."` để thể hiện im lặng (rất phổ biến trong truyện). Khi TTS
   nhận một đoạn không có từ nào, nó không có ngữ cảnh câu để hiểu đó là khoảng lặng
   và đọc luôn tên từng ký tự (`"..."` → "chấm chấm chấm"). Việc lọc này áp dụng ở
   **2 lớp**: khi xây mảng `TTSEngine.sentences` (dùng
   `.filter(s => /[\p{L}\p{N}]/u.test(s.clean))`) VÀ lại một lần nữa ngay đầu
   `speakSentenceQueue()` làm lưới an toàn dự phòng. Khi sửa logic chia câu/lọc câu
   sau này, PHẢI giữ nguyên tối thiểu 1 trong 2 lớp lọc này.

### 4.13. VieNeu-TTS — engine tự host (self-hosted), khác hẳn 3 engine còn lại
`VieNeuTtsService.java` gọi tới **1 server TTS chạy trên chính máy người dùng**
(https://github.com/pnnbao97/VieNeu-TTS), qua endpoint chuẩn OpenAI-compatible
`POST /v1/audio/speech`. Đây là điểm khác biệt CĂN BẢN so với Edge/Google/FPT.AI:

- **Không có rate-limit** (chạy local), nhưng **PHẢI có server VieNeu đang chạy sẵn**
  ở địa chỉ `vieneu.tts.base-url` (mặc định `http://localhost:8000`, cấu hình qua biến
  môi trường `VIENEU_TTS_URL`) — server này khởi động HOÀN TOÀN TÁCH BIỆT với D_Reader
  (`docker compose -f docker/docker-compose.yml --profile api-cpu up` hoặc
  `uv run python -m apps.openai_speech`, chạy trong chính repo VieNeu-TTS, không phải
  repo D_Reader). Nếu quên bật server này, mọi request sẽ lỗi kết nối — 
  `VieNeuTtsService` đã bắt riêng `ConnectException`/`SocketTimeoutException` để trả
  thông báo tiếng Việt rõ ràng ("hãy chắc chắn đã chạy...") thay vì lỗi khó hiểu.
- **25 giọng** với tên đầy đủ có dấu + khoảng trắng làm định danh trực tiếp (khác
  FPT.AI dùng mã ngắn không dấu) — ví dụ `"Minh Quân Pro"`, `"Thái Sơn"`. Vì vậy khi
  gắn vào query string ở frontend **bắt buộc phải `encodeURIComponent()`**, không như
  mã giọng Edge/FPT.AI vốn thuần ASCII không cần encode.
- **Trả về file WAV**, không phải MP3 như 3 engine kia — `TtsController` phải set
  `Content-Type: audio/wav` riêng cho các giọng thuộc
  `VieNeuTtsService.SUPPORTED_VOICES`, nếu không trình duyệt nhận sai định dạng.
- Chạy CPU có thể mất vài giây/câu (theo benchmark chính thức của dự án, RTF ~0.5–0.6)
  — `VieNeuTtsService` đặt `readTimeout` dài hơn hẳn (30s) so với 3 engine còn lại.
  Đây cũng là ứng viên hưởng lợi nhiều nhất từ mục "cache audio TTS theo hash văn bản"
  trong Backlog (§8) nếu máy chạy CPU (không GPU).


  nên khuyên người dùng test trực tiếp bằng `curl` (xem ví dụ trong docs FPT.AI) để
  loại trừ nguyên nhân code trước khi tiếp tục debug backend.

---

## 5. Database Schema (tham chiếu nhanh — file gốc: `schema.sql`)

```sql
books (id, title, author, description, language, publisher, isbn, file_path,
       cover_path, file_size, file_hash, total_chapters, processing_status,
       created_at, updated_at)

reading_progress (book_id PK, current_cfi, progress_percentage,
                   total_reading_seconds, last_read_at)
    FK book_id -> books.id ON DELETE CASCADE

reader_settings (id PK, theme, font_family, font_size, line_height, tts_rate,
                  tts_pitch, voice_uri, voice_name, voice_lang, auto_continue,
                  auto_scroll, highlight_enabled, updated_at)
    -- chỉ có đúng 1 dòng (id=1), KHÔNG có multi-user settings
```

**Lưu ý:**
- `reading_progress.total_reading_seconds` **đã có cột nhưng chưa có code nào ghi vào
  nó**. Nếu được yêu cầu làm tính năng "thống kê thời gian đọc", đây là cột có sẵn cần
  dùng, không tạo cột/bảng mới trùng lặp.
- `ddl-auto: update` đang bật trong `application.yml` — khi thêm/sửa entity, Hibernate
  tự sửa schema. Cẩn thận khi đổi kiểu dữ liệu cột đã có (rủi ro mất dữ liệu). Nếu dự
  án phát triển lớn hơn, nên đề xuất chuyển sang Flyway/Liquibase thay vì tự làm ngầm.

---

## 6. REST API hiện có

| Method | Endpoint | Chức năng |
|---|---|---|
| POST | `/api/books/upload` | Upload file `.epub` (multipart, field `file`, max 50MB) |
| GET | `/api/books` | Danh sách sách |
| GET | `/api/books/{id}` | Chi tiết 1 sách (kèm tiến độ đọc) |
| DELETE | `/api/books/{id}` | Xoá sách (xoá cả file vật lý + DB) |
| GET | `/api/books/{id}/file` | Trả file `.epub` gốc (dùng cho epub.js load ArrayBuffer) |
| GET | `/api/books/{id}/cover` | Trả ảnh bìa |
| GET | `/api/progress/{bookId}` | Lấy CFI + % tiến độ đọc dở |
| PUT | `/api/progress/{bookId}` | Cập nhật CFI + % (body: `{cfi, percentage}`) |
| GET | `/api/settings` | Lấy cài đặt hiển thị/giọng đọc |
| PUT | `/api/settings` | Cập nhật cài đặt (partial update — field nào null thì giữ nguyên) |
| GET | `/api/tts?text=&voice=&lang=` | Trả `audio/mpeg` bytes cho 1 đoạn text |
| GET | `/api/health` | Kiểm tra DB + storage |

Khi thêm endpoint mới: giữ đúng convention REST hiện có (`/api/<resource>/{id}/<action>`),
trả `ResponseEntity<DTO>` chứ không trả entity JPA thẳng, và thêm exception handling
nhất quán (xem mục 7.1).

---

## 7. Quy tắc bắt buộc khi AI sửa/thêm code

### 7.1. Backend
- **Không** ném `RuntimeException` trần trụi cho lỗi "not found" — tạo exception
  class riêng (`BookNotFoundException`, v.v.) và xử lý qua `@RestControllerAdvice`
  nếu file đó đã tồn tại; nếu chưa có, hỏi người dùng có muốn tạo không trước khi
  thêm một lớp hạ tầng mới.
- Luôn dùng `@Transactional` cho các thao tác ghi liên quan nhiều bảng (theo pattern
  đã có trong `BookService.uploadBook()` / `deleteBook()`).
- File EPUB/cover lưu bằng UUID (`StorageService`), **không** dùng tên file gốc do
  người dùng đặt để tránh path traversal — giữ nguyên pattern này.
- Không hard-code thông tin nhạy cảm mới vào `application.yml`; nếu cần thêm config,
  dùng `${ENV_VAR:default}`.

### 7.2. Frontend
- Giữ nguyên object-literal module pattern (`const XYZ = { init(), bindEvents(), ... }`)
  — không đổi sang class syntax hay module ES import/export trừ khi có yêu cầu build
  step (webpack/vite) rõ ràng, vì hiện dự án load script trực tiếp qua thẻ `<script>`.
- Mọi thao tác thay đổi trạng thái TTS phải cập nhật qua `TTSEngine.setStatus()`
  (state machine: `IDLE | LOADING | PLAYING | PAUSED | STOPPED | ERROR`) — không tự ý
  gán `this.status = '...'` trực tiếp ở nơi khác để tránh state không nhất quán.
- Không thêm `setTimeout` để "chờ cho chắc" trong luồng điều hướng epub.js — luôn ưu
  tiên Promise/event có sẵn (`relocated`, `rendered`, kết quả trả về của
  `next()/prev()/display()`).
- Text tiếng Việt trong UI/message giữ nguyên có dấu, đúng chính tả (dự án hướng tới
  người dùng Việt Nam).

### 7.3. Khi sửa lỗi
- Trước khi sửa bug trong `tts-engine.js` hoặc `reader.js`, đọc lại mục 4 ở trên để
  hiểu đúng luồng — phần lớn bug nghiêm trọng nhất từng gặp (nhảy chương liên tục,
  click không đúng vị trí) đều xuất phát từ việc phá vỡ giả định "1 page = 1 chương"
  hoặc dùng timer đoán giờ thay vì Promise thật.

---

## 8. Backlog nâng cấp đã lên kế hoạch (ưu tiên từ trên xuống)

Dùng danh sách này khi người dùng nói "làm tiếp việc tiếp theo" hoặc không chỉ định
cụ thể nên làm gì:

1. **Global Exception Handler** — trả 404 thay vì 500 khi không tìm thấy sách.
2. **Cache audio TTS** theo `sha256(text + voice + lang)` trong
   `./storage/tts_cache/`, kiểm tra cache trước khi gọi Google/Edge TTS.
3. **Gộp EdgeTtsService thành 1 kết nối WebSocket cho cả phiên đọc** thay vì mở mới
   mỗi câu (giảm độ trễ, tránh bị rate-limit).
4. **Prefetch câu kế tiếp** trong `tts-engine.js` (double-buffer 2 thẻ `<audio>`) để
   chuyển câu không có khoảng lặng.
5. **Chuẩn hoá số/ngày tháng/tiền tệ sang chữ tiếng Việt** trước khi đưa vào TTS.
6. **Gắn `data-sentence-id` vào DOM** khi render chương, thay cơ chế highlight bằng
   so khớp chuỗi (`.includes()`) hiện tại — chính xác tuyệt đối, không cần đoán.
7. **Bookmark nhiều vị trí** (bảng `bookmarks` mới) — hiện chỉ lưu được 1 vị trí đọc
   dở gần nhất.
8. **Thống kê thời gian đọc** — dùng cột `total_reading_seconds` đã có sẵn.
9. **Sort thư viện** (theo tên / ngày thêm / % tiến độ).
10. **Flyway/Liquibase** thay cho `ddl-auto: update`, và chuyển DB credentials sang
    biến môi trường.

---

## 9. Cách chạy & build dự án

```bash
# Yêu cầu: JDK 17, MySQL đang chạy ở localhost:3306, database d_reader_db đã tạo
mvn clean package
java -jar target/dreader-0.0.1-SNAPSHOT.jar
# hoặc trong lúc dev:
mvn spring-boot:run
```
Truy cập: `http://localhost:8080`

Frontend không có build step (không webpack/vite) — sửa file trong
`src/main/resources/static/` là thấy hiệu lực ngay sau khi build lại/refresh (Spring
Boot serve static resources trực tiếp). Khi sửa JS/CSS, nhớ bump version query string
trên thẻ `<script src="...?v=20">` trong `index.html` nếu muốn tránh cache trình duyệt.

---

## 10. Những điều KHÔNG được tự ý làm nếu không được yêu cầu

- Không thêm hệ thống đăng nhập/nhiều người dùng (ngoài phạm vi đặc tả — app local
  đơn người dùng).
- Không đổi database engine (giữ MySQL, không tự chuyển PostgreSQL/SQLite...).
- Không thêm framework frontend mới.
- Không xoá/đổi tên các API endpoint đang có (frontend phụ thuộc trực tiếp path cũ).
- Không commit thông tin nhạy cảm (mật khẩu DB, token) vào file cấu hình khi refactor.