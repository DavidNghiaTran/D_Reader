/* ==========================================================================
   D_READER ENHANCEMENTS V2:
   - Hiện tên/số chương đang đọc ngay trên thanh công cụ phía trên
   - Tự động cuộn Mục lục tới chương hiện tại khi bấm mở
   - Tách chương chuẩn xác cho EPUB gộp nhiều chương & chống lẹm chữ mép trái
   ========================================================================== */
(function () {
    'use strict';

    // 1. Bơm CSS giao diện cho nhãn chương trên thanh công cụ & khung đọc
    function injectGlobalStyles() {
        if (document.getElementById('dreader-enhancements-style')) return;
        const style = document.createElement('style');
        style.id = 'dreader-enhancements-style';
        style.textContent = `
            .epub-container, .epub-view, .epub-view > iframe {
                max-width: 100% !important;
                width: 100% !important;
                left: 0 !important;
                margin-left: auto !important;
                margin-right: auto !important;
                box-sizing: border-box !important;
                overflow-x: hidden !important;
            }
            #dreader-current-chapter-badge {
                display: inline-flex;
                align-items: center;
                gap: 5px;
                max-width: 180px;
                padding: 3px 9px;
                margin-left: 5px;
                border-radius: 999px;
                background: rgba(99, 102, 241, 0.16);
                border: 1px solid rgba(129, 140, 248, 0.4);
                color: #c7d2fe;
                font-size: 12px;
                font-weight: 600;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                cursor: pointer;
                transition: all 0.2s ease;
                vertical-align: middle;
                flex-shrink: 1;
                min-width: 50px;
                line-height: 1.4;
            }
            #dreader-current-chapter-badge:hover {
                background: rgba(99, 102, 241, 0.32);
                border-color: rgba(129, 140, 248, 0.65);
                color: #ffffff;
            }
            #dreader-current-chapter-badge::before {
                content: "📖";
                font-size: 11px;
                flex-shrink: 0;
            }
            @media (max-width: 1380px) {
                #dreader-current-chapter-badge {
                    max-width: 150px;
                }
            }
            @media (max-width: 1250px) {
                #dreader-current-chapter-badge {
                    max-width: 130px;
                }
            }
            @media (max-width: 1000px) {
                #dreader-current-chapter-badge {
                    max-width: 110px;
                }
            }
            .dreader-toc-flash {
                outline: 2px solid #818cf8 !important;
                background-color: rgba(99, 102, 241, 0.35) !important;
            }
        `;
        document.head.appendChild(style);
    }

    // 2. Vá DOMParser để đọc được các file EPUB lỗi cú pháp XML
    const origParseFromString = DOMParser.prototype.parseFromString;
    DOMParser.prototype.parseFromString = function (str, type) {
        const doc = origParseFromString.call(this, str, type);
        if ((type === 'application/xhtml+xml' || type === 'text/xml') && doc && doc.querySelector('parsererror')) {
            return origParseFromString.call(this, str, 'text/html');
        }
        return doc;
    };

    let targetTocEl = null;
    let desiredLabel = '';
    let desiredNextLabel = '';
    let lastKnownChapterLabel = '';
    let isNavigatingToc = false;
    let deepSearchAttemptedFor = '';
    let pollTimer = null;
    let wasSidebarOpen = false;

    function getReaderObj() {
        try {
            if (typeof Reader !== 'undefined' && Reader) return Reader;
        } catch (e) {}
        return window.Reader || null;
    }

    function extractChapterNumber(text) {
        if (!text) return null;
        const m = text.match(/(?:chương|hồi|phần|chapter|tiết)\s*0*(\d+)(?![0-9])/i)
               || text.trim().match(/^0*(\d+)[\s:.\-–—]/);
        return m ? m[1] : null;
    }

    function normalizePath(p) {
        if (!p || typeof p !== 'string') return '';
        const raw = decodeURIComponent(p.split('#')[0]).replace(/\\/g, '/').trim();
        const parts = raw.split('/');
        const stack = [];
        for (const part of parts) {
            if (!part || part === '.') continue;
            if (part === '..') stack.pop();
            else stack.push(part);
        }
        return stack.join('/').toLowerCase();
    }

    // 3. Tự động tìm đúng vị trí cạnh tên truyện trên thanh công cụ để gắn nhãn chương
    function getOrCreateTopChapterBadge() {
        let badge = document.getElementById('dreader-current-chapter-badge');
        if (badge && document.body.contains(badge)) return badge;

        // Tìm nút "← Thư viện" trên thanh công cụ
        const libBtn = Array.from(document.querySelectorAll('button, a')).find(
            el => (el.textContent || '').includes('Thư viện')
        );
        if (!libBtn || !libBtn.parentElement) return null;

        const parentGroup = libBtn.parentElement;

        badge = document.createElement('span');
        badge.id = 'dreader-current-chapter-badge';
        badge.title = 'Bấm để mở Mục lục tới chương đang đọc';
        badge.addEventListener('click', (e) => {
            e.stopPropagation();
            const sidebar = getTocSidebar();
            if (sidebar && !isElementVisible(sidebar)) {
                const toggleBtn = findTocToggleButton();
                if (toggleBtn) toggleBtn.click();
            }
            setTimeout(() => scrollTocToCurrentChapter(true), 80);
        });

        // Ưu tiên chèn ngay sau tiêu đề truyện
        const titleEl = document.getElementById('currentBookTitle') || parentGroup.querySelector('.current-book-title, .book-title');
        if (titleEl && titleEl.parentElement) {
            titleEl.insertAdjacentElement('afterend', badge);
            return badge;
        }

        // Nếu parentGroup chứa cả các thẻ <select> (như Tối/Dark), chèn nhãn ngay trước <select> đầu tiên
        const firstSelect = parentGroup.querySelector('select');
        if (firstSelect) {
            parentGroup.insertBefore(badge, firstSelect);
        } else {
            // Nếu parentGroup là cụm bên trái (chứa Thư viện + nút ≡ + Tên truyện), gắn vào cuối cụm
            parentGroup.appendChild(badge);
        }

        return badge;
    }

    function updateTopChapterBadge(chapterTitle) {
        const cleanTitle = (chapterTitle || '').replace(/\s+/g, ' ').trim();
        if (!cleanTitle || cleanTitle === 'Tiêu đề sách') return;
        lastKnownChapterLabel = cleanTitle;

        const badge = getOrCreateTopChapterBadge();
        if (badge && badge.textContent !== cleanTitle) {
            badge.textContent = cleanTitle;
            badge.setAttribute('data-full-title', cleanTitle);
            badge.title = `${cleanTitle} (Bấm để mở Mục lục)`;
        }
    }

    // 4. Nhận diện chương hiện tại từ 5 nguồn (kể cả khi mở giữa chương từ tiến trình đã lưu)
    function detectCurrentChapter() {
        // Nguồn 1: Chương người dùng vừa bấm trực tiếp
        if (desiredLabel) {
            updateTopChapterBadge(desiredLabel);
            return;
        }

        // Nguồn 2: Mục đang có class .active trong danh sách Mục lục
        const activeToc = document.querySelector('.toc-item.active, #tocList .active, [data-href].active');
        if (activeToc && activeToc.textContent.trim()) {
            const tocText = activeToc.textContent.replace(/\s+/g, ' ').trim();
            if (tocText) {
                updateTopChapterBadge(tocText);
                return;
            }
        }

        const reader = getReaderObj();

        // Nguồn 3: Đối chiếu tọa độ hiện tại (rendition.location) với Mục lục gốc của sách
        if (reader && reader.rendition && reader.book) {
            const loc = reader.rendition.location;
            const currentHref = loc?.start?.href;
            const currentIndex = loc?.start?.index;

            if (currentHref && reader.book.navigation?.toc) {
                const normCurrent = normalizePath(currentHref);
                const flatToc = [];
                const flatten = (items) => {
                    if (!Array.isArray(items)) return;
                    items.forEach(it => {
                        if (it.label && it.href) flatToc.push(it);
                        if (it.subitems) flatten(it.subitems);
                    });
                };
                flatten(reader.book.navigation.toc);

                const matchedToc = flatToc.find(it => {
                    const normIt = normalizePath(it.href);
                    return normIt === normCurrent || ('/' + normIt).endsWith('/' + normCurrent) || ('/' + normCurrent).endsWith('/' + normIt);
                });

                if (matchedToc && matchedToc.label) {
                    updateTopChapterBadge(matchedToc.label);
                    return;
                }
            }

            // Nguồn 4: Quét tiêu đề hoặc thẻ <title> bên trong <iframe> đang mở
            const iframes = document.querySelectorAll('.epub-container iframe, #viewer iframe, iframe');
            for (const iframeEl of iframes) {
                let iframeDoc;
                try {
                    iframeDoc = iframeEl.contentDocument || iframeEl.contentWindow?.document;
                } catch (e) { continue; }
                if (!iframeDoc) continue;

                if (iframeDoc.body) {
                    const headings = iframeDoc.body.querySelectorAll('h1, h2, h3, h4, .chapter-title, .title, p, div');
                    for (const h of headings) {
                        if (h.children.length > 4) continue;
                        const txt = (h.textContent || '').replace(/\s+/g, ' ').trim();
                        if (!txt || txt.length > 150) continue;
                        if (/^(?:\[[^\]]*\]\s*)?(?:quyển\s*\d+.*?)?(?:đệ\s*)?(?:chương|hồi|phần|chapter|tiết)\s*\d+/i.test(txt)) {
                            updateTopChapterBadge(txt);
                            return;
                        }
                    }
                }

                const docTitle = (iframeDoc.title || '').replace(/\s+/g, ' ').trim();
                const bookTitle = (reader.book.packaging?.metadata?.title || '').trim();
                if (docTitle && docTitle.toLowerCase() !== 'untitled' && docTitle.toLowerCase() !== 'unknown' && docTitle !== bookTitle) {
                    updateTopChapterBadge(docTitle);
                    return;
                }
            }

            // Nguồn 5: Dự phòng theo số thứ tự chương trong Spine
            if (typeof currentIndex === 'number' && currentIndex >= 0) {
                updateTopChapterBadge(`Chương ${currentIndex + 1}`);
            }
        }
    }

    // 5. Vá book.spine.get() & chống onResized kéo ngược chương cũ
    function patchBookAndRendition() {
        const reader = getReaderObj();
        if (!reader || !reader.book || !reader.rendition) return;
        const book = reader.book;
        const rendition = reader.rendition;
        if (!book.isOpen || !book.spine || !book.spine.spineItems) return;

        if (!rendition._dreaderResizePatched) {
            rendition._dreaderResizePatched = true;
            const origOnResized = rendition.onResized.bind(rendition);
            rendition.onResized = function (size, epubcfi) {
                if (isNavigatingToc) {
                    this.emit('resized', { width: size.width, height: size.height }, epubcfi);
                    return;
                }
                return origOnResized(size, epubcfi);
            };
        }

        if (!book.spine._dreaderPatchedV2) {
            book.spine._dreaderPatchedV2 = true;
            book.spine.spineItems.forEach((item, idx) => {
                item.linear = true;
                item.prev = () => (idx > 0 ? book.spine.spineItems[idx - 1] : undefined);
                item.next = () => (idx < book.spine.spineItems.length - 1 ? book.spine.spineItems[idx + 1] : undefined);
            });

            const origSpineGet = book.spine.get.bind(book.spine);
            book.spine.get = function (target) {
                if (target === undefined || target === null) return origSpineGet(target);
                let res = origSpineGet(target);
                if (res) return res;

                if (typeof target === 'string') {
                    const noHash = target.split('#')[0];
                    if (noHash) {
                        res = origSpineGet(noHash) || origSpineGet(decodeURIComponent(noHash));
                        if (res) return res;
                    }
                    const normTarget = normalizePath(noHash);
                    const targetFile = normTarget.split('/').pop();

                    if (normTarget) {
                        res = this.spineItems.find(item => {
                            if (!item.href) return false;
                            const normItem = normalizePath(item.href);
                            return normItem === normTarget ||
                                   ('/' + normItem).endsWith('/' + normTarget) ||
                                   ('/' + normTarget).endsWith('/' + normItem);
                        });
                        if (res) return res;

                        if (targetFile) {
                            res = this.spineItems.find(item => {
                                if (!item.href) return false;
                                return normalizePath(item.href).split('/').pop() === targetFile;
                            });
                            if (res) return res;
                        }
                    }

                    const wantedNum = extractChapterNumber(desiredLabel);
                    if (wantedNum) {
                        const numRegex = new RegExp('(?:^|[^0-9])0*' + wantedNum + '(?:[^0-9]|$)');
                        res = this.spineItems.find(item => numRegex.test(item.href || '') || numRegex.test(item.idref || ''));
                        if (res) return res;
                    }
                }
                return null;
            };
        }
    }

    // 6. Tách chương chuẩn xác cho EPUB gộp nhiều chương trong 1 file XHTML
    function getHeadingBlock(el, body) {
        if (!el || el === body) return el;
        let curr = el;
        while (curr.parentElement && curr.parentElement !== body) {
            const parentText = (curr.parentElement.textContent || '').trim();
            if (parentText.length > 0 && parentText.length < 160 && curr.parentElement.children.length <= 3) {
                curr = curr.parentElement;
            } else {
                break;
            }
        }
        return curr;
    }

    function findChapterHeadingInDoc(iframeDoc, labelText, afterNode = null) {
        if (!iframeDoc || !iframeDoc.body || !labelText) return null;
        const cleanLabel = labelText.replace(/\s+/g, ' ').trim();
        const chapNum = extractChapterNumber(cleanLabel);
        if (!chapNum) return null;

        const strictNumRegex = new RegExp(
            '^(?:\\[[^\\]]*\\]\\s*)?(?:quyển\\s*\\d+[^\\n]*?)?(?:đệ\\s*)?(?:chương|hồi|phần|chapter|tiết)?\\s*0*' +
            chapNum + '(?![0-9])(?:\\s*[:.\\-–—]|\\s+|$)', 'i'
        );
        const titlePart = cleanLabel.includes(':')
            ? cleanLabel.split(':').slice(1).join(':').replace(/[.!?]+$/, '').trim().toLowerCase()
            : '';

        const candidates = iframeDoc.body.querySelectorAll('h1, h2, h3, h4, h5, h6, p, div, b, strong, span, center, a');
        let fallbackMatch = null;

        for (const el of candidates) {
            if (el.children.length > 5) continue;
            const rawText = (el.textContent || '').replace(/\s+/g, ' ').trim();
            if (!rawText || rawText.length > 160) continue;

            if (afterNode) {
                if (el === afterNode || afterNode.contains(el) || el.contains(afterNode)) continue;
                const pos = afterNode.compareDocumentPosition(el);
                if (!(pos & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
            }

            if (strictNumRegex.test(rawText)) {
                const block = getHeadingBlock(el, iframeDoc.body);
                if (afterNode && (block === afterNode || afterNode.contains(block) || block.contains(afterNode))) continue;
                if (!titlePart || rawText.toLowerCase().includes(titlePart)) return block;
                if (!fallbackMatch) fallbackMatch = block;
            }
        }
        return fallbackMatch;
    }

    async function deepSearchAndDisplayCorrectSpine(wantedLabel) {
        if (!wantedLabel || deepSearchAttemptedFor === wantedLabel) return;
        deepSearchAttemptedFor = wantedLabel;

        const reader = getReaderObj();
        if (!reader || !reader.book || !reader.rendition) return;
        const book = reader.book;
        const spineItems = book.spine?.spineItems;
        if (!spineItems || spineItems.length <= 1) return;

        const chapNum = extractChapterNumber(wantedLabel);
        if (!chapNum) return;

        const flatToc = [];
        function flatten(items) {
            if (!Array.isArray(items)) return;
            items.forEach(it => {
                if (it.label && it.href) flatToc.push(it);
                if (it.subitems) flatten(it.subitems);
            });
        }
        if (book.navigation?.toc) flatten(book.navigation.toc);

        const cleanWanted = wantedLabel.replace(/\s+/g, ' ').trim().toLowerCase();
        const tocMatch = flatToc.find(it => it.label.replace(/\s+/g, ' ').trim().toLowerCase() === cleanWanted) ||
                         flatToc.find(it => extractChapterNumber(it.label) === chapNum);

        if (tocMatch && tocMatch.href) {
            const targetSec = book.spine.get(tocMatch.href);
            if (targetSec) {
                await reader.rendition.display(targetSec.href);
                return;
            }
        }

        const num = parseInt(chapNum, 10);
        const candidateIndices = new Set();
        for (let d = -5; d <= 15; d++) {
            const idx = num - 1 + d;
            if (idx >= 0 && idx < spineItems.length) candidateIndices.add(idx);
        }

        const checkRegex = new RegExp('(?:chương|hồi|chapter)\\s*0*' + chapNum + '(?![0-9])', 'i');
        for (const idx of candidateIndices) {
            const sec = spineItems[idx];
            if (!sec) continue;
            try {
                const doc = await sec.load(book.load.bind(book));
                const text = (doc.ownerDocument || doc).body?.textContent || '';
                if (checkRegex.test(text)) {
                    await reader.rendition.display(sec.href);
                    return;
                }
            } catch (e) {}
        }
    }

    function injectAntiClipCss(iframeDoc) {
        if (!iframeDoc || !iframeDoc.head || iframeDoc.getElementById('dreader-anti-clip-css')) return;
        const style = iframeDoc.createElement('style');
        style.id = 'dreader-anti-clip-css';
        style.textContent = `
            html, body {
                max-width: 100% !important;
                width: 100% !important;
                margin: 0 auto !important;
                padding-left: 40px !important;
                padding-right: 40px !important;
                box-sizing: border-box !important;
                overflow-x: hidden !important;
            }
        `;
        iframeDoc.head.appendChild(style);
    }

    function processLoadedIframe(attemptCount) {
        const iframes = document.querySelectorAll('.epub-container iframe, #viewer iframe, iframe');
        for (const iframeEl of iframes) {
            let iframeDoc;
            try {
                iframeDoc = iframeEl.contentDocument || iframeEl.contentWindow?.document;
            } catch (e) { continue; }
            if (!iframeDoc || !iframeDoc.body || iframeDoc.body.children.length === 0) continue;

            injectAntiClipCss(iframeDoc);

            if (!desiredLabel || !extractChapterNumber(desiredLabel)) return true;
            if (!iframeDoc._fullOriginalHtml) iframeDoc._fullOriginalHtml = iframeDoc.body.innerHTML;
            if (iframeDoc._isolatedForLabel === desiredLabel) return true;

            if (iframeDoc._isolatedForLabel && iframeDoc._isolatedForLabel !== desiredLabel) {
                iframeDoc.body.innerHTML = iframeDoc._fullOriginalHtml;
                iframeDoc._isolatedForLabel = null;
            }

            const startBlock = findChapterHeadingInDoc(iframeDoc, desiredLabel, null);
            if (!startBlock) {
                if (attemptCount === 6) deepSearchAndDisplayCorrectSpine(desiredLabel);
                return false;
            }

            const currentChapNum = extractChapterNumber(desiredLabel);
            let endBlock = desiredNextLabel ? findChapterHeadingInDoc(iframeDoc, desiredNextLabel, startBlock) : null;
            if (!endBlock && currentChapNum) {
                endBlock = findChapterHeadingInDoc(iframeDoc, `Chương ${parseInt(currentChapNum, 10) + 1}`, startBlock);
            }

            const rangeBefore = iframeDoc.createRange();
            rangeBefore.setStart(iframeDoc.body, 0);
            rangeBefore.setEndBefore(startBlock);
            const textBefore = rangeBefore.toString().trim();

            if (endBlock && iframeDoc.body.contains(endBlock)) {
                const rangeAfter = iframeDoc.createRange();
                rangeAfter.setStartBefore(endBlock);
                rangeAfter.setEnd(iframeDoc.body, iframeDoc.body.childNodes.length);
                rangeAfter.deleteContents();
            }
            if (textBefore.length > 80 && iframeDoc.body.contains(startBlock)) {
                rangeBefore.deleteContents();
            }

            iframeDoc._isolatedForLabel = desiredLabel;
            [document.querySelector('.epub-container'), document.getElementById('viewer'), iframeDoc.scrollingElement].forEach(s => {
                if (s) s.scrollTop = 0;
            });
            return true;
        }
        return false;
    }

    // 7. Tự động cuộn Mục lục tới chương đang đọc
    function getTocSidebar() {
        return document.querySelector('#tocSidebar, .toc-sidebar, #sidebar, .sidebar, aside');
    }

    function findTocToggleButton() {
        const libBtn = Array.from(document.querySelectorAll('button, a')).find(
            el => (el.textContent || '').includes('Thư viện')
        );
        if (libBtn && libBtn.nextElementSibling && libBtn.nextElementSibling.tagName === 'BUTTON') {
            return libBtn.nextElementSibling;
        }
        return document.querySelector('#btnToggleToc, #btnToc, #tocToggle, #toggleTocBtn');
    }

    function isElementVisible(el) {
        if (!el) return false;
        if (el.classList.contains('active') || el.classList.contains('open')) return true;
        const st = window.getComputedStyle(el);
        if (st.display === 'none' || st.visibility === 'hidden' || parseFloat(st.opacity) === 0) return false;
        const r = el.getBoundingClientRect();
        return r.width > 20 && r.height > 20 && r.right > 0;
    }

    function scrollTocToCurrentChapter(flash = false) {
        const tocItems = Array.from(document.querySelectorAll('.toc-item, #tocList li, #tocList a, [data-href]'));
        if (tocItems.length === 0) return;

        if (lastKnownChapterLabel) {
            const targetNum = extractChapterNumber(lastKnownChapterLabel);
            const matched = tocItems.find(el => el.textContent.replace(/\s+/g, ' ').trim().toLowerCase() === lastKnownChapterLabel.toLowerCase())
                         || (targetNum && tocItems.find(el => extractChapterNumber(el.textContent) === targetNum));
            if (matched) {
                tocItems.forEach(el => el.classList.remove('active'));
                matched.classList.add('active');
            }
        }

        const activeItem = document.querySelector('.toc-item.active, #tocList .active, [data-href].active');
        if (!activeItem) return;

        let scrollBox = activeItem.parentElement;
        while (scrollBox && scrollBox !== document.body) {
            const st = window.getComputedStyle(scrollBox);
            if (scrollBox.scrollHeight > scrollBox.clientHeight + 5 && ['auto', 'scroll', 'overlay'].includes(st.overflowY)) break;
            scrollBox = scrollBox.parentElement;
        }

        if (scrollBox && scrollBox !== document.body) {
            const boxRect = scrollBox.getBoundingClientRect();
            const itemRect = activeItem.getBoundingClientRect();
            scrollBox.scrollTop = Math.max(0, scrollBox.scrollTop + (itemRect.top - boxRect.top) - (boxRect.height / 2) + (itemRect.height / 2));
        } else {
            activeItem.scrollIntoView({ block: 'center', behavior: 'auto' });
        }

        if (flash) {
            activeItem.classList.add('dreader-toc-flash');
            setTimeout(() => activeItem.classList.remove('dreader-toc-flash'), 1200);
        }
    }

    function lockSingleActiveToc() {
        const allActive = document.querySelectorAll('.toc-item.active, #tocList .active, [data-href].active');
        if (targetTocEl && document.body.contains(targetTocEl)) {
            allActive.forEach(el => { if (el !== targetTocEl) el.classList.remove('active'); });
            if (!targetTocEl.classList.contains('active')) targetTocEl.classList.add('active');
        } else if (allActive.length > 1) {
            allActive.forEach((el, idx) => { if (idx > 0) el.classList.remove('active'); });
        }
    }

    document.addEventListener('click', (e) => {
        try {
            // Khi bấm nút qua chương (< hoặc >), reset desiredLabel để tự nhận diện chương mới
            if (e.target.closest('#prevChapter, #nextChapter, .nav-btn, .page-nav')) {
                desiredLabel = '';
                targetTocEl = null;
            }

            const tocItem = e.target.closest('.toc-item, #tocList li, #tocList a, [data-href]');
            if (tocItem) {
                const inSidebar = tocItem.closest('#tocSidebar, .toc-sidebar, .sidebar, #tocList, .toc-list, aside');
                if (inSidebar || tocItem.classList.contains('toc-item')) {
                    patchBookAndRendition();
                    targetTocEl = tocItem;
                    desiredLabel = (tocItem.textContent || '').replace(/\s+/g, ' ').trim();
                    deepSearchAttemptedFor = '';
                    isNavigatingToc = true;

                    const allTocItems = Array.from(document.querySelectorAll('.toc-item, #tocList li, #tocList a, [data-href]'));
                    const currentIndex = allTocItems.indexOf(tocItem);
                    desiredNextLabel = (currentIndex !== -1 && currentIndex + 1 < allTocItems.length)
                        ? (allTocItems[currentIndex + 1].textContent || '').replace(/\s+/g, ' ').trim()
                        : '';

                    lockSingleActiveToc();
                    updateTopChapterBadge(desiredLabel);

                    if (pollTimer) clearInterval(pollTimer);
                    let attempts = 0;
                    pollTimer = setInterval(() => {
                        attempts++;
                        lockSingleActiveToc();
                        const done = processLoadedIframe(attempts);
                        if ((done && attempts >= 4) || attempts > 35) {
                            clearInterval(pollTimer);
                            pollTimer = null;
                            setTimeout(() => { isNavigatingToc = false; }, 300);
                        }
                    }, 80);
                    return;
                }
            }

            const clickedBtn = e.target.closest('button, [role="tab"]');
            if (clickedBtn) {
                const btnTitle = (clickedBtn.getAttribute('title') || '').toLowerCase();
                if (clickedBtn.id?.toLowerCase().includes('toc') || btnTitle.includes('mục lục') || clickedBtn.textContent.trim() === 'Mục lục') {
                    setTimeout(() => scrollTocToCurrentChapter(true), 60);
                    setTimeout(() => scrollTocToCurrentChapter(false), 240);
                }
            }
        } catch (err) {}
    }, true);

    injectGlobalStyles();
    setInterval(() => {
        try {
            patchBookAndRendition();
            lockSingleActiveToc();
            detectCurrentChapter();

            const sidebar = getTocSidebar();
            const isOpenNow = isElementVisible(sidebar);
            if (isOpenNow && !wasSidebarOpen) {
                setTimeout(() => scrollTocToCurrentChapter(true), 50);
            }
            wasSidebarOpen = isOpenNow;
        } catch (err) {}
    }, 350);
})();
