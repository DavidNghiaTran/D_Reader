package com.dreader.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.CommandLineRunner;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

@Component
public class DatabaseMigrationRunner implements CommandLineRunner {

    private static final Logger log = LoggerFactory.getLogger(DatabaseMigrationRunner.class);
    private final JdbcTemplate jdbcTemplate;

    public DatabaseMigrationRunner(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    @Override
    public void run(String... args) {
        try {
            jdbcTemplate.execute("ALTER TABLE books " +
                    "MODIFY COLUMN isbn VARCHAR(255) DEFAULT NULL, " +
                    "MODIFY COLUMN title VARCHAR(500) NOT NULL, " +
                    "MODIFY COLUMN language VARCHAR(50) DEFAULT 'vi', " +
                    "MODIFY COLUMN publisher VARCHAR(255) DEFAULT NULL");
            log.info("[DB Migration] Successfully migrated books table columns.");
        } catch (Exception e) {
            log.warn("[DB Migration] Notice during books table migration: {}", e.getMessage());
        }

        try {
            // Kiểm tra xem cột replace_rules đã có chưa, nếu chưa thì thêm
            Integer count = jdbcTemplate.queryForObject(
                    "SELECT COUNT(*) FROM information_schema.COLUMNS " +
                    "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reader_settings' AND COLUMN_NAME = 'replace_rules'",
                    Integer.class
            );
            if (count == null || count == 0) {
                jdbcTemplate.execute("ALTER TABLE reader_settings ADD COLUMN replace_rules TEXT DEFAULT NULL");
                log.info("[DB Migration] Successfully added replace_rules column to reader_settings.");
            }
        } catch (Exception e) {
            log.warn("[DB Migration] Notice during reader_settings migration: {}", e.getMessage());
        }

        try {
            Integer fmtCount = jdbcTemplate.queryForObject(
                    "SELECT COUNT(*) FROM information_schema.COLUMNS " +
                    "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'books' AND COLUMN_NAME = 'original_format'",
                    Integer.class
            );
            if (fmtCount == null || fmtCount == 0) {
                jdbcTemplate.execute("ALTER TABLE books ADD COLUMN original_format VARCHAR(20) DEFAULT 'EPUB'");
                log.info("[DB Migration] Successfully added original_format column to books.");
            }
            jdbcTemplate.execute("UPDATE books SET original_format = 'EPUB' WHERE original_format IS NULL OR original_format = ''");
        } catch (Exception e) {
            log.warn("[DB Migration] Notice during original_format migration: {}", e.getMessage());
        }
    }
}

