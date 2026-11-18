# 📖 D_Reader — Trình Đọc Sách Đa Định Dạng & Nghe Truyện TTS Tiếng Việt

**D_Reader** là ứng dụng Web cá nhân chạy cục bộ (**Localhost Desktop Web App**) được thiết kế chuyên biệt cho nhu cầu đọc tiểu thuyết, sách điện tử dài kỳ (`.epub`, `.pdf`, `.mobi`, `.azw3`, `.txt`, `.docx`) và nghe đọc văn bản tự động (**Text-to-Speech**) bằng tiếng Việt với độ ổn định cao.

---

## ✨ Tính Năng Nổi Bật

### 1. Quản lý Thư viện & Xử lý Đa định dạng (Unified EPUB Converter)
- **Hỗ trợ 6 định dạng sách phổ biến (`.epub`, `.pdf`, `.mobi`, `.azw3`, `.txt`, `.docx`):**
  - **Cơ chế chuẩn hóa nội dung ở Backend (`FormatConverterService` + `EpubBuilder`):** Tự động chuyển đổi mọi định dạng đầu vào sang cấu trúc `.epub` chuẩn hóa để giữ nguyên 100% trải nghiệm tùy chỉnh Font, Theme, Lưu tiến độ CFI, Tách chương và Đọc TTS Karaoke.
  - **Với `.txt`:** Tự động nhận diện bảng mã tiếng Việt (`UTF-8`, `UTF-16LE/BE`, `Windows-1258`), quét Regex nhận diện tiêu đề chương (`Chương`, `Hồi`, `Quyển`, `Phần`, `Tiết`...) hoặc tự ngắt mỗi `4.000 từ/chương`.
  - **Với `.pdf`:** Dùng `Apache PDFBox 3` trích xuất ảnh bìa nét cao từ trang 1, đọc cây mục lục `PDDocumentOutline` (hoặc quét Regex chương), lọc số trang rác ở header/footer và nối các dòng bị ngắt cứng giữa câu.
  - **Với `.mobi` / `.azw3`:** Tích hợp bộ giải mã nhị phân `PalmDOC LZ77 / MOBI / KF8` thuần Java (tự động trích xuất metadata EXTH, ảnh bìa và văn bản HTML), kết hợp hỗ trợ `ebook-convert` (Calibre CLI) nếu có sẵn trong máy.
  - **Với `.docx`:** Dùng `Apache POI` bóc tách cấu trúc `Heading 1/2`, đoạn văn, bảng biểu và ảnh bìa nhúng.
- **Tự động bóc tách Metadata & Ảnh bìa:** Trích xuất tiêu đề, tác giả, mô tả, tổng số chương, nhãn định dạng gốc (`EPUB`, `PDF`, `MOBI`, `AZW3`, `TXT`, `DOCX`) và ảnh bìa ngay khi tải sách lên (tối đa `150MB`).
- **Kiểm tra trùng lặp bằng mã băm (`SHA-256`):** Ngăn chặn tải trùng sách đã có trong thư viện.
- **Tự động sửa lỗi EPUB dị biệt:**
  - Khôi phục danh sách Mục lục cho các file EPUB thiếu `toc.ncx` hoặc lỗi cấu trúc XML.
  - **Tách chương thông minh (`DOM Range Slicer`):** Xử lý triệt để các file EPUB gộp 15–50 chương vào chung một tệp `.xhtml`, giúp nhảy chính xác đến từng chương được chọn.

### 2. Giao diện Đọc sách Công thái học (Dark Gradient & Glassmorphism UI)
- **Thiết kế Dark Gradient & Glassmorphism:** Giao diện tối chuyển sắc sâu kết hợp hiệu ứng kính mờ hiện đại, trang sách nổi khối (`#11131a` / `#e2e8f0`) dịu mắt khi đọc liên tục nhiều giờ.
- **Đồng bộ hóa Phông chữ 100%:** Tự động loại bỏ CSS rác từ file sách gốc và áp dụng phông chữ chuẩn tiếng Việt (*Be Vietnam Pro*, *Literata*, *Merriweather*, *Lora*).
- **Tùy biến linh hoạt:**
  - **4 chế độ màu:** *🌙 Tối (Dark Gradient)*, *☀️ Sáng (Light)*, *📜 Sepia*, *🌿 Mint*.
  - **Độ rộng & Bố cục:** `1000px`, `1350px`, `1600px`, `Tràn viền`, hoặc `Hai cột (Sách mở)`, cùng cỡ chữ `14px – 40px`.
  - **Bộ lọc từ & Regex thay thế:** Xóa tự động watermark rác từ nguồn truyện trước khi hiển thị và đọc TTS.
- **Hiển thị & Đồng bộ Mục lục thông minh:**
  - Hiển thị huy hiệu **`📖 Chương hiện tại`** ngay trên thanh công cụ phía trên.
  - Khi bấm mở **Mục lục**, danh sách tự động cuộn đưa chương đang đọc ra chính giữa màn hình.
- **Lưu tiến trình tức thì (`Flush Save Progress`):** Tự động lưu tọa độ đọc (`EPUB CFI`, chỉ số chương & phần trăm) ngay cả khi chuyển tab hoặc đóng trình duyệt đột ngột (`keepalive: true`).
- **Quản lý Dấu trang (Bookmarks):** Đánh dấu vị trí đọc yêu thích kèm trích dẫn và quản lý nhanh trong ngăn bên.

### 3. Trình Đọc Giọng Nói (TTS Engine) Chuyên Sâu
- **Giọng đọc Tiếng Việt ổn định cao:**
  - Tích hợp luồng tổng hợp giọng nói qua Backend kết hợp bộ nhớ đệm **RAM LRU Cache + Disk Cache (`./storage/tts_cache`)**, chia nhỏ câu dài (`Chunking`) và xoay vòng endpoint tự động chống ngắt quãng.
  - Hỗ trợ giọng đọc trình duyệt dự phòng (`Web Speech API`) khi ngoại tuyến.
- **Karaoke Highlight & Auto-Scroll:**
  - Tô sáng câu đang đọc theo thời gian thực bên trong `<iframe>` và tự động cuộn trang vùng an toàn bám theo nhịp đọc (mượt mà cả ở tốc độ cao `3.0x – 4.0x`).
  - **Chọn điểm đọc tức thì (Click-to-read):** Nhấp vào bất kỳ câu văn nào trên trang sách để bắt đầu nghe ngay từ đúng vị trí ký tự vừa nhấp, chống xung đột bất đồng bộ bằng cơ chế `Playback Token` và `AbortController`.
- **Chạy nền không gián đoạn (Background Keep-Alive):**
  - Duy trì luồng đọc và tự động lật sang chương mới ngay cả khi chuyển tab hoặc thu nhỏ cửa sổ làm việc nhờ **Web Worker Unthrottled Timer** và **Silent AudioContext**.
  - Tích hợp **MediaSession API** (điều khiển Play/Pause/Next/Prev bằng phím cứng đa phương tiện) và **Hẹn giờ tắt (Sleep Timer)**.

---

## 🛠️ Kiến Trúc Kỹ Thuật

| Tầng | Công nghệ sử dụng |
| :--- | :--- |
| **Backend** | Java 17+, Spring Boot 3.2.3 (Spring Web, Spring Data JPA) |
| **Xử lý Đa định dạng** | Apache PDFBox 3.0.1, Apache POI 5.2.5 (`poi-ooxml`), Jsoup 1.17.2, Pure-Java PalmDOC/MOBI Decoder |
| **Cơ sở dữ liệu** | MySQL 8.0 (`d_reader_db`, `utf8mb4_unicode_ci`) |
| **Frontend** | HTML5, CSS3 (Dark Gradient & Glassmorphism), Vanilla JavaScript (ES6+) |
| **Reader Engine** | `epub.js` 0.3.93, `JSZip` 3.10.1, Custom DOM Range Slicer & Typography Normalizer |
| **Audio / TTS** | Spring `HttpClient` TTS Streamer (RAM LRU + Disk Cached), Web Audio API, Web Worker |
| **Lưu trữ vật lý** | Local File System (`./storage/books`, `./storage/covers`, `./storage/tts_cache`) |

---

## 📂 Cấu Trúc Thư Mục Chính

```text
D_Reader/
├── src/main/java/com/dreader/
│   ├── config/           # DatabaseMigrationRunner (Tự động nâng cấp cột DB an toàn khi khởi động)
│   ├── controller/       # REST APIs: Book, Bookmark, Progress, Setting, Tts, Health
│   ├── dto/              # DTOs: BookDto, BookmarkDto, ChapterContentDto, ProgressRequest
│   ├── entity/           # JPA Entities: Book, Bookmark, ReadingProgress, ReaderSetting
│   ├── exception/        # GlobalExceptionHandler & BookNotFoundException
│   ├── repository/       # Spring Data JPA Repositories
│   ├── service/          # BookService, FormatConverterService, StorageService, TtsService...
│   └── util/             # EpubParser (Bóc tách Metadata/TOC) & EpubBuilder (Đóng gói chuẩn EPUB)
├── src/main/resources/
│   ├── static/
│   │   ├── css/app.css                # Giao diện Dark Gradient & Glassmorphism
│   │   ├── js/
│   │   │   ├── app.js                 # Khởi tạo ứng dụng & điều phối view SPA
│   │   │   ├── library.js             # Quản lý Thư viện, Lọc/Tìm kiếm & Upload đa định dạng
│   │   │   ├── reader.js              # Nhân hiển thị sách, Theme/Font, Lưu tiến độ & Bookmark
│   │   │   ├── reader-enhancements.js # Tách chương gộp, huy hiệu chương & tự cuộn TOC
│   │   │   └── tts-engine.js          # Động cơ TTS, Karaoke Highlight & Chạy nền
│   │   └── index.html                 # Giao diện SPA chính
│   ├── application.yml   # Cấu hình kết nối MySQL, giới hạn upload 150MB & đường dẫn lưu trữ
│   └── schema.sql        # Kịch bản khởi tạo 4 bảng cơ sở dữ liệu
├── Mo_D_Reader.bat       # Kịch bản khởi động nhanh 1 chạm (Chạy ngầm javaw + Chrome/Edge App)
├── Tat_D_Reader.bat      # Kịch bản đóng nhanh tiến trình ngầm trên cổng 8080 giải phóng RAM
└── pom.xml               # Cấu hình Maven & thư viện phụ thuộc
```

---

## 🚀 Hướng Dẫn Cài Đặt & Sử Dụng Nhanh

### 1. Yêu cầu môi trường
- **JDK 17** trở lên.
- **MySQL Server 8.0** đang chạy ở cổng `3306`.
- Trình duyệt **Google Chrome** hoặc **Microsoft Edge**.

### 2. Khởi tạo Cơ sở dữ liệu
Tạo database `d_reader_db` trên MySQL (khi ứng dụng khởi chạy, Spring Boot sẽ tự động thực thi `src/main/resources/schema.sql` và `DatabaseMigrationRunner` để khởi tạo/cập nhật đầy đủ 4 bảng `books`, `reading_progress`, `reader_settings`, và `bookmarks`):

```sql
CREATE DATABASE IF NOT EXISTS d_reader_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
```

Kiểm tra thông tin tài khoản MySQL trong `src/main/resources/application.yml` (`spring.datasource.username` / `password`).

### 3. Đóng gói & Khởi chạy ứng dụng

#### Cách 1 — Khởi động nhanh 1 chạm trên Windows (Khuyên dùng)
- Nhấp đúp vào tệp **`Mo_D_Reader.bat`**: Kịch bản sẽ tự động bật dịch vụ MySQL, đóng gói `.jar` (nếu chưa có), khởi chạy máy chủ ngầm tiết kiệm RAM (`javaw -Xms128m -Xmx384m`) và mở giao diện ở chế độ cửa sổ ứng dụng độc lập (`--app=http://localhost:8080`).
- Khi đọc xong, bấm nút **Thoát** ngay trên góc phải ứng dụng hoặc chạy **`Tat_D_Reader.bat`** để tắt máy chủ ngầm.

#### Cách 2 — Chạy qua dòng lệnh (Terminal / PowerShell)
```bash
# Biên dịch và đóng gói tệp JAR
./mvnw.cmd clean package -DskipTests   # Windows
./mvnw clean package -DskipTests       # Linux / macOS

# Khởi chạy ứng dụng
java -Xms128m -Xmx384m -jar target/dreader-0.0.1-SNAPSHOT.jar
```
Sau khi khởi động thành công, mở trình duyệt truy cập: **`http://localhost:8080`**

---

## ⌨️ Phím Tắt Tiện Ích Trong Trình Đọc

| Phím tắt | Chức năng |
| :--- | :--- |
| `←` / `→` | Chuyển trang / Chuyển chương trước - sau |
| `Space` | Phát / Tạm dừng đọc giọng nói (TTS) |
| `M` | Mở / Đóng thanh bên Mục lục & Dấu trang |
| `B` | Đánh dấu nhanh trang đang đọc |
| `F` | Bật / Tắt chế độ Toàn màn hình (Fullscreen) |
| `+` / `-` | Tăng / Giảm cỡ chữ trang đọc |
