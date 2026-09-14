package com.dreader.util;

import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;

import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import java.io.File;
import java.io.InputStream;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

public class EpubParser {

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

            // Title
            NodeList titleList = opfDoc.getElementsByTagNameNS("*", "title");
            if (titleList.getLength() > 0 && titleList.item(0).getTextContent() != null && !titleList.item(0).getTextContent().trim().isEmpty()) {
                metadata.setTitle(titleList.item(0).getTextContent().trim());
            }

            // Author / Creator
            NodeList creatorList = opfDoc.getElementsByTagNameNS("*", "creator");
            if (creatorList.getLength() > 0 && creatorList.item(0).getTextContent() != null && !creatorList.item(0).getTextContent().trim().isEmpty()) {
                metadata.setAuthor(creatorList.item(0).getTextContent().trim());
            }

            // Description
            NodeList descList = opfDoc.getElementsByTagNameNS("*", "description");
            if (descList.getLength() > 0 && descList.item(0).getTextContent() != null) {
                metadata.setDescription(descList.item(0).getTextContent().trim());
            }

            // Language
            NodeList langList = opfDoc.getElementsByTagNameNS("*", "language");
            if (langList.getLength() > 0 && langList.item(0).getTextContent() != null) {
                metadata.setLanguage(langList.item(0).getTextContent().trim());
            }

            // Publisher
            NodeList pubList = opfDoc.getElementsByTagNameNS("*", "publisher");
            if (pubList.getLength() > 0 && pubList.item(0).getTextContent() != null) {
                metadata.setPublisher(pubList.item(0).getTextContent().trim());
            }

            // Identifier / ISBN
            NodeList idList = opfDoc.getElementsByTagNameNS("*", "identifier");
            if (idList.getLength() > 0 && idList.item(0).getTextContent() != null) {
                metadata.setIsbn(idList.item(0).getTextContent().trim());
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

        } catch (Exception e) {
            // Fallback gracefully on parsing errors
        }

        return metadata;
    }
}
