package com.dreader;

import com.dreader.service.FormatConverterService;
import com.dreader.service.StorageService;
import com.dreader.util.EpubParser;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.font.PDType1Font;
import org.apache.pdfbox.pdmodel.font.Standard14Fonts;
import org.apache.poi.xwpf.usermodel.XWPFDocument;
import org.apache.poi.xwpf.usermodel.XWPFParagraph;
import org.apache.poi.xwpf.usermodel.XWPFRun;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.util.ReflectionTestUtils;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.*;

class FormatConverterTest {

    private FormatConverterService createConverter(Path tempDir) {
        StorageService storage = new StorageService();
        ReflectionTestUtils.setField(storage, "booksLocation", tempDir.resolve("books").toString());
        ReflectionTestUtils.setField(storage, "coversLocation", tempDir.resolve("covers").toString());
        ReflectionTestUtils.setField(storage, "ttsCacheLocation", tempDir.resolve("tts").toString());
        storage.init();

        FormatConverterService converter = new FormatConverterService();
        ReflectionTestUtils.setField(converter, "storageService", storage);
        return converter;
    }

    @Test
    void testTxtToEpubConversion(@TempDir Path tempDir) throws Exception {
        FormatConverterService converter = createConverter(tempDir);
        String txt = """
                Tên truyện: Đại Phụng Đả Canh Nhân
                Tác giả: Mãi Báo Tiểu Lang Quân
                
                Chương 1: Lao ngục mở đầu
                Hứa Thất An tỉnh dậy trong nhà giam lạnh lẽo.
                Phần lớn mọi người ở đây đều không biết chuyện gì xảy ra.
                
                Chương 2: Vụ án bạc thuế
                Ánh nắng chiếu qua song sắt cửa sổ.
                """;
        MockMultipartFile file = new MockMultipartFile(
                "file", "dai_phung.txt", "text/plain", txt.getBytes(StandardCharsets.UTF_8));

        String epubPath = converter.convertToEpubAndStore(file, "TXT");
        File epubFile = new File(epubPath);
        assertTrue(epubFile.exists() && epubFile.length() > 200);

        EpubParser.Metadata meta = EpubParser.parseEpub(epubFile);
        assertEquals("Đại Phụng Đả Canh Nhân", meta.getTitle());
        assertEquals("Mãi Báo Tiểu Lang Quân", meta.getAuthor());
        // "Phần lớn..." KHÔNG được tách nhầm thành chương! Phải có Mở đầu + Chương 1 + Chương 2 = 3 mục hoặc Chương 1 + Chương 2
        assertTrue(meta.getTotalChapters() >= 2);
        assertTrue(meta.getChapters().stream().anyMatch(c -> c.getTitle().contains("Chương 1")));
        assertTrue(meta.getChapters().stream().anyMatch(c -> c.getTitle().contains("Chương 2")));
    }

    @Test
    void testPdfToEpubConversion(@TempDir Path tempDir) throws Exception {
        FormatConverterService converter = createConverter(tempDir);
        byte[] pdfBytes;
        try (PDDocument doc = new PDDocument();
             ByteArrayOutputStream baos = new ByteArrayOutputStream()) {
            doc.getDocumentInformation().setTitle("Sample PDF Novel");
            doc.getDocumentInformation().setAuthor("Author Test");

            PDPage p1 = new PDPage();
            doc.addPage(p1);
            try (PDPageContentStream cs = new PDPageContentStream(doc, p1)) {
                cs.beginText();
                cs.setFont(new PDType1Font(Standard14Fonts.FontName.HELVETICA), 12);
                cs.newLineAtOffset(50, 700);
                cs.showText("Chapter 1: Awakening");
                cs.newLineAtOffset(0, -24);
                cs.showText("This is the first line of a broken");
                cs.newLineAtOffset(0, -18);
                cs.showText("sentence inside a PDF page.");
                cs.endText();
            }

            PDPage p2 = new PDPage();
            doc.addPage(p2);
            try (PDPageContentStream cs = new PDPageContentStream(doc, p2)) {
                cs.beginText();
                cs.setFont(new PDType1Font(Standard14Fonts.FontName.HELVETICA), 12);
                cs.newLineAtOffset(50, 700);
                cs.showText("Chapter 2: Journey");
                cs.newLineAtOffset(0, -24);
                cs.showText("Second chapter content here.");
                cs.endText();
            }
            doc.save(baos);
            pdfBytes = baos.toByteArray();
        }

        MockMultipartFile file = new MockMultipartFile("file", "sample.pdf", "application/pdf", pdfBytes);
        String epubPath = converter.convertToEpubAndStore(file, "PDF");
        File epubFile = new File(epubPath);
        assertTrue(epubFile.exists());

        EpubParser.Metadata meta = EpubParser.parseEpub(epubFile);
        assertEquals("Sample PDF Novel", meta.getTitle());
        assertNotNull(meta.getCoverBytes(), "Trang 1 của PDF phải được trích xuất làm ảnh bìa");
        assertEquals(2, meta.getTotalChapters());
    }

    @Test
    void testDocxToEpubConversion(@TempDir Path tempDir) throws Exception {
        FormatConverterService converter = createConverter(tempDir);
        byte[] docxBytes;
        try (XWPFDocument doc = new XWPFDocument();
             ByteArrayOutputStream baos = new ByteArrayOutputStream()) {
            XWPFParagraph h1 = doc.createParagraph();
            h1.setStyle("Heading1");
            XWPFRun r1 = h1.createRun();
            r1.setText("Chương 1: Khởi đầu mới");

            XWPFParagraph p1 = doc.createParagraph();
            p1.createRun().setText("Nội dung đoạn văn tiếng Việt trong file Word DOCX.");

            XWPFParagraph h2 = doc.createParagraph();
            h2.setStyle("Heading1");
            h2.createRun().setText("Chương 2: Tiếp nối");

            XWPFParagraph p2 = doc.createParagraph();
            p2.createRun().setText("Đoạn văn thuộc chương thứ hai.");

            doc.write(baos);
            docxBytes = baos.toByteArray();
        }

        MockMultipartFile file = new MockMultipartFile("file", "truyen_word.docx",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document", docxBytes);
        String epubPath = converter.convertToEpubAndStore(file, "DOCX");
        EpubParser.Metadata meta = EpubParser.parseEpub(new File(epubPath));
        assertEquals(2, meta.getTotalChapters());
        assertTrue(meta.getChapters().get(0).getTitle().contains("Chương 1"));
    }

    @Test
    void testMobiPureJavaConversion(@TempDir Path tempDir) throws Exception {
        FormatConverterService converter = createConverter(tempDir);

        // Tạo 1 tệp MOBI nhị phân tối giản (uncompressed compression=1, encoding=65001 UTF-8)
        byte[] htmlBytes = "<html><body><h2>Chương 1: Thế giới MOBI</h2><p>Xin chào tiếng Việt từ định dạng MOBI.</p></body></html>"
                .getBytes(StandardCharsets.UTF_8);

        byte[] rec0 = new byte[144];
        ByteBuffer r0 = ByteBuffer.wrap(rec0).order(ByteOrder.BIG_ENDIAN);
        r0.putShort(0, (short) 1); // uncompressed
        r0.putInt(4, htmlBytes.length);
        r0.putShort(8, (short) 1); // 1 text record
        r0.putShort(10, (short) 4096);
        r0.putShort(12, (short) 0); // no encryption
        System.arraycopy("MOBI".getBytes(StandardCharsets.US_ASCII), 0, rec0, 16, 4);
        r0.putInt(20, 116); // header length
        r0.putInt(28, 65001); // UTF-8

        int pdbHeaderSize = 78 + 2 * 8;
        int rec0Offset = pdbHeaderSize;
        int rec1Offset = rec0Offset + rec0.length;
        byte[] mobiBytes = new byte[rec1Offset + htmlBytes.length];
        ByteBuffer pdb = ByteBuffer.wrap(mobiBytes).order(ByteOrder.BIG_ENDIAN);
        System.arraycopy("BOOKMOBI".getBytes(StandardCharsets.US_ASCII), 0, mobiBytes, 60, 8);
        pdb.putShort(76, (short) 2); // 2 records
        pdb.putInt(78, rec0Offset);
        pdb.putInt(86, rec1Offset);
        System.arraycopy(rec0, 0, mobiBytes, rec0Offset, rec0.length);
        System.arraycopy(htmlBytes, 0, mobiBytes, rec1Offset, htmlBytes.length);

        MockMultipartFile file = new MockMultipartFile("file", "test_kindle.mobi", "application/x-mobipocket-ebook", mobiBytes);
        String epubPath = converter.convertToEpubAndStore(file, "MOBI");
        EpubParser.Metadata meta = EpubParser.parseEpub(new File(epubPath));
        assertEquals(1, meta.getTotalChapters());
        assertTrue(meta.getChapters().get(0).getTitle().contains("Chương 1"));
    }
}
