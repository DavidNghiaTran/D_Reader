package com.dreader.service;

import com.dreader.util.EpubBuilder;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDDocumentInformation;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.interactive.documentnavigation.outline.PDDocumentOutline;
import org.apache.pdfbox.pdmodel.interactive.documentnavigation.outline.PDOutlineItem;
import org.apache.pdfbox.pdmodel.interactive.documentnavigation.outline.PDOutlineNode;
import org.apache.pdfbox.rendering.ImageType;
import org.apache.pdfbox.rendering.PDFRenderer;
import org.apache.pdfbox.text.PDFTextStripper;
import org.apache.poi.ooxml.POIXMLProperties;
import org.apache.poi.xwpf.usermodel.*;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.jsoup.nodes.Node;
import org.jsoup.nodes.TextNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.*;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.CharBuffer;
import java.nio.charset.*;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Unified EPUB Converter:
 * Chuyển đổi các định dạng sách (.pdf, .mobi, .azw3, .txt, .docx) sang chuẩn .epub thống nhất
 * để tận dụng 100% tính năng hiển thị epub.js, Theme/Font, Lưu tiến độ CFI và Đọc TTS Karaoke.
 */
@Service
public class FormatConverterService {

    private static final Logger log = LoggerFactory.getLogger(FormatConverterService.class);

    public static final Set<String> SUPPORTED_EXTENSIONS = Set.of(
            "epub", "pdf", "mobi", "azw3", "txt", "docx"
    );

    private static final int WORDS_PER_FALLBACK_CHAPTER = 4000;

    // Nhận diện tiêu đề chương tiếng Việt & tiếng Anh chính xác (tránh bắt nhầm câu văn như "Phần lớn...", "Chương trình...")
    private static final Pattern CHAPTER_HEADING_PATTERN = Pattern.compile(
            "^(?:" +
            "(?:quyển\\s+[\\dIVXLCDM]+\\s*[-:–—.|]*\\s*)?(?:chương|hồi|tiết|chapter|act)\\s*(?:thứ\\s*)?(?:\\d+|[IVXLCDM]+)(?:[\\s:.\\-–—/]|$).*" +
            "|(?:quyển|phần|part|book)\\s+(?:thứ\\s*)?(?:\\d+|[IVXLCDM]+)(?:[\\s:.\\-–—]|$).*" +
            "|(?:lời\\s+mở\\s+đầu|mở\\s+đầu|văn\\s+án|ngoại\\s+truyện|phiên\\s+ngoại)(?:\\s*\\d+)?(?:[\\s:.\\-–—]|$).*" +
            ")$",
            Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE
    );

    private static final Pattern AUTHOR_LINE_PATTERN = Pattern.compile(
            "^(?:tác\\s*giả|author)\\s*[:\\-–]\\s*(.+)$",
            Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE
    );

    private static final Pattern TITLE_LINE_PATTERN = Pattern.compile(
            "^(?:tên\\s*truyện|tên\\s*sách|tựa\\s*đề|title)\\s*[:\\-–]\\s*(.+)$",
            Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE
    );

    private static final Pattern PAGE_NUMBER_NOISE_PATTERN = Pattern.compile(
            "^\\s*(?:[-–—~*•|]*\\s*)?(?:trang|page|tr\\.)?\\s*\\d{1,5}\\s*(?:/\\s*\\d{1,5})?\\s*(?:[-–—~*•|]*)\\s*$",
            Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE
    );

    @Autowired
    private StorageService storageService;

    public static String detectFormat(String filename) {
        if (filename == null || filename.isBlank()) return null;
        int dot = filename.lastIndexOf('.');
        if (dot < 0 || dot == filename.length() - 1) return null;
        String ext = filename.substring(dot + 1).toLowerCase(Locale.ROOT).trim();
        if (!SUPPORTED_EXTENSIONS.contains(ext)) {
            return null;
        }
        return ext.toUpperCase(Locale.ROOT);
    }

    public static boolean isSupportedFilename(String filename) {
        return detectFormat(filename) != null;
    }

    public static String extractCleanBaseTitle(String filename) {
        if (filename == null || filename.isBlank()) return "Sách mới";
        String name = new File(filename).getName();
        int dot = name.lastIndexOf('.');
        if (dot > 0) {
            name = name.substring(0, dot);
        }
        name = name.replace('_', ' ').replaceAll("\\s+", " ").trim();
        return name.isEmpty() ? "Sách mới" : name;
    }

    public static boolean isChapterHeadingLine(String line) {
        if (line == null) return false;
        String trimmed = line.replace('\u00A0', ' ').trim();
        if (trimmed.isEmpty() || trimmed.length() > 130) return false;
        return CHAPTER_HEADING_PATTERN.matcher(trimmed).matches();
    }

    /**
     * Chuyển đổi file upload (.txt, .pdf, .mobi, .azw3, .docx) sang .epub chuẩn và lưu vào thư mục books.
     * Trả về đường dẫn tuyệt đối của file .epub đã tạo.
     */
    public String convertToEpubAndStore(MultipartFile file, String format) throws IOException {
        String baseTitle = extractCleanBaseTitle(file.getOriginalFilename());
        byte[] rawBytes = file.getBytes();

        String targetFilename = UUID.randomUUID() + ".epub";
        Path targetPath = storageService.getBooksPath().resolve(targetFilename);
        File targetEpubFile = targetPath.toFile();

        log.info("[FormatConverter] Bắt đầu chuyển đổi '{}' (định dạng: {}, {} bytes) -> {}",
                file.getOriginalFilename(), format, rawBytes.length, targetFilename);

        try {
            switch (format.toUpperCase(Locale.ROOT)) {
                case "TXT" -> convertTxtBytesToEpub(rawBytes, baseTitle, targetEpubFile);
                case "PDF" -> convertPdfBytesToEpub(rawBytes, baseTitle, targetEpubFile);
                case "DOCX" -> convertDocxBytesToEpub(rawBytes, baseTitle, targetEpubFile);
                case "MOBI", "AZW3" -> convertMobiBytesToEpub(rawBytes, baseTitle, format.toLowerCase(Locale.ROOT), targetEpubFile);
                default -> throw new IllegalArgumentException("Định dạng chưa được hỗ trợ chuyển đổi: " + format);
            }
        } catch (Exception e) {
            try { Files.deleteIfExists(targetPath); } catch (IOException ignored) {}
            if (e instanceof IOException ioe) throw ioe;
            throw new IOException("Lỗi chuyển đổi định dạng " + format + ": " + e.getMessage(), e);
        }

        log.info("[FormatConverter] Hoàn tất chuyển đổi '{}' -> {} ({} bytes)",
                file.getOriginalFilename(), targetEpubFile.getName(), targetEpubFile.length());
        return targetEpubFile.getAbsolutePath();
    }

    /* =========================================================================
       1. BỘ CHUYỂN ĐỔI .TXT -> .EPUB
       ========================================================================= */
    private void convertTxtBytesToEpub(byte[] rawBytes, String fallbackTitle, File targetEpub) throws IOException {
        String fullText = decodeTextAutoCharset(rawBytes);
        String normalized = fullText.replace("\r\n", "\n").replace('\r', '\n');
        String[] allLines = normalized.split("\n");

        EpubBuilder.BookDraft draft = new EpubBuilder.BookDraft();
        draft.setTitle(fallbackTitle);

        // Quét nhanh 35 dòng đầu tìm Tên truyện / Tác giả
        int scanLimit = Math.min(allLines.length, 35);
        for (int i = 0; i < scanLimit; i++) {
            String line = allLines[i].trim();
            if (line.isEmpty()) continue;
            Matcher tm = TITLE_LINE_PATTERN.matcher(line);
            if (tm.matches() && tm.group(1).trim().length() >= 2) {
                draft.setTitle(tm.group(1).trim());
                continue;
            }
            Matcher am = AUTHOR_LINE_PATTERN.matcher(line);
            if (am.matches() && am.group(1).trim().length() >= 2) {
                draft.setAuthor(am.group(1).trim());
            }
        }

        List<String> paragraphs = new ArrayList<>();
        for (String line : allLines) {
            String trimmed = line.replace('\u00A0', ' ').trim();
            if (!trimmed.isEmpty()) {
                paragraphs.add(trimmed);
            }
        }

        populateChaptersFromParagraphs(draft, paragraphs);
        EpubBuilder.buildEpub(draft, targetEpub);
    }

    /**
     * Tự động nhận diện bảng mã tiếng Việt: BOM (UTF-8 / UTF-16LE / UTF-16BE), UTF-8 chuẩn, hoặc Windows-1258.
     */
    public static String decodeTextAutoCharset(byte[] bytes) {
        if (bytes == null || bytes.length == 0) return "";

        // 1. Kiểm tra BOM
        if (bytes.length >= 3 && (bytes[0] & 0xFF) == 0xEF && (bytes[1] & 0xFF) == 0xBB && (bytes[2] & 0xFF) == 0xBF) {
            return new String(bytes, 3, bytes.length - 3, StandardCharsets.UTF_8);
        }
        if (bytes.length >= 2 && (bytes[0] & 0xFF) == 0xFF && (bytes[1] & 0xFF) == 0xFE) {
            return new String(bytes, 2, bytes.length - 2, StandardCharsets.UTF_16LE);
        }
        if (bytes.length >= 2 && (bytes[0] & 0xFF) == 0xFE && (bytes[1] & 0xFF) == 0xFF) {
            return new String(bytes, 2, bytes.length - 2, StandardCharsets.UTF_16BE);
        }

        // 2. Phát hiện UTF-16 không có BOM dựa trên tỷ lệ byte 0x00
        int sampleLen = Math.min(bytes.length, 4096);
        int evenZeros = 0;
        int oddZeros = 0;
        for (int i = 0; i < sampleLen; i++) {
            if (bytes[i] == 0) {
                if (i % 2 == 0) evenZeros++;
                else oddZeros++;
            }
        }
        if (sampleLen >= 20) {
            if (oddZeros > sampleLen / 4 && evenZeros < sampleLen / 20) {
                return new String(bytes, StandardCharsets.UTF_16LE);
            }
            if (evenZeros > sampleLen / 4 && oddZeros < sampleLen / 20) {
                return new String(bytes, StandardCharsets.UTF_16BE);
            }
        }

        // 3. Kiểm tra UTF-8 nghiêm ngặt
        CharsetDecoder utf8Decoder = StandardCharsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT);
        try {
            CharBuffer decoded = utf8Decoder.decode(ByteBuffer.wrap(bytes));
            return decoded.toString();
        } catch (CharacterCodingException ignored) {
            // Không phải UTF-8 hợp lệ -> thử Windows-1258 (tiếng Việt ANSI)
        }

        try {
            return new String(bytes, Charset.forName("windows-1258"));
        } catch (Exception e) {
            return new String(bytes, StandardCharsets.ISO_8859_1);
        }
    }

    /* =========================================================================
       2. BỘ CHUYỂN ĐỔI .PDF -> .EPUB (PDFBox 3.0.1)
       ========================================================================= */
    private static class PdfBookmarkEntry {
        final String title;
        final int pageIndex; // 0-based

        PdfBookmarkEntry(String title, int pageIndex) {
            this.title = title;
            this.pageIndex = pageIndex;
        }
    }

    private void convertPdfBytesToEpub(byte[] pdfBytes, String fallbackTitle, File targetEpub) throws IOException {
        EpubBuilder.BookDraft draft = new EpubBuilder.BookDraft();
        draft.setTitle(fallbackTitle);

        try (PDDocument document = Loader.loadPDF(pdfBytes)) {
            int totalPages = document.getNumberOfPages();
            if (totalPages == 0) {
                draft.addChapter(fallbackTitle, "<p>Tệp PDF không có trang nào.</p>");
                EpubBuilder.buildEpub(draft, targetEpub);
                return;
            }

            // 1. Đọc Metadata từ PDF
            PDDocumentInformation info = document.getDocumentInformation();
            if (info != null) {
                if (isUsefulMetadataTitle(info.getTitle())) {
                    draft.setTitle(info.getTitle().trim());
                }
                if (info.getAuthor() != null && !info.getAuthor().isBlank()) {
                    draft.setAuthor(info.getAuthor().trim());
                }
                if (info.getSubject() != null && !info.getSubject().isBlank()) {
                    draft.setDescription(info.getSubject().trim());
                }
            }

            // 2. Render trang 1 làm ảnh bìa chất lượng cao
            try {
                PDFRenderer renderer = new PDFRenderer(document);
                BufferedImage coverImg = renderer.renderImageWithDPI(0, 140f, ImageType.RGB);
                ByteArrayOutputStream baos = new ByteArrayOutputStream();
                ImageIO.write(coverImg, "jpg", baos);
                if (baos.size() > 500) {
                    draft.setCoverBytes(baos.toByteArray());
                    draft.setCoverExtension("jpg");
                }
            } catch (Exception e) {
                log.warn("[FormatConverter] Không thể trích ảnh bìa trang 1 của PDF: {}", e.getMessage());
            }

            // 3. Trích xuất văn bản từng trang & lọc rác header/footer + nối câu bị ngắt dòng
            PDFTextStripper stripper = new PDFTextStripper();
            stripper.setSortByPosition(true);
            List<List<String>> pageParagraphs = new ArrayList<>(totalPages);
            for (int p = 1; p <= totalPages; p++) {
                stripper.setStartPage(p);
                stripper.setEndPage(p);
                String rawPageText = stripper.getText(document);
                pageParagraphs.add(reflowPdfPageText(rawPageText));
            }

            // 4. Ưu tiên 1: Chia chương theo PDDocumentOutline (Bookmark mục lục có sẵn của PDF)
            List<PdfBookmarkEntry> outlineEntries = extractPdfBookmarks(document);
            if (outlineEntries.size() >= 2) {
                for (int i = 0; i < outlineEntries.size(); i++) {
                    PdfBookmarkEntry cur = outlineEntries.get(i);
                    int startPage = Math.max(0, Math.min(cur.pageIndex, totalPages - 1));
                    int endPage = (i + 1 < outlineEntries.size())
                            ? Math.max(startPage, Math.min(outlineEntries.get(i + 1).pageIndex - 1, totalPages - 1))
                            : (totalPages - 1);
                    // Trường hợp 2 mục lục cùng nằm trên 1 trang hoặc sát nhau
                    if (i + 1 < outlineEntries.size() && outlineEntries.get(i + 1).pageIndex == cur.pageIndex) {
                        endPage = startPage;
                    }

                    List<String> chapParas = new ArrayList<>();
                    for (int p = startPage; p <= endPage; p++) {
                        chapParas.addAll(pageParagraphs.get(p));
                    }
                    if (!chapParas.isEmpty()) {
                        appendChapterWithChunkingIfHuge(draft, cur.title, chapParas);
                    }
                }
            }

            // 5. Ưu tiên 2: Nếu PDF không có Outline (hoặc rỗng), quét Regex tiêu đề chương / chia cụm từ
            if (draft.getChapters().isEmpty()) {
                List<String> allParas = new ArrayList<>();
                for (List<String> pList : pageParagraphs) {
                    allParas.addAll(pList);
                }
                if (allParas.isEmpty()) {
                    draft.addChapter(draft.getTitle(),
                            "<p>Tệp PDF này chỉ chứa hình ảnh scan (chưa có lớp văn bản OCR) nên không thể trích xuất chữ.</p>");
                } else {
                    populateChaptersFromParagraphs(draft, allParas);
                }
            }
        }

        EpubBuilder.buildEpub(draft, targetEpub);
    }

    private List<PdfBookmarkEntry> extractPdfBookmarks(PDDocument document) {
        List<PdfBookmarkEntry> list = new ArrayList<>();
        try {
            PDDocumentOutline outline = document.getDocumentCatalog().getDocumentOutline();
            if (outline == null) return list;
            collectOutlineItems(outline, document, list, 0);
        } catch (Exception e) {
            log.debug("[FormatConverter] Bỏ qua outline PDF lỗi: {}", e.getMessage());
        }
        // Sắp xếp theo thứ tự trang và loại bỏ mục trùng trang + tiêu đề rỗng
        list.sort(Comparator.comparingInt(a -> a.pageIndex));
        return list;
    }

    private void collectOutlineItems(PDOutlineNode node, PDDocument doc, List<PdfBookmarkEntry> out, int depth) {
        if (node == null || depth > 2) return;
        PDOutlineItem current = node.getFirstChild();
        while (current != null) {
            try {
                String title = current.getTitle() != null ? current.getTitle().replaceAll("\\s+", " ").trim() : "";
                PDPage page = current.findDestinationPage(doc);
                if (page != null && !title.isEmpty()) {
                    int idx = doc.getPages().indexOf(page);
                    if (idx >= 0) {
                        out.add(new PdfBookmarkEntry(title, idx));
                    }
                }
                // Nếu chỉ có 1 nút gốc bao ngoài (vd tên sách) thì đào xuống cấp con
                if (depth < 1 && current.hasChildren()) {
                    collectOutlineItems(current, doc, out, depth + 1);
                }
            } catch (Exception ignored) {
            }
            current = current.getNextSibling();
        }
    }

    /**
     * Lọc số trang ở đầu/cuối trang PDF và ghép nối các dòng bị ngắt cứng giữa câu thành đoạn văn tự nhiên.
     */
    private List<String> reflowPdfPageText(String rawPageText) {
        List<String> paragraphs = new ArrayList<>();
        if (rawPageText == null || rawPageText.isBlank()) return paragraphs;

        String[] rawLines = rawPageText.replace("\r\n", "\n").replace('\r', '\n').split("\n");
        List<String> cleanLines = new ArrayList<>();

        for (int i = 0; i < rawLines.length; i++) {
            String trimmed = rawLines[i].replace('\u00A0', ' ').trim();
            if (trimmed.isEmpty()) {
                cleanLines.add(""); // Giữ dòng trống làm ranh giới đoạn
                continue;
            }
            // Lọc số trang rác ở 2 dòng đầu hoặc 2 dòng cuối mỗi trang PDF
            if ((i <= 1 || i >= rawLines.length - 2) && PAGE_NUMBER_NOISE_PATTERN.matcher(trimmed).matches()) {
                continue;
            }
            // Khử gạch nối ngắt từ cuối dòng tiếng Anh/Việt scan
            cleanLines.add(trimmed);
        }

        StringBuilder currentPara = new StringBuilder();
        for (String line : cleanLines) {
            if (line.isEmpty()) {
                flushBuilderToList(currentPara, paragraphs);
                continue;
            }

            if (isChapterHeadingLine(line)) {
                flushBuilderToList(currentPara, paragraphs);
                paragraphs.add(line);
                continue;
            }

            // Bắt đầu dòng thoại mới hoặc mục danh sách -> ngắt đoạn mới
            if (startsNewParagraphNaturally(line)) {
                flushBuilderToList(currentPara, paragraphs);
                currentPara.append(line);
                continue;
            }

            if (currentPara.length() == 0) {
                currentPara.append(line);
            } else {
                char lastChar = currentPara.charAt(currentPara.length() - 1);
                if (endsSentenceClearly(lastChar) && Character.isUpperCase(line.charAt(0))) {
                    flushBuilderToList(currentPara, paragraphs);
                    currentPara.append(line);
                } else {
                    currentPara.append(' ').append(line);
                }
            }
        }
        flushBuilderToList(currentPara, paragraphs);
        return paragraphs;
    }

    private static boolean startsNewParagraphNaturally(String line) {
        if (line.isEmpty()) return false;
        char first = line.charAt(0);
        return first == '-' || first == '–' || first == '—' || first == '•'
                || first == '"' || first == '“' || first == '«';
    }

    private static boolean endsSentenceClearly(char c) {
        return c == '.' || c == '!' || c == '?' || c == '…' || c == ':' || c == '”' || c == '"';
    }

    private static void flushBuilderToList(StringBuilder sb, List<String> out) {
        if (sb.length() > 0) {
            String text = sb.toString().replaceAll("\\s+", " ").trim();
            if (!text.isEmpty()) {
                out.add(text);
            }
            sb.setLength(0);
        }
    }

    /* =========================================================================
       3. BỘ CHUYỂN ĐỔI .DOCX -> .EPUB (Apache POI 5.2.5)
       ========================================================================= */
    private void convertDocxBytesToEpub(byte[] docxBytes, String fallbackTitle, File targetEpub) throws IOException {
        EpubBuilder.BookDraft draft = new EpubBuilder.BookDraft();
        draft.setTitle(fallbackTitle);

        try (XWPFDocument doc = new XWPFDocument(new ByteArrayInputStream(docxBytes))) {
            // 1. Metadata từ CoreProperties
            try {
                POIXMLProperties.CoreProperties props = doc.getProperties().getCoreProperties();
                if (props != null) {
                    if (isUsefulMetadataTitle(props.getTitle())) {
                        draft.setTitle(props.getTitle().trim());
                    }
                    if (props.getCreator() != null && !props.getCreator().isBlank()) {
                        draft.setAuthor(props.getCreator().trim());
                    }
                    if (props.getDescription() != null && !props.getDescription().isBlank()) {
                        draft.setDescription(props.getDescription().trim());
                    }
                }
            } catch (Exception ignored) {
            }

            // 2. Ảnh bìa từ ảnh đầu tiên (nếu đủ lớn)
            try {
                for (XWPFPictureData pic : doc.getAllPictures()) {
                    byte[] data = pic.getData();
                    String ext = pic.suggestFileExtension();
                    if (data != null && data.length >= 4096 && isSupportedCoverExt(ext)) {
                        draft.setCoverBytes(data);
                        draft.setCoverExtension(ext);
                        break;
                    }
                }
            } catch (Exception ignored) {
            }

            // 3. Duyệt các phần tử văn bản & nhận diện Heading 1/2 hoặc Regex Chương
            String currentTitle = null;
            List<String> currentParas = new ArrayList<>();
            List<String> allFallbackParas = new ArrayList<>();
            boolean foundExplicitHeading = false;

            for (IBodyElement elem : doc.getBodyElements()) {
                if (elem instanceof XWPFParagraph para) {
                    String text = para.getText();
                    if (text == null) continue;
                    String trimmed = text.replace('\u00A0', ' ').trim();
                    if (trimmed.isEmpty()) continue;

                    allFallbackParas.add(trimmed);

                    boolean isHeading = isDocxHeadingParagraph(para) || isChapterHeadingLine(trimmed);
                    if (isHeading && trimmed.length() <= 140) {
                        foundExplicitHeading = true;
                        if (!currentParas.isEmpty()) {
                            String chTitle = currentTitle != null ? currentTitle : "Mở đầu";
                            appendChapterWithChunkingIfHuge(draft, chTitle, currentParas);
                            currentParas.clear();
                        }
                        currentTitle = trimmed;
                    } else {
                        currentParas.add(trimmed);
                    }
                } else if (elem instanceof XWPFTable table) {
                    for (XWPFTableRow row : table.getRows()) {
                        StringBuilder rowText = new StringBuilder();
                        for (XWPFTableCell cell : row.getTableCells()) {
                            String ct = cell.getText();
                            if (ct != null && !ct.isBlank()) {
                                if (rowText.length() > 0) rowText.append(" | ");
                                rowText.append(ct.trim());
                            }
                        }
                        if (rowText.length() > 0) {
                            String line = rowText.toString();
                            currentParas.add(line);
                            allFallbackParas.add(line);
                        }
                    }
                }
            }

            if (foundExplicitHeading) {
                if (!currentParas.isEmpty()) {
                    appendChapterWithChunkingIfHuge(draft, currentTitle != null ? currentTitle : draft.getTitle(), currentParas);
                }
            } else {
                populateChaptersFromParagraphs(draft, allFallbackParas);
            }
        }

        EpubBuilder.buildEpub(draft, targetEpub);
    }

    private boolean isDocxHeadingParagraph(XWPFParagraph para) {
        String style = para.getStyle();
        if (style != null) {
            String s = style.toLowerCase(Locale.ROOT);
            if (s.startsWith("heading1") || s.startsWith("heading 1")
                    || s.startsWith("heading2") || s.startsWith("heading 2")
                    || s.equals("1") || s.equals("2")) {
                return true;
            }
        }
        try {
            if (para.getCTP() != null && para.getCTP().getPPr() != null && para.getCTP().getPPr().getOutlineLvl() != null) {
                int lvl = para.getCTP().getPPr().getOutlineLvl().getVal().intValue();
                return lvl >= 0 && lvl <= 1;
            }
        } catch (Exception ignored) {
        }
        return false;
    }

    /* =========================================================================
       4. BỘ CHUYỂN ĐỔI .MOBI / .AZW3 -> .EPUB
          (Ưu tiên Calibre ebook-convert nếu có, Fallback bộ giải mã PalmDOC/MOBI thuần Java)
       ========================================================================= */
    private void convertMobiBytesToEpub(byte[] mobiBytes, String fallbackTitle, String ext, File targetEpub) throws IOException {
        // 1. Thử gọi Calibre CLI (ebook-convert) nếu máy người dùng có cài sẵn
        if (tryCalibreCliConvert(mobiBytes, ext, targetEpub)) {
            log.info("[FormatConverter] Đã chuyển đổi {} bằng Calibre ebook-convert thành công.", ext.toUpperCase());
            return;
        }

        // 2. Giải mã trực tiếp bằng bộ giải mã PalmDOC / MOBI / AZW3 thuần Java
        EpubBuilder.BookDraft draft = parseMobiPureJava(mobiBytes, fallbackTitle);
        EpubBuilder.buildEpub(draft, targetEpub);
    }

    private boolean tryCalibreCliConvert(byte[] inputBytes, String ext, File targetEpub) {
        List<String> candidates = List.of(
                "ebook-convert",
                "C:\\Program Files\\Calibre2\\ebook-convert.exe",
                "C:\\Program Files (x86)\\Calibre2\\ebook-convert.exe"
        );

        String exeToUse = null;
        for (String cmd : candidates) {
            if (cmd.contains("\\")) {
                if (new File(cmd).isFile()) {
                    exeToUse = cmd;
                    break;
                }
            } else {
                try {
                    Process check = new ProcessBuilder(cmd, "--version")
                            .redirectErrorStream(true)
                            .start();
                    if (check.waitFor(4, TimeUnit.SECONDS) && check.exitValue() == 0) {
                        exeToUse = cmd;
                        break;
                    }
                } catch (Exception ignored) {
                }
            }
        }

        if (exeToUse == null) return false;

        Path tempInput = null;
        try {
            tempInput = Files.createTempFile("dreader_src_", "." + ext);
            Files.write(tempInput, inputBytes);

            Process proc = new ProcessBuilder(
                    exeToUse,
                    tempInput.toAbsolutePath().toString(),
                    targetEpub.getAbsolutePath()
            ).redirectErrorStream(true).start();

            // Đọc hết stdout để tránh treo buffer tiến trình
            try (InputStream is = proc.getInputStream()) {
                is.transferTo(OutputStream.nullOutputStream());
            }

            boolean finished = proc.waitFor(90, TimeUnit.SECONDS);
            if (!finished) {
                proc.destroyForcibly();
                return false;
            }
            return proc.exitValue() == 0 && targetEpub.exists() && targetEpub.length() > 512;
        } catch (Exception e) {
            log.debug("[FormatConverter] Calibre CLI không khả dụng: {}", e.getMessage());
            return false;
        } finally {
            if (tempInput != null) {
                try { Files.deleteIfExists(tempInput); } catch (IOException ignored) {}
            }
        }
    }

    /**
     * Bộ giải mã nhị phân PalmDOC / MOBI / AZW3 (KF8) thuần Java 17.
     */
    private EpubBuilder.BookDraft parseMobiPureJava(byte[] data, String fallbackTitle) throws IOException {
        if (data == null || data.length < 86) {
            throw new IOException("Tệp MOBI/AZW3 không hợp lệ hoặc bị hỏng (kích thước quá nhỏ).");
        }

        ByteBuffer buf = ByteBuffer.wrap(data).order(ByteOrder.BIG_ENDIAN);
        String pdbTypeCreator = new String(data, 60, 8, StandardCharsets.US_ASCII);
        if (!pdbTypeCreator.equals("BOOKMOBI") && !pdbTypeCreator.equals("TEXtREAd")) {
            throw new IOException("Tệp không đúng cấu trúc chuẩn PalmDOC / MOBI (" + pdbTypeCreator + ").");
        }

        int numRecords = buf.getShort(76) & 0xFFFF;
        if (numRecords < 2 || 78 + numRecords * 8 > data.length) {
            throw new IOException("Bảng bản ghi PDB trong tệp MOBI/AZW3 không hợp lệ.");
        }

        int[] recordOffsets = new int[numRecords];
        for (int i = 0; i < numRecords; i++) {
            recordOffsets[i] = buf.getInt(78 + i * 8);
        }

        EpubBuilder.BookDraft draft = new EpubBuilder.BookDraft();
        draft.setTitle(fallbackTitle);

        // Kiểm tra xem đây có phải file Combo MOBI + KF8 (AZW3) không (tìm BOUNDARY record nếu section 0 quá ngắn)
        int headerRecIdx = 0;
        MobiSectionInfo primaryInfo = readMobiHeaderSection(data, recordOffsets, 0);

        // Nếu file AZW3 thuần KF8 mà section 0 chỉ là stub ngắn, dò tìm section KF8 sau BOUNDARY
        if (primaryInfo.textRecordCount <= 2 && numRecords > 6) {
            for (int r = 1; r < numRecords - 2; r++) {
                byte[] rec = sliceRecord(data, recordOffsets, r);
                if (rec.length == 8 && "BOUNDARY".equals(new String(rec, StandardCharsets.US_ASCII))) {
                    MobiSectionInfo kf8Info = readMobiHeaderSection(data, recordOffsets, r + 1);
                    if (kf8Info.textRecordCount > primaryInfo.textRecordCount && kf8Info.compression != 17480) {
                        headerRecIdx = r + 1;
                        primaryInfo = kf8Info;
                    }
                    break;
                }
            }
        }

        if (primaryInfo.encryptionType != 0) {
            throw new IOException("Sách MOBI/AZW3 này đang bị khóa bản quyền DRM (Encryption=" + primaryInfo.encryptionType + ").");
        }
        if (primaryInfo.compression == 17480) {
            throw new IOException("Tệp MOBI/AZW3 sử dụng nén HUFF/CDIC hiếm gặp. Vui lòng cài đặt Calibre (ebook-convert) để tự động giải mã định dạng này.");
        }

        if (primaryInfo.title != null && !primaryInfo.title.isBlank()) {
            draft.setTitle(primaryInfo.title.trim());
        }
        if (primaryInfo.author != null && !primaryInfo.author.isBlank()) {
            draft.setAuthor(primaryInfo.author.trim());
        }
        if (primaryInfo.description != null && !primaryInfo.description.isBlank()) {
            draft.setDescription(primaryInfo.description.trim());
        }

        // Trích xuất ảnh bìa từ bản ghi PDB nếu có firstImageIndex + coverOffset
        if (primaryInfo.firstImageIndex > 0) {
            int candidateIdx = headerRecIdx + primaryInfo.firstImageIndex + Math.max(0, primaryInfo.coverOffset);
            if (candidateIdx > headerRecIdx && candidateIdx < numRecords) {
                byte[] imgBytes = sliceRecord(data, recordOffsets, candidateIdx);
                String imgExt = detectImageMagicExt(imgBytes);
                if (imgExt != null) {
                    draft.setCoverBytes(imgBytes);
                    draft.setCoverExtension(imgExt);
                }
            }
            // Fallback quét vài bản ghi ảnh đầu tiên nếu coverOffset không trỏ trúng ảnh
            if (draft.getCoverBytes() == null) {
                int startImg = headerRecIdx + primaryInfo.firstImageIndex;
                int maxScan = Math.min(numRecords, startImg + 8);
                for (int idx = startImg; idx < maxScan; idx++) {
                    byte[] imgBytes = sliceRecord(data, recordOffsets, idx);
                    if (imgBytes.length >= 4096) {
                        String imgExt = detectImageMagicExt(imgBytes);
                        if (imgExt != null) {
                            draft.setCoverBytes(imgBytes);
                            draft.setCoverExtension(imgExt);
                            break;
                        }
                    }
                }
            }
        }

        // Giải nén toàn bộ các bản ghi văn bản (headerRecIdx + 1 .. headerRecIdx + textRecordCount)
        ByteArrayOutputStream rawTextOut = new ByteArrayOutputStream(Math.min(data.length * 2, 16 * 1024 * 1024));
        int maxTextRec = Math.min(numRecords - 1, headerRecIdx + primaryInfo.textRecordCount);
        for (int r = headerRecIdx + 1; r <= maxTextRec; r++) {
            byte[] recBytes = sliceRecord(data, recordOffsets, r);
            if (recBytes.length == 0) continue;
            byte[] trimmedRec = trimMobiTrailingExtraData(recBytes, primaryInfo.extraDataFlags);
            if (primaryInfo.compression == 2) {
                byte[] decompressed = decompressPalmDocLz77(trimmedRec);
                rawTextOut.write(decompressed);
            } else if (primaryInfo.compression == 1) {
                rawTextOut.write(trimmedRec);
            }
        }

        Charset charset = (primaryInfo.textEncoding == 65001)
                ? StandardCharsets.UTF_8
                : Charset.forName("windows-1252");
        String decodedStream = new String(rawTextOut.toByteArray(), charset);

        populateChaptersFromMobiHtmlStream(draft, decodedStream);
        return draft;
    }

    private static class MobiSectionInfo {
        int compression = 1;
        int encryptionType = 0;
        int textRecordCount = 0;
        int textEncoding = 65001;
        int firstImageIndex = -1;
        int coverOffset = -1;
        int extraDataFlags = 0;
        String title;
        String author;
        String description;
    }

    private MobiSectionInfo readMobiHeaderSection(byte[] data, int[] offsets, int recIdx) {
        MobiSectionInfo info = new MobiSectionInfo();
        byte[] rec0 = sliceRecord(data, offsets, recIdx);
        if (rec0.length < 16) return info;

        ByteBuffer b = ByteBuffer.wrap(rec0).order(ByteOrder.BIG_ENDIAN);
        info.compression = b.getShort(0) & 0xFFFF;
        info.textRecordCount = b.getShort(8) & 0xFFFF;
        info.encryptionType = b.getShort(12) & 0xFFFF;

        if (rec0.length >= 132 && "MOBI".equals(new String(rec0, 16, 4, StandardCharsets.US_ASCII))) {
            int mobiHeaderLen = b.getInt(20);
            info.textEncoding = b.getInt(28);
            Charset metaCharset = (info.textEncoding == 65001) ? StandardCharsets.UTF_8 : Charset.forName("windows-1252");

            int fullNameOffset = b.getInt(84);
            int fullNameLen = b.getInt(88);
            if (fullNameOffset > 0 && fullNameLen > 0 && fullNameOffset + fullNameLen <= rec0.length) {
                info.title = new String(rec0, fullNameOffset, fullNameLen, metaCharset).trim();
            }

            if (rec0.length >= 112) {
                info.firstImageIndex = b.getInt(108);
            }

            if (mobiHeaderLen >= 228 && rec0.length >= 244) {
                info.extraDataFlags = b.getShort(242) & 0xFFFF;
            }

            int exthFlags = b.getInt(128);
            int exthStart = 16 + mobiHeaderLen;
            if ((exthFlags & 0x40) != 0 && exthStart + 12 <= rec0.length
                    && "EXTH".equals(new String(rec0, exthStart, 4, StandardCharsets.US_ASCII))) {
                int exthCount = b.getInt(exthStart + 8);
                int pos = exthStart + 12;
                for (int i = 0; i < exthCount && pos + 8 <= rec0.length; i++) {
                    int type = b.getInt(pos);
                    int len = b.getInt(pos + 4);
                    if (len < 8 || pos + len > rec0.length) break;
                    int payloadLen = len - 8;
                    if (type == 100 && payloadLen > 0) {
                        info.author = new String(rec0, pos + 8, payloadLen, metaCharset).trim();
                    } else if (type == 103 && payloadLen > 0) {
                        info.description = Jsoup.parse(new String(rec0, pos + 8, payloadLen, metaCharset)).text().trim();
                    } else if (type == 503 && payloadLen > 0) {
                        String exthTitle = new String(rec0, pos + 8, payloadLen, metaCharset).trim();
                        if (!exthTitle.isEmpty()) info.title = exthTitle;
                    } else if (type == 201 && payloadLen == 4) {
                        info.coverOffset = b.getInt(pos + 8);
                    }
                    pos += len;
                }
            }
        }
        return info;
    }

    private static byte[] sliceRecord(byte[] data, int[] offsets, int idx) {
        int start = offsets[idx];
        int end = (idx + 1 < offsets.length) ? offsets[idx + 1] : data.length;
        if (start < 0 || start >= data.length || end <= start) return new byte[0];
        end = Math.min(end, data.length);
        return Arrays.copyOfRange(data, start, end);
    }

    /**
     * Cắt bỏ các byte cờ phụ (trailing data entries & multibyte overlap) ở cuối mỗi bản ghi MOBI trước khi giải nén LZ77.
     */
    private static byte[] trimMobiTrailingExtraData(byte[] rec, int extraDataFlags) {
        if (extraDataFlags == 0 || rec.length == 0) return rec;
        int size = rec.length;

        int flags = extraDataFlags >> 1;
        while (flags != 0) {
            if ((flags & 1) != 0 && size > 0) {
                int num = 0;
                int shift = 0;
                // Variable-width backward integer
                while (size > 0 && shift < 28) {
                    byte b = rec[--size];
                    num |= (b & 0x7F) << shift;
                    shift += 7;
                    if ((b & 0x80) != 0) break;
                }
                int alreadyRead = shift / 7;
                int remainingToSkip = num - alreadyRead;
                if (remainingToSkip > 0 && remainingToSkip <= size) {
                    size -= remainingToSkip;
                }
            }
            flags >>= 1;
        }

        if ((extraDataFlags & 1) != 0 && size > 0) {
            int overlap = (rec[size - 1] & 0x03) + 1;
            if (overlap <= size) {
                size -= overlap;
            }
        }

        return size == rec.length ? rec : Arrays.copyOf(rec, Math.max(0, size));
    }

    /**
     * Giải nén chuẩn PalmDOC LZ77.
     */
    public static byte[] decompressPalmDocLz77(byte[] in) {
        ByteArrayOutputStream out = new ByteArrayOutputStream(in.length * 2);
        int i = 0;
        while (i < in.length) {
            int b = in[i++] & 0xFF;
            if (b == 0x00) {
                out.write(0x00);
            } else if (b >= 0x01 && b <= 0x08) {
                int count = Math.min(b, in.length - i);
                out.write(in, i, count);
                i += count;
            } else if (b <= 0x7F) {
                out.write(b);
            } else if (b >= 0xC0) {
                out.write(' ');
                out.write(b ^ 0x80);
            } else {
                // 0x80..0xBF: Cặp khoảng cách - độ dài (LZ77)
                if (i >= in.length) break;
                int next = in[i++] & 0xFF;
                int pair = (b << 8) | next;
                int distance = (pair >> 3) & 0x07FF;
                int length = (pair & 0x07) + 3;
                byte[] currentBuf = out.toByteArray();
                int copyPos = currentBuf.length - distance;
                if (distance > 0 && copyPos >= 0) {
                    for (int k = 0; k < length; k++) {
                        int srcIdx = copyPos + k;
                        if (srcIdx < currentBuf.length) {
                            out.write(currentBuf[srcIdx]);
                        } else {
                            // Trường hợp khoảng cách nhỏ hơn độ dài lặp (run-length overlap)
                            byte[] updated = out.toByteArray();
                            out.write(updated[srcIdx]);
                            currentBuf = updated;
                        }
                    }
                }
            }
        }
        return out.toByteArray();
    }

    private void populateChaptersFromMobiHtmlStream(EpubBuilder.BookDraft draft, String htmlStream) {
        if (htmlStream == null || htmlStream.isBlank()) {
            draft.addChapter(draft.getTitle(), "<p>Không trích xuất được nội dung văn bản từ tệp MOBI/AZW3.</p>");
            return;
        }

        // Chuẩn hóa ngắt trang đặc thù của Mobipocket (<mbp:pagebreak/>) thành dấu phân tách rõ ràng
        String normalized = htmlStream
                .replaceAll("(?i)<mbp:pagebreak\\s*/?>", "<hr data-mobi-break=\"1\"/>")
                .replaceAll("(?i)</mbp:pagebreak>", "");

        Document doc = Jsoup.parse(normalized);
        doc.select("script, style, head, guide, reference").remove();

        List<String> extractedLines = new ArrayList<>();
        extractBlockLinesFromDom(doc.body(), extractedLines);

        if (extractedLines.isEmpty()) {
            String plain = doc.text().trim();
            if (!plain.isEmpty()) {
                extractedLines.add(plain);
            }
        }

        populateChaptersFromParagraphs(draft, extractedLines);
    }

    private void extractBlockLinesFromDom(Element root, List<String> outLines) {
        if (root == null) return;
        StringBuilder inlineBuf = new StringBuilder();

        for (Node child : root.childNodes()) {
            if (child instanceof TextNode tn) {
                String t = tn.text();
                if (!t.isBlank()) {
                    if (inlineBuf.length() > 0) inlineBuf.append(' ');
                    inlineBuf.append(t.trim());
                }
            } else if (child instanceof Element el) {
                String tag = el.tagName().toLowerCase(Locale.ROOT);
                if (tag.equals("br")) {
                    flushBuilderToList(inlineBuf, outLines);
                } else if (tag.equals("p") || tag.equals("div") || tag.equals("li")
                        || tag.equals("blockquote") || tag.equals("h1") || tag.equals("h2")
                        || tag.equals("h3") || tag.equals("h4")) {
                    flushBuilderToList(inlineBuf, outLines);
                    // Nếu bên trong div/p còn chứa các thẻ khối con khác thì đệ quy xuống
                    if (!el.select("p, div, h1, h2, h3, br").isEmpty() && (tag.equals("div") || tag.equals("blockquote"))) {
                        extractBlockLinesFromDom(el, outLines);
                    } else {
                        String text = el.text().replace('\u00A0', ' ').trim();
                        if (!text.isEmpty()) {
                            // Đánh dấu thẻ h1/h2 ngắn làm ứng viên tiêu đề chương
                            if ((tag.equals("h1") || tag.equals("h2") || tag.equals("h3")) && text.length() <= 130 && !isWrapperTocHeading(text)) {
                                outLines.add("@@HEADING@@" + text);
                            } else {
                                outLines.add(text);
                            }
                        }
                    }
                } else {
                    String t = el.text().trim();
                    if (!t.isEmpty()) {
                        if (inlineBuf.length() > 0) inlineBuf.append(' ');
                        inlineBuf.append(t);
                    }
                }
            }
        }
        flushBuilderToList(inlineBuf, outLines);
    }

    /* =========================================================================
       HÀM DÙNG CHUNG: CHIA CHƯƠNG THÔNG MINH & CHUNKING 4.000 TỪ
       ========================================================================= */
    private void populateChaptersFromParagraphs(EpubBuilder.BookDraft draft, List<String> paragraphs) {
        if (paragraphs == null || paragraphs.isEmpty()) {
            draft.addChapter(draft.getTitle(), "<p>Nội dung trống.</p>");
            return;
        }

        String currentTitle = null;
        List<String> currentParas = new ArrayList<>();
        int detectedChapterCount = 0;

        for (String rawPara : paragraphs) {
            boolean forcedHeading = rawPara.startsWith("@@HEADING@@");
            String para = forcedHeading ? rawPara.substring("@@HEADING@@".length()).trim() : rawPara.trim();
            if (para.isEmpty()) continue;

            if (forcedHeading || isChapterHeadingLine(para)) {
                // Tránh tách chương rỗng liên tiếp nếu sách có mục lục dạng text ở đầu file
                if (!currentParas.isEmpty()) {
                    String titleToSave = currentTitle != null ? currentTitle : "Mở đầu";
                    appendChapterWithChunkingIfHuge(draft, titleToSave, currentParas);
                    currentParas.clear();
                }
                currentTitle = para;
                detectedChapterCount++;
            } else {
                currentParas.add(para);
            }
        }

        if (!currentParas.isEmpty()) {
            if (detectedChapterCount > 0 && currentTitle != null) {
                appendChapterWithChunkingIfHuge(draft, currentTitle, currentParas);
            } else {
                // Không phát hiện tiêu đề chương nào -> Tự động chia mỗi 4.000 từ / chương
                splitIntoWordCountChapters(draft, currentParas, WORDS_PER_FALLBACK_CHAPTER, "Phần ");
            }
        }
    }

    private void appendChapterWithChunkingIfHuge(EpubBuilder.BookDraft draft, String title, List<String> paras) {
        int totalWords = 0;
        for (String p : paras) {
            totalWords += countWords(p);
        }
        // Nếu 1 chương quá khổng lồ (> 15.000 từ) do thiếu tiêu đề tiếp theo, chia nhỏ thành Phần phụ để epub.js mượt
        if (totalWords > 15000) {
            List<String> chunk = new ArrayList<>();
            int chunkWords = 0;
            int subPart = 1;
            for (String p : paras) {
                chunk.add(p);
                chunkWords += countWords(p);
                if (chunkWords >= WORDS_PER_FALLBACK_CHAPTER) {
                    String subTitle = subPart == 1 ? title : (title + " (Tiếp " + subPart + ")");
                    draft.addChapter(subTitle, paragraphsListToHtml(chunk));
                    chunk.clear();
                    chunkWords = 0;
                    subPart++;
                }
            }
            if (!chunk.isEmpty()) {
                String subTitle = subPart == 1 ? title : (title + " (Tiếp " + subPart + ")");
                draft.addChapter(subTitle, paragraphsListToHtml(chunk));
            }
        } else {
            draft.addChapter(title, paragraphsListToHtml(paras));
        }
    }

    private void splitIntoWordCountChapters(EpubBuilder.BookDraft draft, List<String> paras, int maxWordsPerChap, String prefix) {
        List<String> chunk = new ArrayList<>();
        int wordCount = 0;
        int partIdx = 1;

        for (String p : paras) {
            chunk.add(p);
            wordCount += countWords(p);
            if (wordCount >= maxWordsPerChap) {
                draft.addChapter(prefix + partIdx, paragraphsListToHtml(chunk));
                chunk.clear();
                wordCount = 0;
                partIdx++;
            }
        }
        if (!chunk.isEmpty()) {
            if (partIdx == 1) {
                draft.addChapter(draft.getTitle(), paragraphsListToHtml(chunk));
            } else {
                draft.addChapter(prefix + partIdx, paragraphsListToHtml(chunk));
            }
        }
    }

    private static String paragraphsListToHtml(List<String> paras) {
        StringBuilder sb = new StringBuilder();
        for (String p : paras) {
            String trimmed = p.trim();
            if (!trimmed.isEmpty()) {
                sb.append("<p>").append(EpubBuilder.escapeXmlText(trimmed)).append("</p>\n");
            }
        }
        return sb.length() > 0 ? sb.toString() : "<p></p>";
    }

    private static int countWords(String s) {
        if (s == null || s.isBlank()) return 0;
        int count = 0;
        boolean inWord = false;
        for (int i = 0; i < s.length(); i++) {
            if (Character.isWhitespace(s.charAt(i))) {
                inWord = false;
            } else if (!inWord) {
                inWord = true;
                count++;
            }
        }
        return count;
    }

    private static boolean isUsefulMetadataTitle(String t) {
        if (t == null || t.isBlank()) return false;
        String lower = t.trim().toLowerCase(Locale.ROOT);
        return !lower.equals("untitled")
                && !lower.startsWith("microsoft word")
                && !lower.equals("unknown")
                && !lower.equals("document");
    }

    private static boolean isWrapperTocHeading(String text) {
        String lower = text.trim().toLowerCase(Locale.ROOT);
        return lower.equals("mục lục") || lower.equals("table of contents") || lower.equals("contents");
    }

    private static boolean isSupportedCoverExt(String ext) {
        if (ext == null) return false;
        String e = ext.toLowerCase(Locale.ROOT);
        return e.equals("jpg") || e.equals("jpeg") || e.equals("png") || e.equals("webp");
    }

    private static String detectImageMagicExt(byte[] bytes) {
        if (bytes == null || bytes.length < 12) return null;
        if ((bytes[0] & 0xFF) == 0xFF && (bytes[1] & 0xFF) == 0xD8) {
            return "jpg";
        }
        if ((bytes[0] & 0xFF) == 0x89 && bytes[1] == 0x50 && bytes[2] == 0x4E && bytes[3] == 0x47) {
            return "png";
        }
        if (bytes[0] == 'R' && bytes[1] == 'I' && bytes[2] == 'F' && bytes[3] == 'F'
                && bytes[8] == 'W' && bytes[9] == 'E' && bytes[10] == 'B' && bytes[11] == 'P') {
            return "webp";
        }
        return null;
    }
}
