package com.dreader.util;

import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Entities;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.zip.CRC32;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

/**
 * Đóng gói dữ liệu văn bản / HTML đã bóc tách thành tệp chuẩn EPUB (tương thích 100% với epub.js & EpubParser).
 */
public class EpubBuilder {

    public static class ChapterDraft {
        private final String title;
        private final String bodyHtml;

        public ChapterDraft(String title, String bodyHtml) {
            this.title = title != null && !title.isBlank() ? title.trim() : "Chương";
            this.bodyHtml = bodyHtml != null ? bodyHtml : "";
        }

        public String getTitle() {
            return title;
        }

        public String getBodyHtml() {
            return bodyHtml;
        }
    }

    public static class BookDraft {
        private String title = "Không có tiêu đề";
        private String author = "Chưa rõ tác giả";
        private String description = "";
        private String language = "vi";
        private String publisher = "D_Reader Unified Converter";
        private byte[] coverBytes;
        private String coverExtension = "jpg";
        private final List<ChapterDraft> chapters = new ArrayList<>();

        public String getTitle() { return title; }
        public void setTitle(String title) { if (title != null && !title.isBlank()) this.title = title.trim(); }

        public String getAuthor() { return author; }
        public void setAuthor(String author) { if (author != null && !author.isBlank()) this.author = author.trim(); }

        public String getDescription() { return description; }
        public void setDescription(String description) { this.description = description != null ? description.trim() : ""; }

        public String getLanguage() { return language; }
        public void setLanguage(String language) { if (language != null && !language.isBlank()) this.language = language.trim(); }

        public String getPublisher() { return publisher; }
        public void setPublisher(String publisher) { if (publisher != null && !publisher.isBlank()) this.publisher = publisher.trim(); }

        public byte[] getCoverBytes() { return coverBytes; }
        public void setCoverBytes(byte[] coverBytes) { this.coverBytes = coverBytes; }

        public String getCoverExtension() { return coverExtension; }
        public void setCoverExtension(String coverExtension) {
            if (coverExtension != null && !coverExtension.isBlank()) {
                this.coverExtension = coverExtension.toLowerCase().replace(".", "");
            }
        }

        public List<ChapterDraft> getChapters() { return chapters; }
        public void addChapter(String title, String bodyHtml) {
            this.chapters.add(new ChapterDraft(title, bodyHtml));
        }
    }

    /**
     * Xây dựng và ghi tệp .epub hoàn chỉnh ra đĩa.
     */
    public static void buildEpub(BookDraft draft, File targetEpubFile) throws IOException {
        if (draft.getChapters().isEmpty()) {
            draft.addChapter(draft.getTitle(), "<p>Nội dung trống.</p>");
        }

        String bookUuid = "urn:uuid:" + UUID.randomUUID();
        boolean hasCover = draft.getCoverBytes() != null && draft.getCoverBytes().length > 0;
        String coverExt = normalizeImageExt(draft.getCoverExtension());
        String coverMediaType = getImageMediaType(coverExt);
        String coverFilename = "Images/cover." + coverExt;

        try (FileOutputStream fos = new FileOutputStream(targetEpubFile);
             ZipOutputStream zos = new ZipOutputStream(fos, StandardCharsets.UTF_8)) {

            // 1. Entry đầu tiên BẮT BUỘC là mimetype (STORED - không nén)
            byte[] mimeBytes = "application/epub+zip".getBytes(StandardCharsets.US_ASCII);
            ZipEntry mimeEntry = new ZipEntry("mimetype");
            mimeEntry.setMethod(ZipEntry.STORED);
            mimeEntry.setSize(mimeBytes.length);
            mimeEntry.setCompressedSize(mimeBytes.length);
            CRC32 crc = new CRC32();
            crc.update(mimeBytes);
            mimeEntry.setCrc(crc.getValue());
            zos.putNextEntry(mimeEntry);
            zos.write(mimeBytes);
            zos.closeEntry();

            // 2. META-INF/container.xml
            writeUtf8Entry(zos, "META-INF/container.xml", buildContainerXml());

            // 3. OEBPS/Styles/style.css
            writeUtf8Entry(zos, "OEBPS/Styles/style.css", buildBaseCss());

            // 4. Ảnh bìa (nếu có)
            if (hasCover) {
                ZipEntry coverEntry = new ZipEntry("OEBPS/" + coverFilename);
                zos.putNextEntry(coverEntry);
                zos.write(draft.getCoverBytes());
                zos.closeEntry();
            }

            // 5. Các tệp chương OEBPS/Text/chapter_XXXX.xhtml
            List<ChapterDraft> chapters = draft.getChapters();
            for (int i = 0; i < chapters.size(); i++) {
                ChapterDraft ch = chapters.get(i);
                String chapterFile = String.format("OEBPS/Text/chapter_%04d.xhtml", i + 1);
                String xhtml = buildChapterXhtml(ch.getTitle(), ch.getBodyHtml(), draft.getLanguage());
                writeUtf8Entry(zos, chapterFile, xhtml);
            }

            // 6. OEBPS/toc.ncx (EPUB 2 TOC) & OEBPS/nav.xhtml (EPUB 3 Navigation)
            writeUtf8Entry(zos, "OEBPS/toc.ncx", buildTocNcx(bookUuid, draft.getTitle(), chapters));
            writeUtf8Entry(zos, "OEBPS/nav.xhtml", buildNavXhtml(draft.getTitle(), chapters, draft.getLanguage()));

            // 7. OEBPS/content.opf
            writeUtf8Entry(zos, "OEBPS/content.opf",
                    buildContentOpf(bookUuid, draft, chapters.size(), hasCover, coverFilename, coverMediaType));
        }
    }

    /**
     * Chuyển chuỗi văn bản thuần (nhiều dòng) sang các thẻ <p> an toàn.
     */
    public static String plainTextToParagraphsHtml(String text) {
        if (text == null || text.isBlank()) {
            return "<p></p>";
        }
        String sanitized = stripInvalidXmlChars(text).replace("\r\n", "\n").replace('\r', '\n');
        String[] lines = sanitized.split("\n");
        StringBuilder sb = new StringBuilder();
        for (String rawLine : lines) {
            String trimmed = rawLine.trim();
            if (trimmed.isEmpty()) continue;
            sb.append("<p>").append(escapeXmlText(trimmed)).append("</p>\n");
        }
        if (sb.length() == 0) {
            return "<p></p>";
        }
        return sb.toString();
    }

    private static String buildChapterXhtml(String chapterTitle, String rawBodyHtml, String lang) {
        String safeTitle = escapeXmlText(stripInvalidXmlChars(chapterTitle));
        String cleanedInput = stripInvalidXmlChars(rawBodyHtml);

        Document doc = Jsoup.parseBodyFragment(cleanedInput);
        // Xóa script/style/iframe/object rác nếu nguồn là HTML/MOBI
        doc.select("script, style, link, meta, iframe, object, embed, form").remove();
        // Gỡ bỏ các thuộc tính inline event hoặc namespace lạ gây lỗi XML parser
        doc.body().select("*").forEach(el -> {
            String tag = el.tagName().toLowerCase();
            if (tag.contains(":")) {
                el.unwrap();
                return;
            }
            el.attributes().asList().forEach(attr -> {
                String key = attr.getKey().toLowerCase();
                if (key.startsWith("on") || key.contains(":") || key.equals("style") || key.equals("face") || key.equals("color") || key.equals("size")) {
                    el.removeAttr(attr.getKey());
                }
            });
        });

        doc.outputSettings()
                .syntax(Document.OutputSettings.Syntax.xml)
                .escapeMode(Entities.EscapeMode.xhtml)
                .charset(StandardCharsets.UTF_8)
                .prettyPrint(false);

        String normalizedBody = doc.body().html()
                .replace("&nbsp;", "&#160;");

        // Kiểm tra xem đầu body đã có h1/h2 trùng tên chương chưa
        boolean alreadyHasHeading = false;
        org.jsoup.nodes.Element firstHeading = doc.body().selectFirst("h1, h2, h3");
        if (firstHeading != null) {
            String hText = firstHeading.text().trim();
            if (hText.equalsIgnoreCase(chapterTitle.trim())) {
                alreadyHasHeading = true;
            }
        }

        String safeLang = escapeXmlAttr(lang != null && !lang.isBlank() ? lang : "vi");
        StringBuilder xhtml = new StringBuilder();
        xhtml.append("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
        xhtml.append("<!DOCTYPE html>\n");
        xhtml.append("<html xmlns=\"http://www.w3.org/1999/xhtml\" xml:lang=\"").append(safeLang).append("\" lang=\"").append(safeLang).append("\">\n");
        xhtml.append("<head>\n");
        xhtml.append("  <meta charset=\"UTF-8\" />\n");
        xhtml.append("  <title>").append(safeTitle).append("</title>\n");
        xhtml.append("  <link rel=\"stylesheet\" type=\"text/css\" href=\"../Styles/style.css\" />\n");
        xhtml.append("</head>\n");
        xhtml.append("<body>\n");
        if (!alreadyHasHeading) {
            xhtml.append("  <h2 class=\"chapter-title\">").append(safeTitle).append("</h2>\n");
        }
        xhtml.append(normalizedBody).append("\n");
        xhtml.append("</body>\n");
        xhtml.append("</html>\n");
        return xhtml.toString();
    }

    private static String buildContainerXml() {
        return """
                <?xml version="1.0" encoding="UTF-8"?>
                <container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
                  <rootfiles>
                    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
                  </rootfiles>
                </container>
                """;
    }

    private static String buildBaseCss() {
        return """
                body {
                    margin: 0 auto;
                    padding: 1em;
                    line-height: 1.8;
                    text-align: justify;
                }
                h1, h2, h3, .chapter-title {
                    text-align: center;
                    font-weight: bold;
                    margin: 1.5em 0 1.2em 0;
                    line-height: 1.4;
                }
                p {
                    text-indent: 1.5em;
                    margin: 0 0 0.9em 0;
                }
                """;
    }

    private static String buildTocNcx(String bookUuid, String bookTitle, List<ChapterDraft> chapters) {
        StringBuilder sb = new StringBuilder();
        sb.append("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
        sb.append("<ncx xmlns=\"http://www.daisy.org/z3986/2005/ncx/\" version=\"2005-1\">\n");
        sb.append("  <head>\n");
        sb.append("    <meta name=\"dtb:uid\" content=\"").append(escapeXmlAttr(bookUuid)).append("\"/>\n");
        sb.append("    <meta name=\"dtb:depth\" content=\"1\"/>\n");
        sb.append("    <meta name=\"dtb:totalPageCount\" content=\"0\"/>\n");
        sb.append("    <meta name=\"dtb:maxPageNumber\" content=\"0\"/>\n");
        sb.append("  </head>\n");
        sb.append("  <docTitle><text>").append(escapeXmlText(stripInvalidXmlChars(bookTitle))).append("</text></docTitle>\n");
        sb.append("  <navMap>\n");
        for (int i = 0; i < chapters.size(); i++) {
            int order = i + 1;
            String src = String.format("Text/chapter_%04d.xhtml", order);
            String title = escapeXmlText(stripInvalidXmlChars(chapters.get(i).getTitle()));
            sb.append("    <navPoint id=\"navPoint-").append(order).append("\" playOrder=\"").append(order).append("\">\n");
            sb.append("      <navLabel><text>").append(title).append("</text></navLabel>\n");
            sb.append("      <content src=\"").append(src).append("\"/>\n");
            sb.append("    </navPoint>\n");
        }
        sb.append("  </navMap>\n");
        sb.append("</ncx>\n");
        return sb.toString();
    }

    private static String buildNavXhtml(String bookTitle, List<ChapterDraft> chapters, String lang) {
        String safeLang = escapeXmlAttr(lang != null && !lang.isBlank() ? lang : "vi");
        StringBuilder sb = new StringBuilder();
        sb.append("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
        sb.append("<!DOCTYPE html>\n");
        sb.append("<html xmlns=\"http://www.w3.org/1999/xhtml\" xmlns:epub=\"http://www.idpf.org/2007/ops\" xml:lang=\"").append(safeLang).append("\" lang=\"").append(safeLang).append("\">\n");
        sb.append("<head><meta charset=\"UTF-8\"/><title>Mục lục - ").append(escapeXmlText(stripInvalidXmlChars(bookTitle))).append("</title></head>\n");
        sb.append("<body>\n");
        sb.append("  <nav epub:type=\"toc\" id=\"toc\">\n");
        sb.append("    <h1>Mục lục</h1>\n");
        sb.append("    <ol>\n");
        for (int i = 0; i < chapters.size(); i++) {
            String src = String.format("Text/chapter_%04d.xhtml", i + 1);
            String title = escapeXmlText(stripInvalidXmlChars(chapters.get(i).getTitle()));
            sb.append("      <li><a href=\"").append(src).append("\">").append(title).append("</a></li>\n");
        }
        sb.append("    </ol>\n");
        sb.append("  </nav>\n");
        sb.append("</body>\n");
        sb.append("</html>\n");
        return sb.toString();
    }

    private static String buildContentOpf(
            String bookUuid,
            BookDraft draft,
            int chapterCount,
            boolean hasCover,
            String coverHref,
            String coverMediaType) {

        StringBuilder sb = new StringBuilder();
        sb.append("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
        sb.append("<package xmlns=\"http://www.idpf.org/2007/opf\" unique-identifier=\"BookId\" version=\"3.0\">\n");
        sb.append("  <metadata xmlns:dc=\"http://purl.org/dc/elements/1.1/\">\n");
        sb.append("    <dc:identifier id=\"BookId\">").append(escapeXmlText(bookUuid)).append("</dc:identifier>\n");
        sb.append("    <dc:title>").append(escapeXmlText(stripInvalidXmlChars(draft.getTitle()))).append("</dc:title>\n");
        sb.append("    <dc:creator>").append(escapeXmlText(stripInvalidXmlChars(draft.getAuthor()))).append("</dc:creator>\n");
        sb.append("    <dc:language>").append(escapeXmlText(stripInvalidXmlChars(draft.getLanguage()))).append("</dc:language>\n");
        sb.append("    <dc:publisher>").append(escapeXmlText(stripInvalidXmlChars(draft.getPublisher()))).append("</dc:publisher>\n");
        if (draft.getDescription() != null && !draft.getDescription().isBlank()) {
            sb.append("    <dc:description>").append(escapeXmlText(stripInvalidXmlChars(draft.getDescription()))).append("</dc:description>\n");
        }
        if (hasCover) {
            sb.append("    <meta name=\"cover\" content=\"cover-image\"/>\n");
        }
        sb.append("  </metadata>\n");

        sb.append("  <manifest>\n");
        sb.append("    <item id=\"ncx\" href=\"toc.ncx\" media-type=\"application/x-dtbncx+xml\"/>\n");
        sb.append("    <item id=\"nav\" href=\"nav.xhtml\" media-type=\"application/xhtml+xml\" properties=\"nav\"/>\n");
        sb.append("    <item id=\"style\" href=\"Styles/style.css\" media-type=\"text/css\"/>\n");
        if (hasCover) {
            sb.append("    <item id=\"cover-image\" href=\"").append(escapeXmlAttr(coverHref))
              .append("\" media-type=\"").append(escapeXmlAttr(coverMediaType))
              .append("\" properties=\"cover-image\"/>\n");
        }
        for (int i = 1; i <= chapterCount; i++) {
            String id = String.format("chap_%04d", i);
            String href = String.format("Text/chapter_%04d.xhtml", i);
            sb.append("    <item id=\"").append(id).append("\" href=\"").append(href).append("\" media-type=\"application/xhtml+xml\"/>\n");
        }
        sb.append("  </manifest>\n");

        sb.append("  <spine toc=\"ncx\">\n");
        for (int i = 1; i <= chapterCount; i++) {
            String id = String.format("chap_%04d", i);
            sb.append("    <itemref idref=\"").append(id).append("\"/>\n");
        }
        sb.append("  </spine>\n");
        sb.append("</package>\n");
        return sb.toString();
    }

    private static void writeUtf8Entry(ZipOutputStream zos, String entryName, String content) throws IOException {
        ZipEntry entry = new ZipEntry(entryName);
        zos.putNextEntry(entry);
        zos.write(content.getBytes(StandardCharsets.UTF_8));
        zos.closeEntry();
    }

    private static String normalizeImageExt(String ext) {
        if (ext == null) return "jpg";
        String lower = ext.toLowerCase().trim();
        if (lower.equals("png")) return "png";
        if (lower.equals("webp")) return "webp";
        return "jpg";
    }

    private static String getImageMediaType(String ext) {
        return switch (ext) {
            case "png" -> "image/png";
            case "webp" -> "image/webp";
            default -> "image/jpeg";
        };
    }

    public static String stripInvalidXmlChars(String input) {
        if (input == null || input.isEmpty()) return "";
        StringBuilder sb = new StringBuilder(input.length());
        for (int i = 0; i < input.length(); i++) {
            char c = input.charAt(i);
            if (c == 0x9 || c == 0xA || c == 0xD ||
                (c >= 0x20 && c <= 0xD7FF) ||
                (c >= 0xE000 && c <= 0xFFFD)) {
                sb.append(c);
            }
        }
        return sb.toString();
    }

    public static String escapeXmlText(String s) {
        if (s == null) return "";
        return s.replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;");
    }

    private static String escapeXmlAttr(String s) {
        if (s == null) return "";
        return escapeXmlText(s)
                .replace("\"", "&quot;")
                .replace("'", "&apos;");
    }
}
