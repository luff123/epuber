class EPUBReader {
    constructor() {
        this.zip = null;
        this.containerPath = null;
        this.opfPath = null;
        this.spine = [];
        this.toc = [];
        this.currentSpineIndex = 0;
        this.tocCollapsed = {};
        this.tocPanelCollapsed = false;
        
        this.init();
    }
    
    init() {
        this.bindEvents();
        this.bindKeyboardNavigation();
    }
    
    bindEvents() {
        document.getElementById('upload-btn').addEventListener('click', () => {
            document.getElementById('file-input').click();
        });
        
        document.getElementById('file-input').addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                this.handleFile(e.target.files[0]);
            }
        });
        
        const uploadArea = document.getElementById('upload-area');
        
        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.style.backgroundColor = 'rgba(102, 126, 234, 0.3)';
        });
        
        uploadArea.addEventListener('dragleave', () => {
            uploadArea.style.backgroundColor = '';
        });
        
        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.style.backgroundColor = '';
            
            if (e.dataTransfer.files.length > 0) {
                this.handleFile(e.dataTransfer.files[0]);
            }
        });
        
        document.getElementById('back-btn').addEventListener('click', () => {
            this.showUploadArea();
        });
        
        document.getElementById('toggle-toc').addEventListener('click', () => {
            this.toggleTocPanel();
        });
        
        document.getElementById('show-toc-btn').addEventListener('click', () => {
            this.showTocPanel();
        });
        
        document.getElementById('prev-chapter').addEventListener('click', () => {
            this.previousChapter();
        });
        
        document.getElementById('next-chapter').addEventListener('click', () => {
            this.nextChapter();
        });
    }
    
    bindKeyboardNavigation() {
        document.addEventListener('keydown', (e) => {
            if (document.getElementById('reader-area').style.display === 'none') {
                return;
            }
            
            switch(e.key) {
                case 'ArrowLeft':
                    e.preventDefault();
                    this.previousChapter();
                    break;
                case 'ArrowRight':
                    e.preventDefault();
                    this.nextChapter();
                    break;
                case 'Home':
                    e.preventDefault();
                    if (this.spine.length > 0) {
                        this.loadSpineItem(0);
                    }
                    break;
                case 'End':
                    e.preventDefault();
                    if (this.spine.length > 0) {
                        this.loadSpineItem(this.spine.length - 1);
                    }
                    break;
            }
        });
    }
    
    previousChapter() {
        if (this.currentSpineIndex > 0) {
            this.loadSpineItem(this.currentSpineIndex - 1);
        }
    }
    
    nextChapter() {
        if (this.currentSpineIndex < this.spine.length - 1) {
            this.loadSpineItem(this.currentSpineIndex + 1);
        }
    }
    
    async handleFile(file) {
        if (!file.name.endsWith('.epub')) {
            this.showError('请选择EPUB格式的文件');
            return;
        }
        
        this.showLoading();
        
        try {
            const arrayBuffer = await this.readFileAsArrayBuffer(file);
            this.zip = await JSZip.loadAsync(arrayBuffer);
            
            await this.parseContainer();
            await this.parseOPF();
            await this.parseTOC();
            
            this.showReaderArea();
            this.renderTOC();
            
            if (this.spine.length > 0) {
                await this.loadSpineItem(0);
            }
            
            this.hideLoading();
        } catch (error) {
            this.hideLoading();
            this.showError('解析EPUB文件失败: ' + (error.message || '请检查文件格式是否正确'));
        }
    }
    
    readFileAsArrayBuffer(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = reject;
            reader.readAsArrayBuffer(file);
        });
    }
    
    async parseContainer() {
        const containerFile = this.zip.file('META-INF/container.xml');
        if (!containerFile) {
            throw new Error('找不到container.xml文件');
        }
        
        const containerXml = await containerFile.async('text');
        const parser = new DOMParser();
        const doc = parser.parseFromString(containerXml, 'text/xml');
        
        const rootFile = doc.querySelector('rootfile');
        if (rootFile) {
            this.opfPath = rootFile.getAttribute('full-path');
        } else {
            throw new Error('找不到OPF文件');
        }
    }
    
    async parseOPF() {
        const opfFile = this.zip.file(this.opfPath);
        if (!opfFile) {
            throw new Error('找不到OPF文件: ' + this.opfPath);
        }
        
        const opfXml = await opfFile.async('text');
        const parser = new DOMParser();
        const doc = parser.parseFromString(opfXml, 'text/xml');
        
        const titleEl = doc.querySelector('title, dc\\:title');
        if (titleEl) {
            document.getElementById('book-title').textContent = titleEl.textContent;
        }
        
        const manifest = {};
        const items = doc.querySelectorAll('manifest item');
        items.forEach(item => {
            manifest[item.getAttribute('id')] = {
                href: item.getAttribute('href'),
                mediaType: item.getAttribute('media-type')
            };
        });
        
        const spineItems = doc.querySelectorAll('spine itemref');
        this.spine = [];
        spineItems.forEach((item, index) => {
            const id = item.getAttribute('idref');
            if (manifest[id]) {
                this.spine.push({
                    index: index,
                    id: id,
                    href: this.resolvePath(this.opfPath, manifest[id].href),
                    mediaType: manifest[id].mediaType
                });
            }
        });
        
        const spineEl = doc.querySelector('spine');
        const tocId = spineEl ? spineEl.getAttribute('toc') : null;
        if (tocId && manifest[tocId]) {
            this.tocPath = this.resolvePath(this.opfPath, manifest[tocId].href);
        } else {
            const navItem = Array.from(items).find(i => 
                i.getAttribute('properties') === 'nav' || 
                i.getAttribute('media-type') === 'application/x-dtbncx+xml'
            );
            if (navItem) {
                this.tocPath = this.resolvePath(this.opfPath, navItem.getAttribute('href'));
            }
        }
    }
    
    async parseTOC() {
        if (!this.tocPath) {
            this.generateSimpleTOC();
            return;
        }
        
        try {
            const tocFile = this.zip.file(this.tocPath);
            if (!tocFile) {
                this.generateSimpleTOC();
                return;
            }
            
            const tocXml = await tocFile.async('text');
            const parser = new DOMParser();
            const doc = parser.parseFromString(tocXml, 'text/xml');
            
            if (this.tocPath.endsWith('.xhtml') || this.tocPath.endsWith('.html')) {
                this.parseEPUB3Nav(doc);
            } else {
                this.parseEPUB2NCX(doc);
            }
        } catch (error) {
            this.generateSimpleTOC();
        }
    }
    
    parseEPUB3Nav(doc) {
        this.toc = [];
        const navMap = doc.querySelector('nav[epub\\:type="toc"], nav#toc');
        if (!navMap) {
            this.generateSimpleTOC();
            return;
        }
        
        const ol = navMap.querySelector('ol');
        if (ol) {
            this.toc = this.parseNavList(ol, 1);
        }
    }
    
    parseNavList(ol, level) {
        const items = [];
        const liElements = ol.querySelectorAll(':scope > li');
        
        liElements.forEach(li => {
            const a = li.querySelector(':scope > a');
            if (a) {
                const item = {
                    label: a.textContent.trim(),
                    href: this.resolvePath(this.tocPath, a.getAttribute('href')),
                    level: level,
                    children: []
                };
                
                const childOl = li.querySelector(':scope > ol');
                if (childOl) {
                    item.children = this.parseNavList(childOl, level + 1);
                }
                
                items.push(item);
            }
        });
        
        return items;
    }
    
    parseEPUB2NCX(doc) {
        this.toc = [];
        const navMap = doc.querySelector('navMap');
        if (!navMap) {
            this.generateSimpleTOC();
            return;
        }
        
        const navPoints = navMap.querySelectorAll(':scope > navPoint');
        navPoints.forEach(navPoint => {
            this.toc.push(this.parseNavPoint(navPoint, 1));
        });
    }
    
    parseNavPoint(navPoint, level) {
        const textEl = navPoint.querySelector('navLabel text');
        const contentEl = navPoint.querySelector('content');
        
        const item = {
            label: textEl ? textEl.textContent.trim() : '',
            href: contentEl ? this.resolvePath(this.tocPath, contentEl.getAttribute('src')) : '',
            level: level,
            children: []
        };
        
        const childNavPoints = navPoint.querySelectorAll(':scope > navPoint');
        childNavPoints.forEach(childNavPoint => {
            item.children.push(this.parseNavPoint(childNavPoint, level + 1));
        });
        
        return item;
    }
    
    generateSimpleTOC() {
        this.toc = this.spine.map((item, index) => ({
            label: `第 ${index + 1} 章`,
            href: item.href,
            level: 1,
            children: []
        }));
    }
    
    resolvePath(base, relative) {
        if (!relative) return base;
        if (relative.startsWith('/')) return relative;
        
        const baseParts = base.split('/');
        baseParts.pop();
        
        const relativeParts = relative.split('/');
        
        for (const part of relativeParts) {
            if (part === '.') {
                continue;
            } else if (part === '..') {
                baseParts.pop();
            } else {
                baseParts.push(part);
            }
        }
        
        return baseParts.join('/');
    }
    
    async loadSpineItem(index, anchorId = null) {
        if (index < 0 || index >= this.spine.length) return;
        
        this.currentSpineIndex = index;
        const item = this.spine[index];
        const contentArea = document.getElementById('content-area');
        
        try {
            let contentFile = this.zip.file(item.href);
            if (!contentFile) {
                const pathsToTry = [
                    item.href,
                    item.href.replace(/^\//, ''),
                    item.href.startsWith('/') ? item.href : '/' + item.href
                ];
                
                for (const path of pathsToTry) {
                    contentFile = this.zip.file(path);
                    if (contentFile) {
                        break;
                    }
                }
                
                if (!contentFile) {
                    contentArea.innerHTML = `
                        <div style="padding:20px;">
                            <p style="color:red;">❌ 找不到章节文件</p>
                            <p>尝试的路径: ${item.href}</p>
                        </div>
                    `;
                    return;
                }
            }
            
            const content = await contentFile.async('text');
            
            if (content.length === 0) {
                contentArea.innerHTML = '<p style="color:orange;">⚠️ 章节内容为空</p>';
                return;
            }
            
            await this.renderContentSimple(content, item.href);
            
            if (anchorId) {
                this.scrollToAnchor(anchorId);
            } else {
                contentArea.scrollTop = 0;
            }
            
            this.updateActiveTOC(item.href);
            this.updateNavigationButtons();
        } catch (error) {
            contentArea.innerHTML = `<p style="color:red;">❌ 加载章节失败: ${error.message || '未知错误'}</p>`;
        }
    }
    
    scrollToAnchor(anchorId) {
        const contentArea = document.getElementById('content-area');
        
        const anchorElement = contentArea.querySelector(`#${anchorId}`);
        if (!anchorElement) {
            const namedAnchor = contentArea.querySelector(`a[name="${anchorId}"]`);
            if (namedAnchor) {
                anchorElement = namedAnchor;
            }
        }
        
        if (anchorElement) {
            anchorElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }
    
    async renderContentSimple(htmlContent, basePath) {
        const contentArea = document.getElementById('content-area');
        
        let displayHtml = htmlContent;
        
        const bodyRegex = /<body[^>]*>([\s\S]*?)<\/body>/i;
        const bodyMatch = displayHtml.match(bodyRegex);
        if (bodyMatch) {
            displayHtml = bodyMatch[1];
        }
        
        displayHtml = displayHtml.replace(/<link[^>]*>/gi, '');
        displayHtml = displayHtml.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
        displayHtml = displayHtml.replace(/<meta[^>]*>/gi, '');
        
        displayHtml = await this.processImagesInline(displayHtml, basePath);
        
        contentArea.innerHTML = displayHtml;
    }
    
    async processImagesInline(htmlContent, basePath) {
        const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
        const images = [];
        let match;
        
        while ((match = imgRegex.exec(htmlContent)) !== null) {
            images.push({
                fullTag: match[0],
                src: match[1],
                index: images.length
            });
        }
        
        for (const imgInfo of images) {
            const src = imgInfo.src;
            let imgFile = null;
            const pathsToTry = this.getPossiblePaths(src, basePath);
            
            for (const path of pathsToTry) {
                imgFile = this.zip.file(path);
                if (imgFile) {
                    break;
                }
            }
            
            if (imgFile) {
                const data = await imgFile.async('base64');
                const mimeType = this.getMimeType(src);
                const base64Src = `data:${mimeType};base64,${data}`;
                htmlContent = htmlContent.replace(imgInfo.fullTag, imgInfo.fullTag.replace(src, base64Src));
            }
        }
        
        return htmlContent;
    }
    
    processImages(contentArea, basePath) {
    }
    
    getPossiblePaths(src, basePath) {
        const paths = [];
        
        paths.push(this.resolvePath(basePath, src));
        paths.push(src.replace(/^\//, ''));
        paths.push(basePath.substring(0, basePath.lastIndexOf('/') + 1) + src);
        
        if (src.startsWith('/')) {
            paths.push(src.substring(1));
        }
        
        if (src.includes('/')) {
            const lastSlash = src.lastIndexOf('/');
            const fileName = src.substring(lastSlash + 1);
            paths.push(fileName);
            paths.push('OEBPS/' + fileName);
            paths.push('OEBPS/images/' + fileName);
            paths.push('images/' + fileName);
            paths.push('EPUB/' + fileName);
            paths.push('EPUB/images/' + fileName);
        }
        
        return [...new Set(paths)];
    }
    
    renderContent(html, basePath) {
        const contentArea = document.getElementById('content-area');
        
        try {
            let displayHtml = html;
            
            if (displayHtml.startsWith('<?xml')) {
                displayHtml = this.extractXHTMLContent(html);
            } else if (!displayHtml.includes('<html') && !displayHtml.includes('<body')) {
                displayHtml = '<div>' + displayHtml + '</div>';
            }
            
            contentArea.innerHTML = displayHtml;
            
            const images = contentArea.querySelectorAll('img');
            
            images.forEach(img => {
                const src = img.getAttribute('src');
                if (src) {
                    const fullPath = this.resolvePath(basePath, src);
                    const imgFile = this.zip.file(fullPath);
                    if (imgFile) {
                        imgFile.async('base64').then(data => {
                            const mimeType = this.getMimeType(fullPath);
                            img.src = `data:${mimeType};base64,${data}`;
                        });
                    }
                }
            });
            
            contentArea.scrollTop = 0;
            
        } catch (error) {
            contentArea.innerHTML = '<p>渲染内容失败: ' + error.message + '</p>';
        }
    }
    
    extractXHTMLContent(xmlString) {
        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(xmlString, 'text/html');
            
            const body = doc.querySelector('body');
            if (body && body.innerHTML.trim()) {
                return body.innerHTML;
            }
            
            const html = doc.querySelector('html');
            if (html && html.innerHTML.trim()) {
                return html.innerHTML;
            }
        } catch (e) {
        }
        
        const bodyMatch = xmlString.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
        if (bodyMatch && bodyMatch[1].trim()) {
            return bodyMatch[1];
        }
        
        const htmlMatch = xmlString.match(/<html[^>]*>([\s\S]*?)<\/html>/i);
        if (htmlMatch && htmlMatch[1].trim()) {
            return htmlMatch[1];
        }
        
        const contentMatch = xmlString.match(/<div[^>]*>([\s\S]*?)<\/div>/i);
        if (contentMatch && contentMatch[1].trim()) {
            return contentMatch[1];
        }
        
        return '<pre>' + xmlString.substring(0, 3000) + '</pre>';
    }
    
    getMimeType(path) {
        const ext = path.split('.').pop().toLowerCase();
        const mimeTypes = {
            'png': 'image/png',
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'gif': 'image/gif',
            'svg': 'image/svg+xml',
            'webp': 'image/webp'
        };
        return mimeTypes[ext] || 'application/octet-stream';
    }
    
    renderTOC() {
        const tocList = document.getElementById('toc-list');
        tocList.innerHTML = '';
        this.renderTOCItems(this.toc, tocList);
    }
    
    renderTOCItems(items, container) {
        items.forEach((item, index) => {
            const itemId = `toc-${item.level}-${index}-${Date.now()}`;
            this.tocCollapsed[itemId] = false;
            
            const itemDiv = document.createElement('div');
            itemDiv.className = 'toc-container';
            
            const itemElement = document.createElement('div');
            itemElement.className = `toc-item level-${item.level}`;
            itemElement.dataset.href = item.href;
            
            if (item.children.length > 0) {
                const toggle = document.createElement('span');
                toggle.className = 'toc-toggle';
                toggle.textContent = '▼';
                toggle.dataset.id = itemId;
                toggle.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.toggleTocItem(itemId, toggle, childrenDiv);
                });
                itemElement.appendChild(toggle);
            }
            
            const label = document.createElement('span');
            label.textContent = item.label;
            itemElement.appendChild(label);
            
            itemElement.addEventListener('click', () => {
                this.navigateTo(item.href);
            });
            
            itemDiv.appendChild(itemElement);
            
            let childrenDiv = null;
            if (item.children.length > 0) {
                childrenDiv = document.createElement('div');
                childrenDiv.className = 'toc-children expanded';
                childrenDiv.dataset.parentId = itemId;
                this.renderTOCItems(item.children, childrenDiv);
                itemDiv.appendChild(childrenDiv);
            }
            
            container.appendChild(itemDiv);
        });
    }
    
    toggleTocItem(id, toggleElement, childrenElement) {
        this.tocCollapsed[id] = !this.tocCollapsed[id];
        
        if (this.tocCollapsed[id]) {
            toggleElement.classList.add('collapsed');
            childrenElement.classList.remove('expanded');
        } else {
            toggleElement.classList.remove('collapsed');
            childrenElement.classList.add('expanded');
        }
    }
    
    navigateTo(href) {
        const hashIndex = href.indexOf('#');
        const cleanHref = hashIndex !== -1 ? href.substring(0, hashIndex) : href;
        const anchorId = hashIndex !== -1 ? href.substring(hashIndex + 1) : null;
        
        const index = this.spine.findIndex(item => 
            item.href === cleanHref || 
            item.href === href
        );
        
        if (index !== -1) {
            this.loadSpineItem(index, anchorId);
        }
    }
    
    updateActiveTOC(href) {
        const cleanHref = href.split('#')[0];
        const tocItems = document.querySelectorAll('.toc-item');
        
        tocItems.forEach(item => {
            const itemHref = item.dataset.href;
            if (itemHref === cleanHref || itemHref === href) {
                item.classList.add('active');
                item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            } else {
                item.classList.remove('active');
            }
        });
    }
    
    updateNavigationButtons() {
        const prevBtn = document.getElementById('prev-chapter');
        const nextBtn = document.getElementById('next-chapter');
        const chapterInfo = document.getElementById('chapter-info');
        
        prevBtn.disabled = this.currentSpineIndex === 0;
        nextBtn.disabled = this.currentSpineIndex === this.spine.length - 1;
        
        chapterInfo.textContent = `第 ${this.currentSpineIndex + 1} 章 / 共 ${this.spine.length} 章`;
    }
    
    toggleTocPanel() {
        const tocPanel = document.querySelector('.toc-panel');
        const toggleBtn = document.getElementById('toggle-toc');
        const showTocBtn = document.getElementById('show-toc-btn');
        
        this.tocPanelCollapsed = !this.tocPanelCollapsed;
        
        if (this.tocPanelCollapsed) {
            tocPanel.classList.add('collapsed');
            showTocBtn.style.display = 'inline-flex';
        } else {
            tocPanel.classList.remove('collapsed');
            showTocBtn.style.display = 'none';
        }
    }
    
    showTocPanel() {
        const tocPanel = document.querySelector('.toc-panel');
        const showTocBtn = document.getElementById('show-toc-btn');
        
        this.tocPanelCollapsed = false;
        tocPanel.classList.remove('collapsed');
        showTocBtn.style.display = 'none';
    }
    
    showUploadArea() {
        document.getElementById('upload-area').style.display = 'flex';
        document.getElementById('reader-area').style.display = 'none';
        document.getElementById('file-input').value = '';
    }
    
    showReaderArea() {
        document.getElementById('upload-area').style.display = 'none';
        document.getElementById('reader-area').style.display = 'flex';
        document.getElementById('show-toc-btn').style.display = 'none';
    }
    
    showError(message) {
        const errorDiv = document.getElementById('error-message');
        errorDiv.textContent = message;
        errorDiv.style.display = 'block';
        
        setTimeout(() => {
            errorDiv.style.display = 'none';
        }, 4000);
    }
    
    showLoading() {
        document.getElementById('loading-overlay').style.display = 'flex';
    }
    
    hideLoading() {
        document.getElementById('loading-overlay').style.display = 'none';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new EPUBReader();
});
