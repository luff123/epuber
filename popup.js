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
        // 文件上传相关事件
        document.getElementById('upload-btn').addEventListener('click', () => {
            document.getElementById('file-input').click();
        });
        
        document.getElementById('file-input').addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                this.handleFile(e.target.files[0]);
            }
        });
        
        // 拖放事件
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
        
        // 返回按钮
        document.getElementById('back-btn').addEventListener('click', () => {
            this.showUploadArea();
        });
        
        // 切换目录面板
        document.getElementById('toggle-toc').addEventListener('click', () => {
            this.toggleTocPanel();
        });
        
        // 章节导航按钮
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
            // 加载EPUB文件
            const arrayBuffer = await this.readFileAsArrayBuffer(file);
            this.zip = await JSZip.loadAsync(arrayBuffer);
            
            // 解析container.xml获取OPF文件路径
            await this.parseContainer();
            
            // 解析OPF文件
            await this.parseOPF();
            
            // 解析TOC目录
            await this.parseTOC();
            
            // 显示阅读界面
            this.showReaderArea();
            
            // 渲染目录
            this.renderTOC();
            
            // 加载第一个章节
            if (this.spine.length > 0) {
                await this.loadSpineItem(0);
            }
            
            this.hideLoading();
        } catch (error) {
            console.error('解析EPUB文件失败:', error);
            this.hideLoading();
            this.showError('解析EPUB文件失败，请检查文件格式是否正确');
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
        const containerXml = await this.zip.file('META-INF/container.xml').async('text');
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
        const opfXml = await this.zip.file(this.opfPath).async('text');
        const parser = new DOMParser();
        const doc = parser.parseFromString(opfXml, 'text/xml');
        
        // 获取书名
        const titleEl = doc.querySelector('title');
        if (titleEl) {
            document.getElementById('book-title').textContent = titleEl.textContent;
        }
        
        // 获取manifest
        const manifest = {};
        const items = doc.querySelectorAll('manifest item');
        items.forEach(item => {
            manifest[item.getAttribute('id')] = {
                href: item.getAttribute('href'),
                mediaType: item.getAttribute('media-type')
            };
        });
        
        // 获取spine
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
        
        // 获取toc路径
        const spineEl = doc.querySelector('spine');
        const tocId = spineEl ? spineEl.getAttribute('toc') : null;
        if (tocId && manifest[tocId]) {
            this.tocPath = this.resolvePath(this.opfPath, manifest[tocId].href);
        } else {
            // 尝试查找nav或ncx文件
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
            const tocXml = await this.zip.file(this.tocPath).async('text');
            const parser = new DOMParser();
            const doc = parser.parseFromString(tocXml, 'text/xml');
            
            // 尝试解析EPUB3 nav文件
            if (this.tocPath.endsWith('.xhtml') || this.tocPath.endsWith('.html')) {
                this.parseEPUB3Nav(doc);
            } else {
                // 解析EPUB2 NCX文件
                this.parseEPUB2NCX(doc);
            }
        } catch (error) {
            console.error('解析TOC失败:', error);
            this.generateSimpleTOC();
        }
    }
    
    parseEPUB3Nav(doc) {
        this.toc = [];
        const navMap = doc.querySelector('nav[epub\\:type="toc"], nav#toc');
        if (!navMap) return;
        
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
        if (!navMap) return;
        
        const navPoints = navMap.querySelectorAll(':scope > navPoint');
        navPoints.forEach(navPoint => {
            this.toc.push(this.parseNavPoint(navPoint, 1));
        });
    }
    
    parseNavPoint(navPoint, level) {
        const label = navPoint.querySelector('navLabel text').textContent.trim();
        const content = navPoint.querySelector('content');
        const href = content ? this.resolvePath(this.tocPath, content.getAttribute('src')) : '';
        
        const item = {
            label: label,
            href: href,
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
        baseParts.pop(); // 移除文件名
        
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
    
    async loadSpineItem(index) {
        if (index < 0 || index >= this.spine.length) return;
        
        this.currentSpineIndex = index;
        const item = this.spine[index];
        
        try {
            const content = await this.zip.file(item.href).async('text');
            this.renderContent(content, item.href);
            this.updateActiveTOC(item.href);
            this.updateNavigationButtons();
        } catch (error) {
            console.error('加载章节失败:', error);
            this.showError('加载章节失败');
        }
    }
    
    renderContent(html, basePath) {
        const contentArea = document.getElementById('content-area');
        
        // 解析HTML
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        
        // 处理图片资源
        const images = doc.querySelectorAll('img');
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
        
        // 获取body内容
        const body = doc.body;
        const styles = doc.querySelectorAll('style');
        
        // 清空并添加内容
        contentArea.innerHTML = '';
        
        // 添加样式
        styles.forEach(style => {
            contentArea.appendChild(style.cloneNode(true));
        });
        
        // 添加body内容
        while (body.firstChild) {
            contentArea.appendChild(body.firstChild);
        }
        
        // 滚动到顶部
        contentArea.scrollTop = 0;
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
            const itemId = `toc-${item.level}-${index}`;
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
            
            if (item.children.length > 0) {
                const childrenDiv = document.createElement('div');
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
        // 移除锚点部分
        const cleanHref = href.split('#')[0];
        
        // 在spine中查找对应项
        const index = this.spine.findIndex(item => 
            item.href === cleanHref || 
            item.href === href
        );
        
        if (index !== -1) {
            this.loadSpineItem(index);
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
        
        this.tocPanelCollapsed = !this.tocPanelCollapsed;
        
        if (this.tocPanelCollapsed) {
            tocPanel.classList.add('collapsed');
            toggleBtn.textContent = '展开';
        } else {
            tocPanel.classList.remove('collapsed');
            toggleBtn.textContent = '收起';
        }
    }
    
    showUploadArea() {
        document.getElementById('upload-area').style.display = 'flex';
        document.getElementById('reader-area').style.display = 'none';
        document.getElementById('file-input').value = '';
    }
    
    showReaderArea() {
        document.getElementById('upload-area').style.display = 'none';
        document.getElementById('reader-area').style.display = 'flex';
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

// 初始化阅读器
document.addEventListener('DOMContentLoaded', () => {
    new EPUBReader();
});
