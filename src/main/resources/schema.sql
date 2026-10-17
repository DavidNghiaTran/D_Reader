USE d_reader_db;

CREATE TABLE IF NOT EXISTS books (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    author VARCHAR(255) DEFAULT 'Chưa rõ tác giả',
    description TEXT,
    language VARCHAR(20) DEFAULT 'vi',
    publisher VARCHAR(255),
    isbn VARCHAR(50),
    file_path VARCHAR(500) NOT NULL,
    cover_path VARCHAR(500) DEFAULT NULL,
    file_size BIGINT,
    file_hash VARCHAR(64),
    total_chapters INT DEFAULT 0,
    processing_status VARCHAR(30) DEFAULT 'READY',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS reading_progress (
    book_id BIGINT PRIMARY KEY,
    current_cfi TEXT NOT NULL,
    progress_percentage DECIMAL(5,2) DEFAULT 0.00,
    chapter_title VARCHAR(255) DEFAULT NULL,
    chapter_index INT DEFAULT 0,
    total_reading_seconds BIGINT DEFAULT 0,
    last_read_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_book_progress FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS reader_settings (
    id BIGINT PRIMARY KEY DEFAULT 1,
    theme VARCHAR(50) DEFAULT 'dark',
    font_family VARCHAR(50) DEFAULT 'sans-serif',
    font_size INT DEFAULT 16,
    line_height FLOAT DEFAULT 1.6,
    flow_mode VARCHAR(50) DEFAULT 'scrolled-doc',
    content_width VARCHAR(50) DEFAULT 'wide',
    tts_rate FLOAT DEFAULT 1.0,
    tts_pitch FLOAT DEFAULT 1.0,
    tts_volume FLOAT DEFAULT 1.0,
    voice_uri VARCHAR(500) DEFAULT 'google-vi-online',
    voice_name VARCHAR(255) DEFAULT 'Google Tiếng Việt',
    voice_lang VARCHAR(20) DEFAULT 'vi-VN',
    auto_continue BOOLEAN DEFAULT TRUE,
    auto_scroll BOOLEAN DEFAULT TRUE,
    highlight_enabled BOOLEAN DEFAULT TRUE,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bookmarks (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    book_id BIGINT NOT NULL,
    name VARCHAR(255) NOT NULL,
    cfi TEXT NOT NULL,
    chapter_title VARCHAR(255) DEFAULT NULL,
    selected_text TEXT DEFAULT NULL,
    note TEXT DEFAULT NULL,
    color VARCHAR(20) DEFAULT 'yellow',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_bookmark_book FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
);
