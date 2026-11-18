package com.dreader.util;

import org.jsoup.Jsoup;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;

import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import java.io.File;
import java.io.InputStream;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Enumeration;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

public class EpubParser {

    public static class ChapterInfo {
        private String title;
        private String href;

        public ChapterInfo(String title, String href) {
            this.title = title;
            this.href = href;
        }

        public String getTitle() { return title; }
        public String getHref() { return href; }
    }

    public static class Metadata {
        private String title;
        private String author;
        private String description;
        private String language = "vi";
        private String publisher;
        private String isbn;
        private byte[] coverBytes;
        private String coverFormat = "jpg";
        private int totalChapters = 0;
        private List<ChapterInfo> chapters = new ArrayList<>();

        public String getTitle() { return title; }
        public void setTitle(String title) { this.title = title; }

        public String getAuthor() { return author; }
        public void setAuthor(String author) { this.author = author; }

        public String getDescription() { return description; }
        public void setDescription(String description) { this.description = description; }

        public String getLanguage() { return language; }
        public void setLanguage(String language) { this.language = language; }

        public String getPublisher() { return publisher; }
        public void setPublisher(String publisher) { this.publisher = publisher; }

        public String getIsbn() { return isbn; }
        public void setIsbn(String isbn) { this.isbn = isbn; }

        public byte[] getCoverBytes() { return coverBytes; }
        public void setCoverBytes(byte[] coverBytes) { this.coverBytes = coverBytes; }

        public String getCoverFormat() { return coverFormat; }
        public void setCoverFormat(String coverFormat) { this.coverFormat = coverFormat; }

        public int getTotalChapters() { return totalChapters; }
        public void setTotalChapters(int totalChapters) { this.totalChapters = totalChapters; }

        public List<ChapterInfo> getChapters() { return chapters; }
        public void setChapters(List<ChapterInfo> chapters) { this.chapters = chapters; }
    }

    public static Metadata parseEpub(File epubFile) {
        Metadata metadata = new Metadata();
        metadata.setTitle(epubFile.getName().replaceAll("(?i)\\.epub$", ""));
        metadata.setAuthor("Chưa rõ tác giả");

        try (ZipFile zipFile = new ZipFile(epubFile)) {
            ZipEntry containerEntry = zipFile.getEntry("META-INF/container.xml");
            if (containerEntry == null) {
                return metadata;
            }

            DocumentBuilderFactory dbf = DocumentBuilderFactory.newInstance();
            dbf.setNamespaceAware(true);
            try {
                dbf.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
                dbf.setFeature("http://xml.org/sax/features/external-general-entities", false);
                dbf.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
                dbf.setXIncludeAware(false);
                dbf.setExpandEntityReferences(false);
            } catch (Exception ignored) {}
            DocumentBuilder db = dbf.newDocumentBuilder();

            Document containerDoc;
            try (InputStream is = zipFile.getInputStream(containerEntry)) {
                containerDoc = db.parse(is);
            }

            NodeList rootfileList = containerDoc.getElementsByTagName("rootfile");
            if (rootfileList.getLength() == 0) {
                return metadata;
            }

            Element rootfileElem = (Element) rootfileList.item(0);
            String opfPath = rootfileElem.getAttribute("full-path");
            if (opfPath == null || opfPath.isEmpty()) {
                return metadata;
            }
            opfPath = URLDecoder.decode(opfPath, StandardCharsets.UTF_8);

            ZipEntry opfEntry = zipFile.getEntry(opfPath);
            if (opfEntry == null) {
                return metadata;
            }

            Document opfDoc;
            try (InputStream is = zipFile.getInputStream(opfEntry)) {
                opfDoc = db.parse(is);
            }

            // Title (Tối đa 500 ký tự)
            NodeList titleList = opfDoc.getElementsByTagNameNS("*", "title");
            if (titleList.getLength() > 0 && titleList.item(0).getTextContent() != null && !titleList.item(0).getTextContent().trim().isEmpty()) {
                metadata.setTitle(safeTruncate(titleList.item(0).getTextContent(), 500));
            }

            // Author / Creator (Tối đa 255 ký tự)
            NodeList creatorList = opfDoc.getElementsByTagNameNS("*", "creator");
            if (creatorList.getLength() > 0 && creatorList.item(0).getTextContent() != null && !creatorList.item(0).getTextContent().trim().isEmpty()) {
                metadata.setAuthor(safeTruncate(creatorList.item(0).getTextContent(), 255));
            }

            // Description
            NodeList descList = opfDoc.getElementsByTagNameNS("*", "description");
            if (descList.getLength() > 0 && descList.item(0).getTextContent() != null) {
                metadata.setDescription(descList.item(0).getTextContent().trim());
            }

            // Language (Tối đa 50 ký tự)
            NodeList langList = opfDoc.getElementsByTagNameNS("*", "language");
            if (langList.getLength() > 0 && langList.item(0).getTextContent() != null) {
                metadata.setLanguage(safeTruncate(langList.item(0).getTextContent(), 50));
            }

            // Publisher (Tối đa 255 ký tự)
            NodeList pubList = opfDoc.getElementsByTagNameNS("*", "publisher");
            if (pubList.getLength() > 0 && pubList.item(0).getTextContent() != null) {
                metadata.setPublisher(safeTruncate(pubList.item(0).getTextContent(), 255));
            }

            // Identifier / ISBN (Cắt gọn tối đa 255 ký tự để không bao giờ lỗi DB)
            NodeList idList = opfDoc.getElementsByTagNameNS("*", "identifier");
            if (idList.getLength() > 0 && idList.item(0).getTextContent() != null) {
                metadata.setIsbn(safeTruncate(idList.item(0).getTextContent(), 255));
            }

            // Chapter Count
            NodeList itemrefList = opfDoc.getElementsByTagNameNS("*", "itemref");
            if (itemrefList.getLength() > 0) {
                metadata.setTotalChapters(itemrefList.getLength());
            }

            // Cover Image
            String coverHref = null;
            NodeList metaList = opfDoc.getElementsByTagNameNS("*", "meta");
            String coverItemId = null;
            for (int i = 0; i < metaList.getLength(); i++) {
                Element meta = (Element) metaList.item(i);
                if ("cover".equalsIgnoreCase(meta.getAttribute("name"))) {
                    coverItemId = meta.getAttribute("content");
                    break;
                }
            }

            NodeList itemList = opfDoc.getElementsByTagNameNS("*", "item");
            if (coverItemId != null) {
                for (int i = 0; i < itemList.getLength(); i++) {
                    Element item = (Element) itemList.item(i);
                    if (coverItemId.equals(item.getAttribute("id"))) {
                        coverHref = item.getAttribute("href");
                        break;
                    }
                }
            }

            if (coverHref == null) {
                for (int i = 0; i < itemList.getLength(); i++) {
                    Element item = (Element) itemList.item(i);
                    String props = item.getAttribute("properties");
                    String id = item.getAttribute("id");
                    String mediaType = item.getAttribute("media-type");

                    if ((props != null && props.contains("cover-image")) ||
                        (id != null && id.toLowerCase().contains("cover")) && mediaType != null && mediaType.startsWith("image/")) {
                        coverHref = item.getAttribute("href");
                        break;
                    }
                }
            }

            if (coverHref != null) {
                coverHref = URLDecoder.decode(coverHref, StandardCharsets.UTF_8);
                String opfDir = "";
                int lastSlash = opfPath.lastIndexOf('/');
                if (lastSlash >= 0) {
                    opfDir = opfPath.substring(0, lastSlash + 1);
                }
                String fullCoverPath = opfDir + coverHref;

                ZipEntry coverEntry = zipFile.getEntry(fullCoverPath);
                if (coverEntry == null) {
                    coverEntry = zipFile.getEntry(coverHref);
                }

                if (coverEntry != null) {
                    try (InputStream cis = zipFile.getInputStream(coverEntry)) {
                        byte[] bytes = cis.readAllBytes();
                        metadata.setCoverBytes(bytes);
                        if (coverHref.endsWith(".png")) metadata.setCoverFormat("png");
                        else if (coverHref.endsWith(".webp")) metadata.setCoverFormat("webp");
                        else metadata.setCoverFormat("jpg");
                    }
                }
            }

            // Trích xuất mục lục có hỗ trợ fallback
            List<ChapterInfo> toc = extractToc(epubFile);
            metadata.setChapters(toc);
            if (!toc.isEmpty()) {
                metadata.setTotalChapters(toc.size());
            }

        } catch (Exception e) {
            // Fallback gracefully on parsing errors
        }

        return metadata;
    }

    // Đọc danh sách mục lục an toàn (có fallback)
    public static List<ChapterInfo> extractToc(File epubFile) {
        List<ChapterInfo> chapters = new ArrayList<>();
        if (epubFile == null || !epubFile.exists()) return chapters;

        try (ZipFile zipFile = new ZipFile(epubFile)) {
            // 1. Thử lấy mục lục chuẩn (dựa vào toc.ncx, nav.xhtml hoặc file TOC trong EPUB)
            chapters = parseStandardToc(zipFile);

            // 2. Nếu sách lỗi không có mục lục chuẩn -> Kích hoạt Fallback quét tự động từ OPF spine hoặc các file HTML/XHTML
            if (chapters.isEmpty()) {
                chapters = fallbackScanChapters(zipFile);
            }
        } catch (Exception ignored) {}
        return chapters;
    }

    private static List<ZipEntry> findAllNcxEntries(ZipFile zipFile) {
        List<ZipEntry> list = new ArrayList<>();
        // 1. Thử lấy chính xác NCX khai báo trong content.opf
        try {
            String opfPath = findOpfPath(zipFile);
            if (opfPath != null) {
                ZipEntry opfEntry = zipFile.getEntry(opfPath);
                if (opfEntry != null) {
                    String opfDir = getEntryDir(opfPath);
                    try (InputStream is = zipFile.getInputStream(opfEntry)) {
                        DocumentBuilderFactory dbf = DocumentBuilderFactory.newInstance();
                        dbf.setNamespaceAware(true);
                        org.w3c.dom.Document opfDoc = dbf.newDocumentBuilder().parse(is);

                        String tocId = null;
                        NodeList spineList = opfDoc.getElementsByTagNameNS("*", "spine");
                        if (spineList.getLength() > 0) {
                            org.w3c.dom.Element spineEl = (org.w3c.dom.Element) spineList.item(0);
                            tocId = spineEl.getAttribute("toc");
                        }

                        if (tocId != null && !tocId.isEmpty()) {
                            NodeList itemList = opfDoc.getElementsByTagNameNS("*", "item");
                            for (int i = 0; i < itemList.getLength(); i++) {
                                org.w3c.dom.Element itemEl = (org.w3c.dom.Element) itemList.item(i);
                                if (tocId.equals(itemEl.getAttribute("id"))) {
                                    String href = itemEl.getAttribute("href");
                                    if (href != null && !href.isEmpty()) {
                                        String resolved = resolveHref(opfDir, href);
                                        ZipEntry entry = zipFile.getEntry(resolved);
                                        if (entry != null) {
                                            list.add(entry);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        } catch (Exception ignored) {}

        // 2. Quét thêm tất cả các file .ncx khác trong zip
        Enumeration<? extends ZipEntry> entries = zipFile.entries();
        while (entries.hasMoreElements()) {
            ZipEntry entry = entries.nextElement();
            if (entry.getName().toLowerCase().endsWith(".ncx")) {
                boolean exists = false;
                for (ZipEntry e : list) {
                    if (e.getName().equals(entry.getName())) { exists = true; break; }
                }
                if (!exists) {
                    list.add(entry);
                }
            }
        }

        // Ưu tiên file ở root và file có dung lượng lớn hơn trước
        list.sort((a, b) -> {
            String na = a.getName().toLowerCase();
            String nb = b.getName().toLowerCase();
            int scoreA = (na.equals("toc.ncx") || na.equals("oebps/toc.ncx")) ? 2 : 1;
            int scoreB = (nb.equals("toc.ncx") || nb.equals("oebps/toc.ncx")) ? 2 : 1;
            if (scoreA != scoreB) return Integer.compare(scoreB, scoreA);
            return Long.compare(b.getSize(), a.getSize());
        });
        return list;
    }

    private static List<ChapterInfo> parseNcxEntry(ZipFile zipFile, ZipEntry ncxEntry) {
        List<ChapterInfo> chapters = new ArrayList<>();
        if (ncxEntry == null) return chapters;
        try (InputStream is = zipFile.getInputStream(ncxEntry)) {
            org.jsoup.nodes.Document doc = Jsoup.parse(is, "UTF-8", "", org.jsoup.parser.Parser.xmlParser());
            org.jsoup.select.Elements navPoints = doc.select("navPoint");
            String ncxDir = getEntryDir(ncxEntry.getName());
            for (org.jsoup.nodes.Element navPoint : navPoints) {
                org.jsoup.nodes.Element labelEl = navPoint.selectFirst("navLabel > text");
                org.jsoup.nodes.Element contentEl = navPoint.selectFirst("content");
                String title = labelEl != null ? labelEl.text().trim() : "";
                String src = contentEl != null ? contentEl.attr("src").trim() : "";
                if (!title.isEmpty() && !src.isEmpty() && !isWrapperTitle(title)) {
                    String resolved = resolveHref(ncxDir, src);
                    if (!isCoverOrTitleHref(resolved)) {
                        chapters.add(new ChapterInfo(title, resolved));
                    }
                }
            }
        } catch (Exception ignored) {}
        return chapters;
    }

    private static List<ChapterInfo> parseStandardToc(ZipFile zipFile) {
        List<ChapterInfo> chapters = new ArrayList<>();
        try {
            // 1. Quét tất cả file .ncx trong zip và chọn file trích xuất được nhiều chương nhất
            List<ZipEntry> ncxEntries = findAllNcxEntries(zipFile);
            for (ZipEntry ncxEntry : ncxEntries) {
                List<ChapterInfo> ncxChapters = parseNcxEntry(zipFile, ncxEntry);
                if (ncxChapters.size() > chapters.size()) {
                    chapters = ncxChapters;
                }
            }

            // 2. Nếu ncx không có hoặc chỉ có <= 2 mục, tìm nav.xhtml / contents.xhtml / *toc*.xhtml (EPUB 3 / Calibre)
            if (chapters.size() <= 2) {
                Enumeration<? extends ZipEntry> entries2 = zipFile.entries();
                List<ZipEntry> tocCandidates = new ArrayList<>();
                while (entries2.hasMoreElements()) {
                    ZipEntry entry = entries2.nextElement();
                    String name = entry.getName().toLowerCase();
                    if ((name.endsWith(".xhtml") || name.endsWith(".html") || name.endsWith(".htm")) &&
                        (name.contains("nav") || name.contains("toc") || name.contains("contents") || name.contains("mucluc"))) {
                        tocCandidates.add(entry);
                    }
                }

                // Ưu tiên nav.xhtml và contents.xhtml trước
                tocCandidates.sort((a, b) -> {
                    String na = a.getName().toLowerCase();
                    String nb = b.getName().toLowerCase();
                    int scoreA = na.contains("nav") ? 3 : (na.contains("contents") ? 2 : 1);
                    int scoreB = nb.contains("nav") ? 3 : (nb.contains("contents") ? 2 : 1);
                    return Integer.compare(scoreB, scoreA);
                });

                for (ZipEntry entry : tocCandidates) {
                    try (InputStream is = zipFile.getInputStream(entry)) {
                        org.jsoup.nodes.Document doc = Jsoup.parse(is, "UTF-8", "");
                        org.jsoup.select.Elements links = doc.select("a[href]");
                        if (links.size() > 2) {
                            List<ChapterInfo> candidateChapters = new ArrayList<>();
                            String entryDir = getEntryDir(entry.getName());
                            for (org.jsoup.nodes.Element link : links) {
                                String title = link.text().replace('\u00a0', ' ').replaceAll("\\s+", " ").trim();
                                String href = link.attr("href").trim();
                                if (!title.isEmpty() && !href.isEmpty() && !href.startsWith("http") && !href.startsWith("mailto:") && !isWrapperTitle(title)) {
                                    String resolved = resolveHref(entryDir, href);
                                    if (!isCoverOrTitleHref(resolved)) {
                                        candidateChapters.add(new ChapterInfo(title, resolved));
                                    }
                                }
                            }
                            if (candidateChapters.size() > chapters.size()) {
                                chapters = candidateChapters;
                                if (chapters.size() > 10) break;
                            }
                        }
                    } catch (Exception ignored) {}
                }
            }
        } catch (Exception ignored) {}
        return chapters;
    }

    // Cơ chế Fallback: Tự quét thẻ tiêu đề trong nội dung theo thứ tự Spine của EPUB
    private static List<ChapterInfo> fallbackScanChapters(ZipFile zipFile) {
        List<ChapterInfo> chapters = new ArrayList<>();
        try {
            // Thử đọc thứ tự file từ content.opf spine
            List<String> spineHrefs = getSpineHrefsFromOpf(zipFile);
            List<ZipEntry> htmlEntries = new ArrayList<>();

            if (!spineHrefs.isEmpty()) {
                for (String href : spineHrefs) {
                    ZipEntry entry = zipFile.getEntry(href);
                    if (entry == null && href.startsWith("/")) entry = zipFile.getEntry(href.substring(1));
                    if (entry != null && !isCoverOrTitleHref(entry.getName())) {
                        htmlEntries.add(entry);
                    }
                }
            }

            // Nếu không đọc được spine, liệt kê tất cả các file html/xhtml trong zip
            if (htmlEntries.isEmpty()) {
                Enumeration<? extends ZipEntry> entries = zipFile.entries();
                while (entries.hasMoreElements()) {
                    ZipEntry entry = entries.nextElement();
                    String name = entry.getName().toLowerCase();
                    if ((name.endsWith(".html") || name.endsWith(".xhtml") || name.endsWith(".htm")) && !isCoverOrTitleHref(name)) {
                        htmlEntries.add(entry);
                    }
                }
                htmlEntries.sort((a, b) -> a.getName().compareToIgnoreCase(b.getName()));
            }

            int index = 0;
            for (ZipEntry entry : htmlEntries) {
                String href = entry.getName();
                try (InputStream is = zipFile.getInputStream(entry)) {
                    org.jsoup.nodes.Document doc = Jsoup.parse(is, "UTF-8", "");
                    org.jsoup.select.Elements headings = doc.select("h1, h2, h3, title, .chapter-title");
                    boolean found = false;
                    for (org.jsoup.nodes.Element heading : headings) {
                        String text = heading.text().replace('\u00a0', ' ').replaceAll("\\s+", " ").trim();
                        if (!text.isEmpty() && (text.toLowerCase().contains("chương") || text.toLowerCase().contains("hồi") || (text.length() < 100 && !isWrapperTitle(text)))) {
                            chapters.add(new ChapterInfo(text, href));
                            found = true;
                            break;
                        }
                    }
                    if (!found) {
                        chapters.add(new ChapterInfo("Phần " + (++index), href));
                    }
                }
            }
        } catch (Exception ignored) {}
        return chapters;
    }

    private static List<String> getSpineHrefsFromOpf(ZipFile zipFile) {
        List<String> hrefs = new ArrayList<>();
        try {
            String opfPath = findOpfPath(zipFile);
            if (opfPath == null) return hrefs;
            ZipEntry opfEntry = zipFile.getEntry(opfPath);
            if (opfEntry == null) return hrefs;

            String opfDir = getEntryDir(opfPath);
            try (InputStream is = zipFile.getInputStream(opfEntry)) {
                DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
                factory.setNamespaceAware(true);
                org.w3c.dom.Document opfDoc = factory.newDocumentBuilder().parse(is);

                Map<String, String> manifestMap = new HashMap<>();
                NodeList items = opfDoc.getElementsByTagNameNS("*", "item");
                for (int i = 0; i < items.getLength(); i++) {
                    org.w3c.dom.Element item = (org.w3c.dom.Element) items.item(i);
                    manifestMap.put(item.getAttribute("id"), item.getAttribute("href"));
                }

                NodeList itemrefs = opfDoc.getElementsByTagNameNS("*", "itemref");
                for (int i = 0; i < itemrefs.getLength(); i++) {
                    org.w3c.dom.Element itemref = (org.w3c.dom.Element) itemrefs.item(i);
                    String idref = itemref.getAttribute("idref");
                    String href = manifestMap.get(idref);
                    if (href != null && !href.isEmpty()) {
                        hrefs.add(resolveHref(opfDir, href));
                    }
                }
            }
        } catch (Exception ignored) {}
        return hrefs;
    }

    private static String findOpfPath(ZipFile zipFile) {
        try {
            ZipEntry containerEntry = zipFile.getEntry("META-INF/container.xml");
            if (containerEntry == null) return null;
            try (InputStream is = zipFile.getInputStream(containerEntry)) {
                DocumentBuilderFactory dbf = DocumentBuilderFactory.newInstance();
                dbf.setNamespaceAware(true);
                org.w3c.dom.Document doc = dbf.newDocumentBuilder().parse(is);
                NodeList rootfiles = doc.getElementsByTagName("rootfile");
                if (rootfiles.getLength() > 0) {
                    org.w3c.dom.Element elem = (org.w3c.dom.Element) rootfiles.item(0);
                    String path = elem.getAttribute("full-path");
                    if (path != null && !path.isEmpty()) {
                        return URLDecoder.decode(path, StandardCharsets.UTF_8);
                    }
                }
            }
        } catch (Exception ignored) {}
        return null;
    }

    private static String getEntryDir(String path) {
        if (path == null) return "";
        int idx = path.lastIndexOf('/');
        return idx >= 0 ? path.substring(0, idx + 1) : "";
    }

    private static String resolveHref(String baseDir, String href) {
        if (href == null || href.isEmpty()) return "";
        if (href.startsWith("/")) return href.substring(1);
        if (href.startsWith("#") || baseDir == null || baseDir.isEmpty()) return href;
        return baseDir + href;
    }

    private static boolean isWrapperTitle(String title) {
        if (title == null) return true;
        String t = title.trim().toLowerCase();
        return t.equals("mục lục") || t.equals("table of contents") || t.equals("contents") || t.equals("toc") || t.equals("navigation");
    }

    private static boolean isCoverOrTitleHref(String href) {
        if (href == null) return true;
        String h = href.toLowerCase();
        return h.contains("titlepage") || h.contains("title-page") || h.contains("cover") || h.contains("biatruoc");
    }

    public static String cleanAndFormatChapterHtml(String rawHtml) {
        if (rawHtml == null || rawHtml.isEmpty()) return rawHtml;
        try {
            org.jsoup.nodes.Document doc = Jsoup.parse(rawHtml);
            org.jsoup.select.Elements chapterHeadings = doc.select("h1, h2, h3");
            for (org.jsoup.nodes.Element heading : chapterHeadings) {
                String text = heading.text().trim();
                if (text.toLowerCase().matches("^(chương|hồi|phần|chapter|tiết)\\s*\\d+.*")) {
                    heading.prepend("<hr style='margin: 40px 0; border: none; border-top: 1px dashed #ccc;'/>");
                }
            }
            return doc.body().html();
        } catch (Exception e) {
            return rawHtml;
        }
    }

    private static String safeTruncate(String value, int maxLength) {
        if (value == null) return null;
        String trimmed = value.trim();
        return trimmed.length() <= maxLength ? trimmed : trimmed.substring(0, maxLength);
    }
}
