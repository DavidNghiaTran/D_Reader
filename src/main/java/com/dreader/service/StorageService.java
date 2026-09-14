package com.dreader.service;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.multipart.MultipartFile;

import jakarta.annotation.PostConstruct;
import java.io.File;
import java.io.IOException;
import java.nio.file.*;
import java.util.UUID;

@Service
public class StorageService {

    @Value("${storage.location.books:D:/D_Reader/storage/books}")
    private String booksLocation;

    @Value("${storage.location.covers:D:/D_Reader/storage/covers}")
    private String coversLocation;

    @PostConstruct
    public void init() {
        try {
            Files.createDirectories(Paths.get(booksLocation));
            Files.createDirectories(Paths.get(coversLocation));
        } catch (IOException e) {
            throw new RuntimeException("Could not initialize storage directories", e);
        }
    }

    public Path getBooksPath() {
        return Paths.get(booksLocation);
    }

    public Path getCoversPath() {
        return Paths.get(coversLocation);
    }

    public String saveBookFile(MultipartFile file) throws IOException {
        String originalFilename = StringUtils.cleanPath(file.getOriginalFilename() != null ? file.getOriginalFilename() : "book.epub");
        String extension = "";
        int dotIndex = originalFilename.lastIndexOf('.');
        if (dotIndex >= 0) {
            extension = originalFilename.substring(dotIndex);
        }
        String uniqueFilename = UUID.randomUUID().toString() + extension;
        Path targetPath = getBooksPath().resolve(uniqueFilename);
        Files.copy(file.getInputStream(), targetPath, StandardCopyOption.REPLACE_EXISTING);
        return targetPath.toAbsolutePath().toString();
    }

    public String saveCoverBytes(byte[] coverBytes, String format) throws IOException {
        if (coverBytes == null || coverBytes.length == 0) {
            return null;
        }
        String ext = (format != null && !format.isEmpty()) ? "." + format : ".jpg";
        String uniqueFilename = "cover_" + UUID.randomUUID().toString() + ext;
        Path targetPath = getCoversPath().resolve(uniqueFilename);
        Files.write(targetPath, coverBytes);
        return targetPath.toAbsolutePath().toString();
    }

    public void deleteFile(String filePath) {
        if (filePath != null && !filePath.trim().isEmpty()) {
            try {
                Path path = Paths.get(filePath);
                Files.deleteIfExists(path);
            } catch (Exception ignored) {
            }
        }
    }
}
