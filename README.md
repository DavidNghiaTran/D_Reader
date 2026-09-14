# D_Reader 📖

D_Reader là một ứng dụng Web đọc truyện định dạng EPUB hiện đại, được tối ưu hóa với trải nghiệm người dùng mượt mà và hệ thống Đọc Truyện Bằng Giọng Nói (Text-to-Speech - TTS) thông minh.

## ✨ Tính năng nổi bật

### 📚 Quản lý thư viện
* Tải lên và lưu trữ các tệp EPUB an toàn trên hệ thống.
* Tự động trích xuất ảnh bìa và siêu dữ liệu (metadata) từ tệp EPUB (được bảo vệ chống lỗ hổng XXE).
* Giao diện thư viện sách trực quan, dễ sử dụng.

### 👓 Trải nghiệm đọc tối ưu
* Sử dụng thư viện **Epub.js** để hiển thị nội dung, hỗ trợ phân trang mượt mà (Scrolled/Paginated Flow).
* Tùy chỉnh giao diện đọc đa dạng:
  * **Theme:** Sáng (Light), Tối (Dark), Vàng nhạt (Sepia).
  * **Phông chữ:** Hỗ trợ Serif và Sans-serif.
  * **Cỡ chữ:** Tùy chỉnh phóng to/thu nhỏ linh hoạt.
* Thanh mục lục (TOC) tương tác thông minh, tự động đẩy giao diện nội dung (push-content layout) không che khuất chữ.
* Ghi nhớ tự động vị trí đang đọc (Lưu tiến trình qua CFI).

### 🎧 Hệ thống Text-to-Speech (TTS) Nâng Cao
Hệ thống TTS được xây dựng trên cấu trúc đa tầng (Multi-Engine) và đồng bộ Karaoke-style siêu mượt:
* **Đa nền tảng giọng đọc:**
  * 🌟 **Microsoft Edge TTS Neural:** Tích hợp trực tiếp qua Java WebSocket (Không cần API Key). Hỗ trợ giọng đọc AI Tiếng Việt siêu chân thực (Hoài My - Nữ, Nam Minh - Nam).
  * ☁️ **Google TTS Cloud Proxy:** Proxy nội bộ vượt giới hạn CORS.
  * 💻 **Web Speech API:** Tự động fallback (dự phòng) sử dụng giọng đọc của thiết bị khi mất kết nối mạng.
* **Karaoke-style Highlighting:** Tự động đánh dấu (tô vàng) câu văn đang được đọc và tự động cuộn trang (Auto-scroll) theo câu.
* **Tính năng Click-to-read:** Nhấn vào bất kỳ câu văn nào trên trang sách, hệ thống sẽ tự nhận diện Node và bắt đầu đọc/highlight từ đúng vị trí đó.
* **Chống trôi trang thông minh (Anti-jump):** Thuật toán tính toán vị trí DOM và ScrollY (`getVisibleSentenceIndex`) đảm bảo TTS bắt đầu đọc chính xác từ câu văn đang hiển thị trên màn hình người dùng, thay vì đọc lại từ đầu chương.
* **Xử lý Race-Condition:** Sử dụng Mutex Lock (`isTtsNavigating`, `isTurningPage`) và Garbage Collection nghiêm ngặt để đảm bảo quá trình tự động lật trang khi đọc hết chương không bị lặp vô tận hoặc gọi chồng chéo sự kiện.
* Tùy chỉnh tốc độ (Rate) và độ trầm bổng (Pitch) của giọng đọc theo ý thích.

## 🛠️ Công nghệ sử dụng
* **Backend:** Java 17, Spring Boot 3.2.3, Spring Data JPA, Hibernate.
* **Database:** MySQL, HikariCP.
* **Frontend:** HTML5, CSS3 (Vanilla), JavaScript, Epub.js.
* **Build Tool:** Maven (mvnw).

## 🚀 Hướng dẫn cài đặt và chạy thử

### 1. Yêu cầu hệ thống
* Java Development Kit (JDK) 17 trở lên.
* MySQL Server (hoặc MariaDB).

### 2. Thiết lập cơ sở dữ liệu
Tạo một schema cơ sở dữ liệu trên MySQL với tên `dreader` (hoặc sửa đổi theo cấu hình của bạn trong `application.yml`):
```sql
CREATE DATABASE dreader CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

### 3. Cấu hình ứng dụng
Mở tệp `src/main/resources/application.yml` và cập nhật thông tin kết nối MySQL của bạn (username, password).
Hệ thống lưu trữ tệp (EPUB, Covers) mặc định được lưu ở thư mục `./storage/` ngang hàng với thư mục gốc của dự án.

### 4. Khởi chạy ứng dụng
Mở Terminal/Command Prompt tại thư mục dự án và chạy lệnh sau:

**Trên Windows:**
```bash
./mvnw.cmd clean spring-boot:run
```

**Trên Linux/MacOS:**
```bash
./mvnw clean spring-boot:run
```

### 5. Truy cập ứng dụng
Sau khi Spring Boot khởi động thành công (báo hiệu Tomcat started on port 8080), hãy mở trình duyệt web và truy cập:
👉 `http://localhost:8080`

## 📝 Nhật ký thay đổi gần đây
- **Edge TTS Integration:** Tích hợp thành công WebSockets cho giọng đọc AI Hoài My và Nam Minh.
- **Bảo mật:** Vá lỗ hổng XML External Entity (XXE) trong trình phân tích `EpubParser.java`.
- **UI/UX:** Tối ưu hóa TOC sidebar push-content. Sửa lỗi nhảy DOM và trôi text khi Highlight bằng Mutex Lock và `TreeWalker` cải tiến.
- **Click-to-read:** Cập nhật tính năng nhận diện đoạn text được click bằng `caretPositionFromPoint` và `caretRangeFromPoint`.
