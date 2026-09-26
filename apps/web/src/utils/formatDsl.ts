/**
 * format-dsl.js
 *
 * 将 HTML 页面转换为 DSL 结构，用于在 Pixso 中渲染组件。
 * 核心流程：加载 HTML → 解析 DOM 树 → 提取样式与组件信息 → 生成 DSL JSON。
 */
// @ts-nocheck

import { preCache, snapdom } from '@zumer/snapdom';

interface TokenValue {
  key?: string;
  [key: string]: unknown;
}

type TokenMap = Record<string, TokenValue | string>;

interface ComponentStyles {
  [key: string]: unknown;
}

interface ComponentObj {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  key?: string;
  weight?: string;
  unicode?: string;
  className?: string;
  component: Record<string, { styles?: ComponentStyles; [key: string]: unknown }>;
}

interface DslJson {
  beginRendering: {
    surfaceId: string;
    root: string;
    width: number;
    height: number;
    theme: string;
  };
  surfaceUpdate: {
    components: ComponentObj[];
  };
}

interface TextsMapItem {
  id: string;
  key: string;
  texts: string[];
}

interface FontUrlItem {
  url: string;
  fontFamilys: string[];
  codes: string[];
}

interface SizeInfo {
  width?: number;
  height?: number;
}

/**
 * 从 Pixso 服务器获取 token JSON 数据。
 */
export async function fetchTokenKeyJson(path: string): Promise<unknown> {
    const baseUrl = 'https://pixso.hikvision.com.cn/hik-plugin/ai-builder-web/public/webresources/tokens/';
    const url = baseUrl + encodeURIComponent(path);

    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        let result = await response.json();
        return result?.token
    } catch (error) {
        console.error('获取 token JSON 数据失败:', error);
        throw error;
    }
}

/**
 * 为 SVG 元素重新计算并设置 viewBox 与显示尺寸，留出指定边距。
 */
function resizeSVGToFit(svg: SVGSVGElement, padding = 0) {
    const bbox = svg.getBBox();

    // 添加留白
    const x = bbox.x - padding;
    const y = bbox.y - padding;
    const width = bbox.width + padding * 2;
    const height = bbox.height + padding * 2;

    // 设置 viewBox
    svg.setAttribute("viewBox", `${x} ${y} ${width} ${height}`);

    // 设置显示尺寸
    svg.setAttribute("width", width);
    svg.setAttribute("height", height);
    return { width, height }
}
/**
 * 将相对 URL 解析为绝对 URL。
 * 处理 `..` 目录跳转、协议相对路径等边界情况。
 */
function resolveAbsoluteUrl(baseUrl: string, relativePath: string) {
    // 若已是绝对路径，直接返回
    if (relativePath.startsWith('http://') || relativePath.startsWith('https://') || relativePath.startsWith('//')) {
        return relativePath;
    }

    try {
        // 使用URL构造函数解析基础URL
        const base = new URL(baseUrl);

        // 处理相对路径中的父目录引用
        let pathSegments = base.pathname.split('/').filter(segment => segment !== '');
        const relativeSegments = relativePath.split('/').filter(segment => segment !== '');
        pathSegments.splice(pathSegments.length - 1, 1);
        // 处理相对路径中的目录导航
        for (const segment of relativeSegments) {
            if (segment === '..') {
                // 向上导航一级
                if (pathSegments.length > 0) {
                    pathSegments.pop();
                }
            } else if (segment !== '.') {
                // 添加路径段
                pathSegments.push(segment);
            }
        }

        // 构建新的路径
        const newPath = '/' + pathSegments.join('/');

        // 创建新的URL对象
        const resolvedUrl = new URL(newPath, base);

        return resolvedUrl.href;
    } catch (error) {
        console.error('URL解析错误:', error);
        // 如果解析失败，尝试简单的字符串拼接
        if (baseUrl.endsWith('/') && relativePath.startsWith('/')) {
            return baseUrl + relativePath.substring(1);
        } else if (baseUrl.endsWith('/') || relativePath.startsWith('/')) {
            return baseUrl + relativePath;
        } else {
            return baseUrl + '/' + relativePath;
        }
    }
}
/**
 * 从文档样式表中提取字体图标 URL。
 * 遍历所有 @font-face 规则，匹配图标 unicode 编码，返回字体文件列表。
 */
function getFontUrls(documentObj: Document, iconfonts: string[]) {
    let fontFamilys = {};
    let codeFontFamilys = {};
    let fontUrls = new Set();
    // 遍历所有样式表
    for (let sheet of documentObj.styleSheets) {
        try {
            // 遍历样式表中的规则
            for (let rule of sheet.cssRules) {
                if (
                    rule.cssText?.indexOf('@font-face') > -1
                    // rule instanceof CSSFontFaceRule
                ) {
                    // console.log(rule);
                    const src = rule.style.getPropertyValue('src');
                    if (src) {
                        // 提取URL
                        const urlMatch = src.match(/url\(['"]?([^'")]+)['"]?\)/);
                        if (urlMatch && urlMatch[1]) {
                            fontUrls.add(urlMatch[1]);
                            const regex = /font-family\s*:\s*(["']?)([^"';]+)\1/i;
                            const match = rule.cssText.match(regex);
                            const fontFamily = match?.[2];
                            if (!fontFamilys[urlMatch[1]]) {
                                fontFamilys[urlMatch[1]] = {
                                    href: rule.parentStyleSheet.href,
                                    fontFamilys: [fontFamily],
                                }
                            } else {
                                fontFamilys[urlMatch[1]].fontFamilys.push(fontFamily)
                            }

                        }
                    }
                }
                // else if (rule.style.getPropertyValue('content')?.trim()) {
                //     let content = rule.style.getPropertyValue('content')?.trim()
                //     console.log('我的内容', content);
                //     content = content.replace(/\"/g, '').replace(/\//, '');
                //     let hexStr = "";
                //     for (let i = 0; i < content.length; i++) {
                //         hexStr += content.charCodeAt(i).toString(16)//.padStart(2, "0");
                //     }
                //     codeFontFamilys[hexStr] = rule.style.getPropertyValue('font-family')
                // } 
                else {
                    let content = rule.style?.getPropertyValue?.('content')?.trim?.()
                    if (content) {
                        content = content.replace(/\"/g, '').replace(/\//, '');
                        let hexStr = "";
                        for (let i = 0; i < content.length; i++) {
                            hexStr += content.charCodeAt(i).toString(16)//.padStart(2, "0");
                        }
                        let st = rule.selectorText?.replace(/(::before)/g, '').replace(/(::after)/g, '').replace(/\s+/g, '');
                        //console.log(iconfonts,hexStr,st);

                        if (iconfonts.find(i => i === hexStr)) {
                            codeFontFamilys[hexStr] = {}
                            let d
                            let st = rule.selectorText?.replace(/(::before)/g, '').replace(/(::after)/g, '').replace(/\s+/g, '');
                            st.split(',')?.map?.(s => {
                                if (!d) {
                                    d = documentObj.querySelector(s);
                                }
                            })
                            if (d) {
                                let style = window.getComputedStyle(d);
                                codeFontFamilys[hexStr].fontFamily = style.fontFamily.replace(/\"/g, '').split(',')?.[0]
                            }

                        }
                    }
                }
            }
        } catch (e) {
            // 处理跨域样式表的访问限制
            console.warn('无法访问样式表:', sheet.href);
        }
    }
    fontUrls = [...fontUrls].map(fu => {
        let obj = fontFamilys[fu];
        let value;
        if (fu.indexOf('http') === 0) {
            value = {
                url: fu,
                fontFamilys: obj.fontFamilys,
                codes: []
            }
            Object.keys(codeFontFamilys).map(k => {
                if (obj.fontFamilys.includes(codeFontFamilys[k].fontFamily)) {
                    value.codes.push(k);
                    // delete codeFontFamilys[k].fontFamily
                }
            })
        } else {
            // let url = resolveAbsoluteUrl(obj.href, fu);
            // value = {
            //     url,
            //     fontFamilys: obj.fontFamilys,
            //     codes: []
            // };
            // Object.keys(codeFontFamilys).map(k => {
            //     if (obj.fontFamilys.includes(codeFontFamilys[k].fontFamily)) {
            //         value.codes.push(k);
            //         // delete codeFontFamilys[k].fontFamily
            //     }
            // })
        }
        return value;
    });
    // console.log('codeFontFamilys', codeFontFamilys, 'fontFamilys', fontFamilys)

    return [...fontUrls];
}
function getIsCanRenderNode(n: Element) {
    let style = window.getComputedStyle(n);

    let flag = n.getAttribute('component-key')
        || (n.tagName !== 'SCRIPT'
            && n.tagName !== 'STYLE'
            && n.tageName !== 'TEMPLATE'
            && style.display !== 'none'
            && style.visibility !== 'hidden'
            && style.opacity !== '0'
            && style.opacity !== 0
            && !(n.tageName === 'INPUT' && n.getAttribute('type') === 'hidden')
            && !getIsJustDefsSvg(n)
            && getIsNotZeroSize(n));
    return flag
}
function getIsComplexSvg(dom: Element) {
    let componentName = dom.tagName.toLowerCase();
    if (componentName !== 'svg') return false;
    // 检查 outerHTML 中是否有 url(#xxx) 引用
    if (dom.outerHTML.includes('url(#')) return true;
    // 检查子元素属性或样式中是否有 url(#xxx) 引用
    for (const child of dom.querySelectorAll('*')) {
        for (const attr of ['fill', 'stroke', 'filter', 'clip-path', 'mask']) {
            const val = child.getAttribute(attr);
            if (val && val.includes('url(#')) return true;
        }
        const cs = window.getComputedStyle(child);
        for (const prop of ['backgroundImage', 'filter']) {
            if (cs[prop] && cs[prop].includes('url(#')) return true;
        }
    }
    return false;
}
function getIsJustDefsSvg(dom: Element) {
    let componentName = dom.tagName.toLowerCase();
    if (componentName !== 'svg') return false;
    const children = dom.children;
    if (children.length === 0) return false;
    if (children.length === 1 && children[0].tagName?.toLowerCase() === 'defs') return true;
    return false;
}
function getIsNotZeroSize(dom: Element) {
    let rect = dom.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
}
function getDefNodes(documentObj: Document, svgdom: Element) {
    const svgHtml = svgdom.outerHTML;
    // 1. 收集所有 url(#xxx) 引用
    const urlRefs = new Set();
    // 匹配 outerHTML 中的 url(#xxx)
    const htmlMatches = svgHtml.matchAll(/url\(\s*#([^\s#)'"]+)\s*\)/g);
    for (const m of htmlMatches) urlRefs.add(m[1]);
    // 匹配 computed style 中的 url(#xxx)（如 background-image, filter, fill 等）
    for (const child of svgdom.querySelectorAll('*')) {
        const cs = window.getComputedStyle(child);
        const styleProps = ['backgroundImage', 'filter', 'fill', 'stroke', 'clipPath'];
        for (const prop of styleProps) {
            const val = cs[prop];
            if (val) {
                const matches = val.matchAll(/url\(\s*#([^\s#)'"]+)\s*\)/g);
                for (const m of matches) urlRefs.add(m[1]);
            }
        }
        // 也检查元素属性中的 url(#xxx)
        for (const attr of ['fill', 'stroke', 'filter', 'clip-path', 'mask']) {
            const val = child.getAttribute(attr);
            if (val) {
                const matches = val.matchAll(/url\(\s*#([^\s#)'"]+)\s*\)/g);
                for (const m of matches) urlRefs.add(m[1]);
            }
        }
    }
    if (urlRefs.size === 0) return;

    // 2. 从 documentObj 中查找定义
    const defsMap = new Map();
    for (const id of urlRefs) {
        const el = documentObj.getElementById(id);
        if (el && el.parentNode) {
            defsMap.set(id, el.outerHTML);
        }
    }

    // 3. 将定义注入到 svgdom 的 <defs> 中
    let defs = svgdom.querySelector('defs');
    if (!defs) {
        defs = documentObj.createElementNS('http://www.w3.org/2000/svg', 'defs');
        svgdom.insertBefore(defs, svgdom.firstChild);
    }
    const existingDefs = defs.innerHTML;
    for (const [id, html] of defsMap) {
        // 避免重复注入
        if (!existingDefs.includes(`id="${id}"`)) {
            defs.innerHTML += '\n' + html;
        }
    }
}
/**
 * 将 HTML 文档转换为 DSL JSON 结构。
 * 递归遍历 DOM 树，提取每个元素的样式、尺寸、组件类型，最终生成 Pixso 可渲染的 DSL。
 */
async function htmlToDsl(documentObj: Document, rootWidth: number, rootHeight: number, theme = "", token?: TokenMap) {
    let body = documentObj.body;
    let subpagename = documentObj.head.getAttribute('subpagename');
    let title = (documentObj.title || '个性页') + (subpagename ? '#' + subpagename : '')
    let root = 'body#html2dsl#' + (Math.random() + '').replace('.', '');
    let json = {
        beginRendering: {
            surfaceId: title,
            root,
            width: rootWidth,
            height: rootHeight,
            theme
        },
        surfaceUpdate: {
            components: []
        }
    };
    let sizeMap = {};
    let bodyStyle = {};
    let promiseList = [];
    let iconfonts = [];
    let textsMap = []
    /**
     * 将网络图片转换为 Base64。
     * 通过 canvas 绘制后 toDataURL 实现跨域图片转换。
     */
    function imageToBase64(imageUrl) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'Anonymous';

            img.onload = function () {
                try {
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');
                    canvas.width = img.width;
                    canvas.height = img.height;
                    ctx.drawImage(img, 0, 0, img.width, img.height);
                    const base64 = canvas.toDataURL('image/png');
                    resolve(base64);
                } catch (error) {
                    resolve();
                }
            };

            img.onerror = function () {
                resolve();
            };

            img.src = imageUrl;
        });
    }
    /**
     * 严格判断元素是否仅包含文本节点（不含子元素）。
     * 仅 TEXT_NODE 和 COMMENT_NODE 被允许。
     */
    function isTextOnlyStrict(element) {
        const childNodes = element.childNodes;

        if (childNodes.length === 0) {
            return false;
        }

        for (let i = 0; i < childNodes.length; i++) {
            const node = childNodes[i];
            if (node.nodeType !== Node.TEXT_NODE && node.nodeType !== Node.COMMENT_NODE) {
                return false;
            }
        }

        return true;
    }
    /**
     * 递归提取元素中的文本内容。
     * 过滤纯空白文本，保留含中文/英文/数字的有效文本。
     */
    function setTexts(element, texts) {
        if (!element || !texts || !Array.isArray(texts)) {
            return false;
        }

        const childNodes = element.childNodes;

        if (childNodes.length === 0) {
            return true;
        }

        for (let i = 0; i < childNodes.length; i++) {
            const node = childNodes[i];

            if (node.nodeType === Node.TEXT_NODE) {
                const text = node.textContent.trim();
                const regex = /[\u4e00-\u9fa5a-zA-Z0-9]/;

                if (text && regex.test(text)) {
                    texts.push(text);
                }
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                // 创建新的嵌套数组
                const nestedTexts = [];
                setTexts(node, nestedTexts);

                // 只有当子节点有有效文本时才添加到结果中
                if (nestedTexts.length > 0) {
                    if (nestedTexts.length > 1) {
                        // texts.push(nestedTexts);
                        nestedTexts.forEach(t => {
                            texts.push(t);
                        })
                    } else {
                        texts.push(nestedTexts[0]);
                    }

                }
            }
        }

        return texts.length > 0;
    }
    /**
     * 将 oklch 颜色值转换为 rgba 字符串。
     * oklch → okLab → LMS → RGB → sRGB，完整色彩空间转换链路。
     */
    function oklchToRgba(str) {
        if (typeof str !== 'string' || !str.includes('oklch')) return str;
        // 匹配所有 oklch(...) 数据，替换为 rgba 格式
        return str.replace(/oklch\s*\(\s*([^\s,)]+)[\s,]+([^\s,)]+)[\s,]+([^\s/,)]+)(?:\s*\/\s*([^\s)]+))?\s*\)/gi, (match, lStr, cStr, hStr, aStr) => {
            let l = Number(lStr);
            let c = Number(cStr);
            let h = Number(hStr);
            let a = aStr !== undefined ? parseFloat(aStr) : 1;
            if ([l, c, h].some(isNaN)) return match;
            const rad = h * Math.PI / 180;
            const lab = [l, c * Math.cos(rad), c * Math.sin(rad)];
            // okLab转rgb，精简实现
            let [L, A, B] = lab;
            let l_ = L + 0.3963377774 * A + 0.2158037573 * B;
            let m_ = L - 0.1055613458 * A - 0.0638541728 * B;
            let s_ = L - 0.0894841775 * A - 1.2914855480 * B;
            let l3 = l_ ** 3, m3 = m_ ** 3, s3 = s_ ** 3;
            let r = 4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3;
            let g = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3;
            let b = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.7076147010 * s3;
            const toSrgb = v => Math.round(Math.max(0, Math.min(1, v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)) * 255);
            return `rgba(${toSrgb(r)},${toSrgb(g)},${toSrgb(b)},${isNaN(a) ? 1 : a})`;
        });
    }
    /**
     * 递归修正 SVG 元素中的 stroke、fill 等颜色属性。
     * 用计算样式覆盖内联属性，确保颜色渲染一致。
     */
    function resetSvgStrokeOrFill(dom) {
        /**
         * 递归处理节点，获取其stroke, stroke-opacity, fill属性，
         * 若存在，则替换成计算样式中的值
         */
        function processNode(node) {
            let cstyle = window.getComputedStyle(node);
            // 处理stroke、stroke-opacity、fill属性
            if (node.hasAttribute('stroke')) {
                // 计算样式中的stroke
                const computedStroke = cstyle.stroke;
                if (computedStroke && computedStroke !== 'none') {
                    node.setAttribute('stroke', oklchToRgba(computedStroke));
                }
            }
            if (node.hasAttribute('stroke-opacity')) {
                const computedStrokeOpacity = cstyle['stroke-opacity'];
                if (computedStrokeOpacity) {
                    node.setAttribute('stroke-opacity', computedStrokeOpacity);
                }
            }
            if (node.hasAttribute('fill')) {
                const computedFill = cstyle.fill;
                if (computedFill && computedFill !== 'none') {
                    node.setAttribute('fill', oklchToRgba(computedFill));
                }
            }
            if (node.hasAttribute('stop-color')) {
                const computedStopColor = cstyle['stop-color'];
                if (computedStopColor) {
                    node.setAttribute('stop-color', oklchToRgba(computedStopColor));
                }
            }
            // 递归处理子节点
            for (let i = 0; i < node.children.length; i++) {
                processNode(node.children[i]);
            }
        }
        // 寻找SVG根节点
        const svg = dom.tagName?.toLowerCase() === 'svg' ? dom : dom.querySelector('svg');
        if (svg) {
            processNode(svg);
        }



    }
    /**
     * 特殊处理 Element Plus 表格组件 (el-table)。
     * 将隐藏列中的数据提取为 Row + Div 结构，保留表格数据映射。
     */
    function handleElementPlus(dom, id, resolve, reject) {
        if (dom.classList?.contains?.('el-table')
            && dom.querySelector('[component-key]')
            && !dom.querySelector('.hidden-columns > div > div')) {
            let prect = dom !== body ? dom.parentElement?.getBoundingClientRect?.() : { left: 0, top: 0 };
            let px = prect.left//Math.ceil(prect.left);
            let py = prect.top//Math.ceil(prect.top);
            let rect = dom.getBoundingClientRect();
            let x = rect.left - px//Math.ceil(rect.left);
            let y = rect.top - py//Math.ceil(rect.top);
            let width = id === root ? rootWidth : rect.width;//Math.ceil(rect.width);
            let height = id === root ? rootHeight : rect.height//Math.ceil(rect.height);

            let rowObj = {
                id,
                x,
                y,
                width,
                height,
                component: {
                    Row: {
                        styles: {
                            itemSpacing: 0
                        },
                        children: {
                            explicitList: []
                        }
                    }
                }
            }
            json.surfaceUpdate.components.push(rowObj);
            let cdoms = dom.querySelectorAll('.hidden-columns > div');
            cdoms && [...cdoms].map((cdom, index) => {
                let tr = dom.querySelector('tr');
                let td = tr.children[index];
                let tdRect = td.getBoundingClientRect();
                let w = tdRect.width;
                let h = height;
                let sid = 'div#html2dsl#' + (Math.random() + '').replace('.', '')
                let sobj = {
                    id: sid,
                    x: 0,
                    y: 0,
                    width: w,
                    height: h,
                    component: {
                        Div: {
                            styles: {}
                        }
                    }
                }

                rowObj.component.Row.children.explicitList.push(sid);
                json.surfaceUpdate.components.push(sobj);
                let key = cdom.getAttribute('component-key')
                if (key) {
                    sobj.key = key;

                    let textsObj = {
                        id,
                        key,
                        texts: []
                    }
                    let trs = dom.querySelectorAll('tbody > tr');
                    let th = dom.querySelector('thead > tr')?.children[index];
                    let texts = [];
                    th && setTexts(th, texts);
                    if (texts.length) {
                        textsObj.texts.push(texts.join())
                    }
                    trs && [...trs].map(tr => {
                        let td = tr.children[index];
                        let texts = [];
                        td && setTexts(td, texts);
                        if (texts.length) {
                            textsObj.texts.push(texts.join())
                        }
                    })

                    if (textsObj.texts.length) {
                        textsMap.push(textsObj);
                    }
                }
            })
            resolve({ rowObj });
            return true;
        }
        return false;
    }



    /**
     * 递归地将 DOM 节点转换为 DSL 组件 JSON。
     * 判断元素类型（Row/Column/Text/Image/Svg/Icon 等），提取样式、布局、文本，构建组件树。
     */
    async function getComponentJson(dom, id, pstyles) {
        // if (dom.tagName === 'SCRIPT' || dom.tagName === 'STYLE' || dom.tagName === 'TEMPLATE') {
        //     return;
        // }
        return new Promise(async (resolve, reject) => {
            let childrenPromiseList = [];
            let curStyle = window.getComputedStyle(dom);
            let componentName = dom.tagName.toLowerCase();
            // if (handleElementPlus(dom, id, resolve, reject)) {
            //     resolve();
            //     return;
            // }
            // 判断元素类型
            const isCanvas = componentName === 'canvas';
            const isSvg = componentName === 'svg' && dom.children[0]?.tagName !== 'text';
            const isComplexSvg = getIsComplexSvg(dom);
            const isImg = componentName === 'img';
            const isIcon = componentName === 'i' && dom.className.indexOf('h-icon-') > -1;
            const isRadio = dom.tagName === 'INPUT' && dom.getAttribute('type') === 'radio'
            const isCheckbox = dom.tagName === 'INPUT' && dom.getAttribute('type') === 'checkbox'
            var beforeStyle = window.getComputedStyle(dom, ":before");
            var afterStyle = window.getComputedStyle(dom, ":after");

            // 将 :before 伪元素渲染为真实 DOM，以便后续递归解析
            if (!isIcon && beforeStyle.display !== 'none'
                && beforeStyle.pointerEvents !== 'none'
                && beforeStyle.width !== 'auto' && beforeStyle.width !== '0px'
                && beforeStyle.height !== 'auto' && beforeStyle.height !== '0px'
                && beforeStyle.zIndex?.indexOf('-') < 0
                //&& beforeStyle.content?.replace(/\"/g, '')
                // && (beforeStyle.content.trim()
                //     || (beforeStyle.left.indexOf('-') < 0
                //         && beforeStyle.top.indexOf('-') < 0))
            ) {
                let {
                    opacity,
                    backgroundColor,
                    backgroundImage,
                    width,
                    height,
                    position,
                    left,
                    top,
                    right,
                    bottom,
                    color,
                    fontSize,
                    fontWeight,
                    textAlign,
                    verticalAlign,
                    lineHeight,
                    letterSpacing,
                    marginTop,
                    marginRight,
                    marginBottom,
                    marginLeft,
                    paddingTop,
                    paddingRight,
                    paddingBottom,
                    paddingLeft,
                    borderTopLeftRadius,
                    borderTopRightRadius,
                    borderBottomLeftRadius,
                    borderBottomRightRadius,
                    borderLeft,
                    borderRight,
                    borderTop,
                    borderBottom,
                    boxShadow,
                    transform,
                    zIndex
                } = beforeStyle;
                const rect = dom.querySelector(":before")?.getBoundingClientRect();
                const beforeElement = document.createElement('div');
                beforeElement.style.boxSizing = 'content-box';
                beforeElement.style.borderLeft = borderLeft;
                beforeElement.style.borderRight = borderRight;
                beforeElement.style.borderTop = borderTop;
                beforeElement.style.borderBottom = borderBottom;
                beforeElement.style.borderTopLeftRadius = borderTopLeftRadius;
                beforeElement.style.borderTopRightRadius = borderTopRightRadius;
                beforeElement.style.borderBottomLeftRadius = borderBottomLeftRadius;
                beforeElement.style.borderBottomRightRadius = borderBottomRightRadius;
                beforeElement.style.padding = `${paddingTop} ${paddingRight} ${paddingBottom} ${paddingLeft}`;
                beforeElement.style.margin = `${marginTop} ${marginRight} ${marginBottom} ${marginLeft}`;
                beforeElement.style.backgroundColor = backgroundColor;
                beforeElement.style.backgroundImage = backgroundImage;
                beforeElement.style.width = width
                beforeElement.style.height = height;
                beforeElement.style.position = position;
                beforeElement.style.top = top;
                beforeElement.style.left = left;
                beforeElement.style.right = right;
                beforeElement.style.bottom = bottom;
                beforeElement.style.color = color;
                beforeElement.style.fontSize = fontSize;
                beforeElement.style.fontWeight = fontWeight;
                beforeElement.style.textAlign = textAlign;
                beforeElement.style.verticalAlign = verticalAlign;
                beforeElement.style.lineHeight = lineHeight;
                beforeElement.style.letterSpacing = letterSpacing;
                beforeElement.style.color = color;
                beforeElement.style.opacity = opacity;
                beforeElement.style.boxShadow = boxShadow;
                beforeElement.style.transform = transform;
                beforeElement.style.zIndex = zIndex;
                beforeElement.innerHTML = (beforeStyle.content || '').replace(/(^")|("$)/g, '');
                dom.classList.add('hide-css-dom');
                //dom.insertBefore(beforeElement, dom.children[0]);
                dom.innerHTML = beforeElement.outerHTML + dom.innerHTML;
                //if (beforeElement.innerHTML) {

                //}
            }
            // 将 :after 伪元素渲染为真实 DOM
            if (!isIcon && afterStyle.display !== 'none'
                && afterStyle.pointerEvents !== 'none'
                && afterStyle.width !== 'auto' && afterStyle.width !== '0px'
                && afterStyle.height !== 'auto' && afterStyle.height !== '0px'
                && afterStyle.zIndex?.indexOf('-') < 0
                //&& afterStyle.content?.replace(/\"/g, '')
                // && (afterStyle.content.trim()
                //     || (afterStyle.left.indexOf('-') < 0
                //         && afterStyle.top.indexOf('-') < 0))
            ) {
                let {
                    opacity,
                    backgroundColor,
                    backgroundImage,
                    width,
                    height,
                    position,
                    left,
                    top,
                    right,
                    bottom,
                    color,
                    fontSize,
                    fontWeight,
                    textAlign,
                    verticalAlign,
                    lineHeight,
                    letterSpacing,
                    paddingTop,
                    paddingRight,
                    paddingBottom,
                    paddingLeft,
                    marginTop,
                    marginRight,
                    marginBottom,
                    marginLeft,
                    borderTopLeftRadius,
                    borderTopRightRadius,
                    borderBottomLeftRadius,
                    borderBottomRightRadius,
                    borderLeft,
                    borderRight,
                    borderTop,
                    borderBottom,
                    boxShadow,
                    transform,
                    zIndex
                } = afterStyle;
                const afterElement = document.createElement('div');
                afterElement.style.boxSizing = 'content-box';
                afterElement.style.opacity = opacity;
                afterElement.style.borderLeft = borderLeft;
                afterElement.style.borderRight = borderRight;
                afterElement.style.borderTop = borderTop;
                afterElement.style.borderBottom = borderBottom;
                afterElement.style.borderTopLeftRadius = borderTopLeftRadius;
                afterElement.style.borderTopRightRadius = borderTopRightRadius;
                afterElement.style.borderBottomLeftRadius = borderBottomLeftRadius;
                afterElement.style.borderBottomRightRadius = borderBottomRightRadius;

                afterElement.style.padding = `${paddingTop} ${paddingRight} ${paddingBottom} ${paddingLeft}`;
                afterElement.style.margin = `${marginTop} ${marginRight} ${marginBottom} ${marginLeft}`;
                afterElement.style.backgroundColor = backgroundColor;
                afterElement.style.backgroundImage = backgroundImage;
                afterElement.style.width = width
                afterElement.style.height = height;
                afterElement.style.position = position;
                afterElement.style.top = top;
                afterElement.style.left = left;
                afterElement.style.right = right;
                afterElement.style.bottom = bottom;
                afterElement.style.color = color;
                afterElement.style.fontSize = fontSize;
                afterElement.style.fontWeight = fontWeight;
                afterElement.style.textAlign = textAlign;
                afterElement.style.verticalAlign = verticalAlign;
                afterElement.style.lineHeight = lineHeight;
                afterElement.style.letterSpacing = letterSpacing;
                afterElement.style.boxShadow = boxShadow;
                afterElement.style.transform = transform;
                afterElement.style.zIndex = zIndex;
                afterElement.innerHTML = (afterStyle.content || '').replace(/(^")|("$)/g, '');
                dom.classList.add('hide-css-dom');
                dom.appendChild(afterElement);
                //if (afterElement.innerHTML) {

                //}
            }
            const isText = isTextOnlyStrict(dom)
                || dom.tagName === 'INPUT'
                || dom.tagName === 'TEXTAREA'
                || dom.tagName === 'SELECT';
            let styles = {};
            let pstyle = dom !== body ? window.getComputedStyle(dom.parentElement) : {}
            let prect = dom !== body ? dom.parentElement?.getBoundingClientRect?.() : { left: 0, top: 0 };
            let px = prect.left//Math.ceil(prect.left);
            let py = prect.top//Math.ceil(prect.top);
            let rect = dom.getBoundingClientRect();
            let x = rect.left - px//Math.ceil(rect.left);
            let y = rect.top - py//Math.ceil(rect.top);
            let width = id === root ? rootWidth : rect.width;//Math.ceil(rect.width);
            let height = id === root ? rootHeight : rect.height//Math.ceil(rect.height);


            if (curStyle.transform.indexOf('matrix') > -1) {
                let cssWidth = Number(curStyle.width.replace('px', ''));
                let cssHeight = Number(curStyle.height.replace('px', ''));
                width = isNaN(cssWidth) ? width : cssWidth;
                height = isNaN(cssHeight) ? height : cssHeight;

            }

            // if (id !== root) {
            //     if (curStyle.right.indexOf('-') === 0) {
            //         width += Number(curStyle.right.replace('-', '').replace('px', ''));
            //     }
            //     if (curStyle.bottom.indexOf('-') === 0) {
            //         height += Number(curStyle.bottom.replace('-', '').replace('px', ''));
            //     }
            // }
            if (curStyle.maxWidth && curStyle.maxWidth !== 'none') {
                let maxWidthNumber = Number(curStyle.maxWidth.replace('px', ''));
                if (width > maxWidthNumber) {
                    width = maxWidthNumber;
                }
            }
            if (curStyle.maxHeight && curStyle.maxHeight !== 'none') {
                let maxHeightNumber = Number(curStyle.maxHeight.replace('px', ''));
                if (height > maxHeightNumber) {
                    height = maxHeightNumber;
                }
            }
            if (pstyle.display?.indexOf('flex') < 0 && dom !== body) {

                // let marginLeft = Number(pstyle.marginLeft.replace('px', ''));
                // let marginTop = Number(pstyle.marginTop.replace('px', ''));
                // let marginRight = Number(pstyle.marginRight.replace('px', ''));
                // let marginBottom = Number(pstyle.marginBottom.replace('px', ''));
                // marginLeft = isNaN(marginLeft)||marginLeft<0 ? 0 : marginLeft;
                // marginTop = isNaN(marginTop)||marginTop<0 ? 0 : marginTop;
                // marginRight = isNaN(marginRight)||marginRight<0 ? 0 : marginRight;
                // marginBottom = isNaN(marginBottom)||marginBottom<0 ? 0 : marginBottom;
                // x += marginLeft;
                // y += marginTop;
            }

            // width = width % 2 !== 0 ? width + 1 : width;
            // height = height % 2 !== 0 ? height + 1 : height;
            // if(dom.parentElement===body&&curStyle.position==='fixed'){
            //     dom.style.position = 'relative';
            // }
            if (curStyle.position === 'fixed') {
                // console.log('我的位置', px, py, x, y, width, height, dom.parentElement)
            }
            if (curStyle.transform !== 'none') {
                styles.transform = curStyle.transform;
            }
            styles.position = curStyle.position;
            //styles.clipsContent = (curStyle.overflowX === 'hidden' || curStyle.overflowX === 'clip') && (curStyle.overflowY === 'hidden' || curStyle.overflowY === 'clip');
            styles.zIndex = curStyle.zIndex === 'auto' ? 0 : Number(curStyle.zIndex)
            let isFlex = curStyle.display.indexOf('flex') > -1;
            let isGrid = curStyle.display.indexOf('grid') > -1;
            if ((isFlex || isGrid) && ![...dom.children].find(child => {
                const style = window.getComputedStyle(child);
                return style.position === 'absolute' || style.position === 'fixed';
            })) {

                if (isFlex) {
                    if (curStyle.flexDirection === 'row') {
                        componentName = 'Row';
                    } else {
                        componentName = 'Column';
                    }
                    if (curStyle.flexWrap === 'wrap') {
                        styles.wrap = true;
                    }
                }
                styles.distribution = curStyle.justifyContent
                    .replace('normal', 'start')
                    .replace('flex-', '')
                    .replace('-around', 'Around')
                    .replace(-'between', 'Between')
                styles.alignment = curStyle.alignItems
                    .replace('normal', 'start')
                    .replace('flex-', '')
                    .replace('-around', 'Around')
                    .replace('-between', 'Between');
                // let total = 0;
                // [...(dom.children || [])].map(child => {
                //     let style = window.getComputedStyle(child);
                //     if (curStyle.flexDirection === 'row') {
                //         total += Number(style.marginLeft.replace('px', '')) + Number(style.marginRight.replace('px', ''))
                //     } else {
                //         total += Number(style.marginTop.replace('px', '')) + Number(style.marginBottom.replace('px', ''))
                //     }

                // })
                let gap = curStyle.flexDirection === 'row' ? Number(curStyle.rowGap.replace('px', ''))
                    : Number(curStyle.columnGap.replace('px', ''));

                //let itemSpacingExtent = dom.children?.length>1 ? total / (dom.children.length-1) : total;
                if (styles.alignment.indexOf('Between') < 0) {
                    if (!isNaN(gap)) {
                        styles.itemSpacing = gap// + itemSpacingExtent;
                    } else {
                        styles.itemSpacing = 0;
                    }
                }
                // let mr = 0, ml = 0;
                // if (dom.children?.[0]) {
                //     let _style = window.getComputedStyle(dom.children[0]);
                //     mr = Number(_style.marginRight.replace('px', ''));
                // }
                // if (dom.children?.[1]) {
                //     let _style = window.getComputedStyle(dom.children[1]);
                //     ml = Number(_style.marginLeft.replace('px', ''));

                // }
                //styles.itemSpacing += mr + ml;

            }
            styles.opacity = Number(curStyle.opacity);
            styles.backgroundSize = curStyle.backgroundSize;
            styles.backgroundColor = curStyle.backgroundColor;
            styles.backgroundColor = oklchToRgba(styles.backgroundColor);
            styles.backgroundColor = token?.['color:' + styles.backgroundColor] || styles.backgroundColor;
            const backgroundImage = oklchToRgba(curStyle.backgroundImage);
            if (
                backgroundImage !== 'none'
                || curStyle.clipPath !== 'none'
            ) {
                if (curStyle.clipPath !== 'none'
                    || backgroundImage.indexOf('repeating') > -1
                    || backgroundImage.indexOf('radial') > -1
                    || backgroundImage.indexOf('conic') > -1
                    || curStyle.backgroundSize.indexOf('px') > 0
                ) {
                    if (curStyle.clipPath !== 'none') {
                        dom.style.border = 'none';
                        dom.style.overflow = 'hidden';
                    }
                    [...dom.children].forEach(child => {
                        child.style.visibility = 'hidden';
                    });
                    const pngImage = await snapdom.toPng(dom);
                    const base64Url = pngImage.getAttribute('src');
                    styles.backgroundImage = base64Url;
                    [...dom.children].forEach(child => {
                        child.style.visibility = 'visible';
                    });
                    // width = realWidth;
                    // height = realHeight;
                    delete styles.transform
                } else if (backgroundImage.indexOf('url') > -1) {
                    let url = backgroundImage.slice(5, -2);
                    if (url.indexOf('data:image/svg+xml,') > -1) {
                        styles.backgroundImage = url;//decodeURIComponent(url);
                    } else {
                        const localImageBase64 = await imageToBase64(url);
                        if (localImageBase64) {
                            styles.backgroundImage = localImageBase64//dom.getAttribute('src');
                        }
                    }


                } else {
                    styles.backgroundImage = backgroundImage
                    styles.backgroundSize = curStyle.backgroundSize;
                }
            }
            styles.backgroundClip = curStyle.backgroundClip;

            // styles.borderLeft = 'solid 1px #ff0000'
            // styles.borderRight = 'solid 1px #ff0000'
            // styles.borderTop = 'solid 1px #ff0000'
            // styles.borderBottom = 'solid 1px #ff0000'
            //if (!isText) {
            let borderTopLeftRadius, borderTopRightRadius, borderBottomLeftRadius, borderBottomRightRadius;
            if (curStyle.borderTopLeftRadius.indexOf('%') > -1) {
                borderTopLeftRadius = Math.round(Number(curStyle.borderTopLeftRadius.replace('%', '')) / 100 * rect.width) + ''
            } else {
                borderTopLeftRadius = curStyle.borderTopLeftRadius;
            }
            if (curStyle.borderTopRightRadius.indexOf('%') > -1) {
                borderTopRightRadius = Math.round(Number(curStyle.borderTopRightRadius.replace('%', '')) / 100 * rect.width) + ''
            } else {
                borderTopRightRadius = curStyle.borderTopRightRadius;
            }
            if (curStyle.borderBottomLeftRadius.indexOf('%') > -1) {
                borderBottomLeftRadius = Math.round(Number(curStyle.borderBottomLeftRadius.replace('%', '')) / 100 * rect.width) + ''
            } else {
                borderBottomLeftRadius = curStyle.borderBottomLeftRadius;
            }
            if (curStyle.borderBottomRightRadius.indexOf('%') > -1) {
                borderBottomRightRadius = Math.round(Number(curStyle.borderBottomRightRadius.replace('%', '')) / 100 * rect.width) + ''
            } else {
                borderBottomRightRadius = curStyle.borderBottomRightRadius;
            }
            styles.borderTopLeftRadius = Number(borderTopLeftRadius.replace('px', ''))
            styles.borderTopRightRadius = Number(borderTopRightRadius.replace('px', ''))
            styles.borderBottomLeftRadius = Number(borderBottomLeftRadius.replace('px', ''))
            styles.borderBottomRightRadius = Number(borderBottomRightRadius.replace('px', ''))

            // if (styles.borderTopLeftRadius
            //     || styles.borderTopRightRadius
            //     || styles.borderBottomLeftRadius
            //     || styles.borderBottomRightRadius) {
            //     styles.clipsContent = true;
            // }

            let borderLeft = Math.round(Number(curStyle.borderLeftWidth.replace('px', '')));
            let borderRight = Math.round(Number(curStyle.borderRightWidth.replace('px', '')));
            let borderTop = Math.round(Number(curStyle.borderTopWidth.replace('px', '')));
            let borderBottom = Math.round(Number(curStyle.borderBottomWidth.replace('px', '')));

            const getBorderColor = (color) => {
                const tokenValue = token?.['color:' + color];
                if (tokenValue?.key) {
                    return `${color}#${tokenValue.key}`;
                }
                if (tokenValue) {
                    return tokenValue;
                }
                return color;
            };

            const borderLeftColor = getBorderColor(curStyle.borderLeftColor);
            const borderRightColor = getBorderColor(curStyle.borderRightColor);
            const borderTopColor = getBorderColor(curStyle.borderTopColor);
            const borderBottomColor = getBorderColor(curStyle.borderBottomColor);

            styles.borderLeft = `solid ${borderLeft}px ${borderLeftColor}`;
            styles.borderRight = `solid ${borderRight}px ${borderRightColor}`;
            styles.borderTop = `solid ${borderTop}px ${borderTopColor}`;
            styles.borderBottom = `solid ${borderBottom}px ${borderBottomColor}`;
            //}
            // let ml = Number(curStyle.marginLeft.replace('px', ''))
            // let mr = Number(curStyle.marginRight.replace('px', ''));
            // let mt = Number(curStyle.marginTop.replace('px', ''))
            // let mb = Number(curStyle.marginBottom.replace('px', ''));
            // ml = isNaN(ml)||ml<0 ? 0 : ml;
            // mr = isNaN(mr)||mr<0 ? 0 : mr;
            // mt = isNaN(mt)||mt<0 ? 0 : mt;
            // mb = isNaN(mb)||mb<0 ? 0 : mb;
            styles.padding = [
                Number(curStyle.paddingTop.replace('px', '')),
                Number(curStyle.paddingRight.replace('px', '')),
                Number(curStyle.paddingBottom.replace('px', '')),
                Number(curStyle.paddingLeft.replace('px', ''))
            ]
            if (dom.parentElement !== documentObj.body && documentObj.body.children.length !== 1) {
                styles.margin = [
                    Number(curStyle.marginTop.replace('px', '')),
                    Number(curStyle.marginRight.replace('px', '')),
                    Number(curStyle.marginBottom.replace('px', '')),
                    Number(curStyle.marginLeft.replace('px', ''))
                ]
            }

            if (curStyle.boxShadow !== 'none') {
                styles.boxShadow = token?.['effect:' + curStyle.boxShadow] || curStyle.boxShadow;
                if (pstyles) {
                    pstyles.clipsContent = false;
                }
            }


            // 根据元素特征确定组件类型
            if (isRadio) {
                componentName = 'Radio'
            } else if (isCheckbox) {
                componentName = 'Checkbox'
            } else if (isSvg) {
                componentName = 'Svg'
            } else if (isImg || isCanvas) {
                componentName = 'Image'
            } else if (isIcon) {
                componentName = 'Icon'
            } else if (isText) {
                componentName = 'Text'
            }
            let obj = {
                id,
                x,
                y,
                width,
                height,
                component: {
                    [componentName]: {
                        styles
                    }
                }
            }
            // 提取组件 key 与文本映射
            if (dom.getAttribute('component-key')) {
                let key = dom.getAttribute('component-key');
                if (key) {
                    obj.key = key
                    let textsObj = {
                        id,
                        key,
                        texts: []
                    }
                    setTexts(dom, textsObj.texts);
                    if (textsObj.texts.length) {
                        textsMap.push(textsObj);
                    }
                }
            }
            if (dom.getAttribute('component-texts')) {
                obj.component[componentName].texts = dom.getAttribute('component-texts').split(',');
            }
            if (dom === body) {
                obj.surfaceId = title
            }
            json.surfaceUpdate.components.push(obj);
            // 叶子节点
            // if (!isText) {
            //     dom.childNodes.forEach(child => {
            //         if (child.nodeType === 3) {
            //             dom.innerHTML = dom.innerHTML.replace(child.textContent, `<span>${child.textContent.trim()}</span>`);
            //         }
            //     })
            // }
            if (curStyle.flexGrow === "1") {
                obj.weight = curStyle.flexGrow
            }
            if (obj.key) {
                if (dom.getAttribute('hiktempsvgname') || dom.getAttribute('hiktempiconname')) {
                    styles.currentColor = curStyle.color;
                    styles.currentColor = token?.['color:' + styles.currentColor] || styles.currentColor;
                }
                // 组件类处理
            } else if (isRadio || isCheckbox) {
                obj.component[componentName].checked = dom.checked;
                if (dom.checked) {
                    styles.color = curStyle.accentColor && curStyle.accentColor !== 'auto' ? curStyle.accentColor : 'rgb(24, 144, 255)'
                } else {
                    styles.color = curStyle.color;
                }
                styles.color = token?.['color:' + styles.color] || styles.color;
                // styles.color = dom.checked
                // ?:curStyle.color;
            } else if (isSvg) {
                if (isComplexSvg) {
                    getDefNodes(documentObj, dom);
                    const pngImage = await snapdom.toPng(dom);
                    const base64Url = pngImage.getAttribute('src');
                    obj.component[componentName].imgSrc = base64Url;
                } else {
                    resetSvgStrokeOrFill(dom);
                    obj.component[componentName].svg = dom.outerHTML.trim()
                        .replace('<svg', `<svg stroke="${curStyle.stroke}" fill="${curStyle.fill}"`)
                        .replace(/(currentColor)/g, curStyle.color);
                }


            } else if (isImg || isCanvas) {
                if (!isImg) {
                    const pngImage = await snapdom.toPng(dom);
                    const base64Url = pngImage.getAttribute('src');
                    obj.component[componentName].imgSrc = base64Url;
                } else {
                    const src = dom.getAttribute('src') || '';
                    const fileName = src.split('/').pop()?.split('?')[0] || '';
                    // 优先检查是否匹配 hik-product-logos 的 logo 文件名格式
                    if (/^logo_.+\.svg$/i.test(fileName)) {
                        obj.component[componentName].imgSrc =
                            `https://pixso.hikvision.com.cn/hik-plugin/ai-builder-web/public/webresources/hik-product-logos/${fileName}`;
                    } else {
                        const localImageBase64 = await imageToBase64(src);
                        if (localImageBase64) {
                            obj.component[componentName].imgSrc = localImageBase64//dom.getAttribute('src');
                        }
                    }
                }

            } else if (isIcon) {

                obj.width = Number(beforeStyle.fontSize.replace('px', '')) - 8;
                obj.height = obj.width;
                obj.x = obj.x + (width - obj.width) / 2 - 4
                obj.y = obj.y + (height - obj.height) / 2 - 4
                let content = beforeStyle?.content?.trim() || afterStyle?.content?.trim();
                if (content) {

                    content = content.replace(/\"/g, '').replace(/\//, '');
                    let hexStr = "";
                    for (let i = 0; i < content.length; i++) {
                        hexStr += content.charCodeAt(i).toString(16)//.padStart(2, "0");
                    }
                    iconfonts.push(hexStr)
                    obj.unicode = hexStr;
                    obj.className = dom.className;
                    styles.color = curStyle.color;
                    styles.color = token?.['color:' + styles.color] || styles.color;
                }
            }
            else if (isText) {

                if (curStyle.textShadow !== 'none') {
                    styles.textShadow = curStyle.textShadow;
                }
                styles.display = curStyle.display;
                styles.color = dom.tagName === 'text' && curStyle.fill ? curStyle.fill : curStyle.color;
                styles.color = token?.['color:' + styles.color] || styles.color;
                styles.wrap = curStyle.textWrapMode === 'wrap';
                if (curStyle.display.indexOf('flex') > -1 || curStyle.display.indexOf('grid') > -1) {
                    //console.log('我是图标？',dom.innerHTML,curStyle.justifyContent,curStyle.justifyItems);
                    styles.distribution = curStyle.justifyContent
                        .replace('normal', 'start')
                        .replace('flex-', '')
                        .replace('-around', 'Around')
                        .replace(-'between', 'Between')
                    styles.alignment = curStyle.alignItems
                        .replace('normal', 'start')
                        .replace('flex-', '')
                        .replace('-around', 'Around')
                        .replace('-between', 'Between');
                    if (curStyle.justifyContent === 'normal' && curStyle.justifyItems !== 'normal') {
                        styles.distribution = curStyle.justifyItems
                            .replace('normal', 'start')
                            .replace('flex-', '')
                            .replace('-around', 'Around')
                            .replace(-'between', 'Between')
                    }
                } else {
                    styles.distribution = curStyle.textAlign.replace('left', 'start').replace('right', 'end')
                    let needCenter = [
                        'BUTTON', 'INPUT', 'SELECT',
                        'STRONG', 'SPAN', 'A', 'LABEL',
                        'H1', 'H2', 'H3', 'H4', 'H5', 'H6'];
                    if (needCenter.includes(dom.tagName) || curStyle.verticalAlign === 'middle') {
                        styles.alignment = 'center';
                    }
                    //styles.textAlign = curStyle.textAlign.replace('start', 'left').replace('end', 'right');
                    // styles.verticalAlign = 'center';
                }
                if (curStyle.letterSpacing.indexOf('px') > -1) {
                    styles.letterSpacing = Number(curStyle.letterSpacing.replace('px', ''));
                }
                if (curStyle.fontFamily) {
                    styles.fontFamily = curStyle.fontFamily.split(',')[0].replace(/['"]/g, '');
                }
                let fontWeight = Number(curStyle.fontWeight);
                styles.fontWeight = !isNaN(fontWeight)
                    ? (fontWeight >= 700 ? 'bold' : (fontWeight >= 600 ? 'bolder' : 'normal'))
                    : curStyle.fontWeight;
                styles.fontSize = Math.round(Number(curStyle.fontSize.replace('px', '')));
                styles.fontSize = token?.['font:' + styles.fontSize] || token?.['font:' + styles.fontSize + "px"] || styles.fontSize;
                styles.lineHeight = Math.round(Number(curStyle.lineHeight.replace('px', '')));
                if (dom.tagName === 'INPUT' || dom.tagName === 'TEXTAREA' || dom.tagName === 'SELECT') {
                    let value = dom.value;
                    let text = dom.getAttribute('placeholder');
                    let type = dom.getAttribute('type');
                    if (!text) {
                        if (type === 'date') {
                            text = '-/-/-'
                        } else if (type === 'time') {
                            text = '--:--'
                        }
                    }
                    if (!value && text) {
                        let phstyle = window.getComputedStyle(dom, '::placeholder');
                        styles.color = phstyle.color;
                        styles.color = token?.['color:' + styles.color] || styles.color;
                        let fontWeight = Number(phstyle.fontWeight);
                        styles.fontWeight = !isNaN(fontWeight)
                            ? (fontWeight >= 700 ? 'bold' : (fontWeight >= 600 ? 'bolder' : 'normal'))
                            : phstyle.fontWeight;
                        styles.fontSize = Number(phstyle.fontSize.replace('px', ''));
                        styles.fontSize = token?.['font:' + styles.fontSize] || token?.['font:' + styles.fontSize + 'px'] || styles.fontSize;
                    }
                    // let placeholder = dom.querySelector('::placeholder');
                    // if (placeholder) {

                    //     let phstyle = window.getComputedStyle(placeholder);
                    //     console.log('我是placeholder', placeholder, phstyle)
                    //     obj.component[componentName].color = phstyle.color;
                    //     styles.verticalAlign = 'center';
                    //     styles.textAlign = phstyle.textAlign.replace('start', 'left').replace('end', 'right');
                    //     let fontWeight = Number(phstyle.fontWeight);
                    //     styles.fontWeight = !isNaN(fontWeight)
                    //         ? (fontWeight >= 700 ? 'bold' : (fontWeight >= 600 ? 'bolder' : 'normal'))
                    //         : phstyle.fontWeight;
                    //     styles.fontSize = Number(phstyle.fontSize.replace('px', ''));
                    // }
                    obj.component[componentName].text = value || text || '';
                    styles.distribution = 'start'
                } else {
                    obj.component[componentName].text = dom.innerText || dom.innerHTML;
                }
                // 递归处理子节点
            } else if (dom.children?.length) {
                obj.component[componentName].children = {
                    explicitList: []
                }

                // 将纯文本子节点包裹为 span，保留文本样式
                !isText && dom.childNodes.forEach(child => {
                    if (child.nodeType === 3 && child.textContent.trim()) {
                        let textAlign = curStyle.textAlign;
                        let lineHeight = curStyle.lineHeight;
                        let color = curStyle.color;
                        let fontSize = curStyle.fontSize
                        let fontWeight = curStyle.fontWeight;
                        let textShadow = curStyle.textShadow;
                        let hasTextBg = curStyle.backgroundImage !== 'none' && curStyle.backgroundClip === 'text';
                        const template = document.createElement('template');
                        if (hasTextBg) {
                            delete styles.backgroundImage
                        }
                        template.innerHTML = `<span 
                              style="display:inline-block;
                              text-shadow:${textShadow};
                              vertical-align:text-top;
                              ${hasTextBg ? `background-image: ${curStyle.backgroundImage}; background-clip: text; -webkit-background-clip: text;` : ''}
                              text-align:${textAlign};
                              line-height:${lineHeight};
                              color:${color};
                              font-size:${fontSize};
                              font-weight:${fontWeight}">${child.textContent}</span>`;
                        dom.replaceChild(template.content.firstChild, child);
                    }

                })

                let children = [...dom.children];

                children = children.filter(getIsCanRenderNode);
                if (curStyle.display.indexOf('flex') < 0) {
                    children = children.sort?.((a, b) => {
                        let as = window.getComputedStyle(a);
                        let bs = window.getComputedStyle(b);
                        let aindex = children.indexOf(a);
                        let bindex = children.indexOf(b);
                        let zIndex1 = as.zIndex === 'auto' ? 0 : Number(as.zIndex)
                        let zIndex2 = bs.zIndex === 'auto' ? 0 : Number(bs.zIndex)
                        return zIndex1 - zIndex2;
                    })
                }
                children.forEach(child => {
                    let id = child.tagName.toLowerCase() + '#html2dsl#' + (Math.random() + '').replace('.', '')
                    obj.component[componentName].children.explicitList.push(id);
                    //promiseList.push(getComponentJson(child, id));
                    childrenPromiseList.push(getComponentJson(child, id, styles));
                })
            } else {

            }
            if (childrenPromiseList.length) {
                Promise.all(childrenPromiseList).then(rs => {
                    resolve({ obj });
                })
            } else {
                resolve({ obj });
            }
        });
    }
    promiseList.push(getComponentJson(body, root));

    /**
     * 等待所有组件解析完成后，处理字体图标 SVG。
     * 将 unicode 编码的图标替换为实际 SVG 内容，并校准尺寸。
     */
    return Promise.all(promiseList).then(async (rs) => {
        // console.log('我的promiseList',rs.map(rs=>rs.obj.id));
        // console.log('我的文本映射关系表', textsMap);
        // console.log('我的字体图标集合', iconfonts);
        const fontUrls = getFontUrls(documentObj, iconfonts);
        const font2svgParams = [];
        // console.log('字体文件URL:', fontUrls);
        let results = [];
        for (let i = 0; i < fontUrls.length; i++) {
            let obj = fontUrls[i];
            if (obj?.codes?.length) {
                let params = {
                    url: obj.url,
                    codes: obj.codes.map(o => `0x${o}`).join(',')
                };
                font2svgParams.push(params);    
                // let result = await font2svg(params)
                // results = results.concat(result?.data || []);
            }
        }
        // console.log('最终得到了什么', results)
        let dom;
        results?.map(r => {

            let objs = json.surfaceUpdate.components.filter(c => c.unicode === r.unicode);
            if (objs?.length && !dom) {
                dom = documentObj.createElement('div');
                dom.style.position = 'fixed';
                dom.style.left = '-9999px';
                dom.style.top = '-9999px';
                documentObj.body.appendChild(dom);
            }
            objs.map(obj => {
                let value = Object.values(obj.component)[0];
                value.unicode = r.unicode;
                value.svg = r.svg_content?.replace(/\\"/g, '"').replace('<svg', `<svg color="${value.styles.color}"`);
                const template = document.createElement('template');
                template.innerHTML = value.svg;
                dom.appendChild(template.content.firstChild);
                const { width, height } = resizeSVGToFit(dom.lastChild);
                value.svg = dom.lastChild.outerHTML;
                let scale = width / height;
                if (scale < 1) {
                    //obj.x = obj.x + (obj.width - width) / 2;
                    obj.width = Math.ceil(obj.height * scale);
                } else {
                    //obj.y = obj.y + (obj.height - height) / 2;
                    obj.height = Math.ceil(obj.width / scale);
                }
                obj.x += 4;
                obj.y += 4;

            });
        })
        return {
            textsMap, json, sizeMap,font2svgParams
        }
    });



}
/**
 * 获取元素的计算尺寸。
 * 优先从 getComputedStyle 读取，回退到样式表中查找类定义的 width/height。
 * 忽略 vh 和 % 单位，只返回固定像素值。
 */
function getElementSize(element: Element | null, documentObj: Document) {
    if (!element) {
        return { width: undefined, height: undefined };
    }

    const result = { width: undefined, height: undefined };
    const style = window.getComputedStyle(element)
    // 获取最终计算尺寸
    const computedStyle = element.style;
    const computedWidth = computedStyle.width;
    // const computedHeight = computedStyle.height;

    if (computedWidth && computedWidth !== 'auto' && computedWidth.indexOf('px') > -1) {
        const widthNumber = parseFloat(computedWidth);
        if (!isNaN(widthNumber)) result.width = widthNumber;
    }

    // if (computedHeight && computedHeight !== 'auto' && computedHeight.indexOf('px') > -1) {
    //     const heightNumber = parseFloat(computedHeight);
    //     if (!isNaN(heightNumber)) result.height = heightNumber;
    // }

    // 如果计算样式没有找到，从样式表中查找类定义的尺寸
    if (result.width === undefined
        // || result.height === undefined
    ) {
        for (let className of element.classList) {
            for (let sheet of documentObj.styleSheets) {
                try {
                    for (let rule of sheet?.cssRules) {
                        let tempclassName = className
                            .replace(/\[/g, '\\[')
                            .replace(/\]/g, '\\]')
                            .replace(/\./g, '\\.')
                        let st = rule.selectorText ? rule.selectorText + "#" : '';
                        if (st.indexOf(`.${className}#`) > -1 || st.indexOf(`.${tempclassName}#`) > -1) {
                            if (result.width === undefined) {
                                const widthValue = rule.style.getPropertyValue('width');
                                if (widthValue && widthValue !== '' && widthValue.indexOf('px') > -1) {
                                    const widthNumber = parseFloat(widthValue);
                                    if (!isNaN(widthNumber)) result.width = widthNumber;
                                }
                            }

                            // if (result.height === undefined) {
                            //     const heightValue = rule.style.getPropertyValue('height');
                            //     if (heightValue && heightValue !== '' && heightValue.indexOf('px') > -1) {
                            //         const heightNumber = parseFloat(heightValue);
                            //         if (!isNaN(heightNumber)) result.height = heightNumber;
                            //     }
                            // }

                            // 如果都找到了就提前退出
                            if (result.width !== undefined
                                // && result.height !== undefined
                            ) {
                                return result;
                            }
                        }
                    }
                } catch (e) {
                    // 忽略跨域样式表访问错误
                    console.log('错了', e);
                }
            }
        }
    }
    if (result.width === undefined) {
        result.width = parseInt(style.width)
    }
    // if(result.height===undefined){
    //     result.height = parseInt(style.height)
    // }
    return result;
}
/**
 * 从 HTML 源码中提取主题变量信息。
 * 匹配 `--theme: "xxx"` 格式的主题标记。
 */
export function extractThemeInfo(cssText: string) {
    const match = cssText.match(/(--theme):\s*"([^"]+)"/);
    return match ? { themeVar: match[1], themeValue: match[2] } : null;
};
export function setPixsoDefaultComponent(conversation_id: string | undefined, isShow: boolean, keyType: string, width: number, height: number, title: string, options: unknown) {
    conversation_id && parent.postMessage({
        pluginMessage:
        {
            type: "setPixsoDefaultComponent",
            conversation_id,
            isShow,
            keyType,
            width,
            height,
            title,
            options
        }
    }, "*");
}
/**
 * 将 HTML 内容加载到 iframe 中，解析为 DSL JSON 并回传给宿主插件。
 * 流程：创建/复用 iframe → 注入 HTML → 冻结动画 → 遍历 DOM 提取组件 → 调用 htmlToDsl → postMessage 回传。
 * 支持多子页面遍历、字体图标转换、主题提取、文本智能匹配等能力。
 */
const global_Functions = {};
const global_Callbacks = {};
const RES_PREX = "https://pixso.hikvision.com.cn/hik-plugin/ai-builder-web/public/webresources/libs/"
const resourcesPaths = {
    "h-icon.css": `${RES_PREX}/fonts/h-icon/h-icon.css`,
    "hui.css": `${RES_PREX}hui.css`,
    "hui.umd.js": `${RES_PREX}hui.umd.js`,
    "hui-svg-icon.umd.js": `${RES_PREX}hui-svg-icon.umd.js`,
    "tailwindcss@3.4.7.js": `${RES_PREX}tailwindcss@3.4.7.js`,
    "vue.min.js": `${RES_PREX}vue.min.js`,
    "vuex.min.js": `${RES_PREX}vuex.umd.js`,
}
// h-icon-xxx 的 snake_case 片段 → PascalCase 片段
const H_ICON_SEG_MAP = { f: 'Fill', sm: 'Sm' };
/**
 * 将 h-icon- 类名后的 key 转换为 icons.json 中的 id（大驼峰）。
 * 规则：按 - 或 _ 拆段，丢弃 brand 前缀，_f → Fill、_sm → Sm，
 * 其余段首字母大写后拼接（兼容下划线与横杆两种写法）。
 * 例：close_f → CloseFill，brand_qq → Qq，angle_down_sm → AngleDownSm，
 * angle-down-sm → AngleDownSm。
 * @param {string} iconKey - h-icon- 后的 key，如 "close_f" 或 "close-f"
 * @returns {string} 大驼峰图标 id，如 "CloseFill"
 */
function hIconClassToId(iconKey) {
    let parts = iconKey.split(/[-_]/);
    if (parts[0] === 'brand') parts = parts.slice(1);
    return parts.map(seg => H_ICON_SEG_MAP[seg] || (seg.charAt(0).toUpperCase() + seg.slice(1))).join('');
}

export function partialHtmlToIframeWeb(html: string, callback: ((data: unknown) => void) | undefined, width = 1920, height = 1080) {
    let conversation_id = 'c_' + Math.random();
    let iframe = document.createElement('iframe')
    iframe.id = 'ai-main-iframe-new-' + conversation_id;
    let pdom = document.getElementById('ai-main-iframe').parentElement;
    pdom.appendChild(iframe);
    iframe.setAttribute('frameborder', '0');
    iframe.style.display = 'block';
    iframe.setAttribute('src', '');
    let documentObj = iframe.contentDocument;

    documentObj.open();
    documentObj.write('');
    documentObj.close();
    let global__theme__info;
    if (html) {
        // 获取主题信息
        global__theme__info = extractThemeInfo(html);

        // console.log('global__theme__info',global__theme__info)
        // html = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gi, function (match) {
        //     // 移除单行注释
        //     match = match.replace(/\/\/[^\r\n]*(\r\n|\r|\n)/g, '\$1');
        //     // 移除多行注释
        //     match = match.replace(/\/\*[\s\S]*?\*\//g, '');
        //     return match;
        // });
        // html = html
        //     .replace(/<base[^>]*>/g, `<base href="https://pixso.hikvision.com.cn/hik-plugin/ai-builder-web/public/webresources/">`)
        // if (html.indexOf('<base href=') > -1) {
        //     html = html.replace(/(?<!\.)\/assets\//g, 'assets/');
        // }
        let resourceTags = '';
        Object.keys(resourcesPaths).forEach(key => {
            if (html.indexOf(key) > -1) {
                const url = resourcesPaths[key];
                if (key.endsWith('.css')) {
                    resourceTags += `<link rel="stylesheet" href="${url}">\n`;
                } else if (key.endsWith('.js')) {
                    resourceTags += `<script src="${url}"><\/script>\n`;
                }
            }
        });
        html = html.replace('<head>', `
        <head>
        ${resourceTags}
        <style>
        * {
                animation-duration: 0ms !important;
                animation-delay: 0ms !important;
                scrollbar-width: none !important;
                transition: none !important;
              }
              .hide-css-dom:before {
                display: none !important;
              }

              .hide-css-dom:after {
                display: none !important;
              }
        </style>
        `)
        iframe.style.width = width + 'px';
        // iframe.style.height = height + 'px';

        documentObj.open();
        documentObj.write(
            html
            //.replace(/(100vh)/g, '100%')
        );
        documentObj.close();

        function resetIframeSize() {
            let firstMaxWidth, firstMaxHeight;
            let children = [...documentObj.body.children];
            children = children.filter(getIsCanRenderNode);
            children.forEach(child => {
                if (children.length === 1) {
                    let size = getElementSize(child, documentObj);
                    let width = size?.width;
                    let height = size?.height;
                    if (width) {
                        if (!firstMaxWidth) {
                            firstMaxWidth = width;
                        } else {
                            firstMaxWidth = Math.max(width, Math.ceil(firstMaxWidth))
                        }
                    }
                    if (height) {
                        if (!firstMaxHeight) {
                            firstMaxHeight = height;
                        } else {
                            firstMaxHeight = Math.max(height, Math.ceil(firstMaxHeight))
                        }
                    }
                    // 如果有尺寸，确保尺寸能固定住
                    if (firstMaxWidth) {
                        child.style.maxWidth = 'none';
                        child.style.minWidth = 'none';
                    }
                    if (firstMaxHeight) {
                        child.style.maxHeight = 'none';
                        child.style.minHeight = 'none';
                    }
                }
                // let rect = child.getBoundingClientRect();
                // if(!firstMaxWidth){
                //     firstMaxWidth = rect.width;
                // }else{
                //   firstMaxWidth = Math.max(rect.width, Math.ceil(firstMaxWidth))
                // }
            })
            if (!firstMaxWidth) {
                firstMaxWidth = parseInt(getComputedStyle(documentObj.body).width);
            }
            let lastWidth;
            let lastHeight = Math.max(height, Math.ceil(documentObj.body.scrollHeight));
            if (lastHeight > height) {
                documentObj.body.style.overflowX = 'hidden';
                documentObj.body.style.overflow = 'visible';
            }
            // let doms = documentObj.body.querySelectorAll("*");
            // doms && [...doms].map(dom => {
            //     let curStyle = window.getComputedStyle(dom);
            //     if (lastHeight > height) {
            //         if (dom.scrollHeight > dom.clientHeight && (curStyle.overflowY === 'auto' || curStyle.overflowY === 'scroll')) {
            //             dom.style.overflowX = 'hidden';
            //             dom.style.overflowY = 'visible';
            //             dom.style.overflow = 'visible';
            //         }
            //     }
            // })

            lastWidth = firstMaxWidth || width;//Math.max(width, Math.ceil(maxWidth));
            lastHeight = firstMaxHeight || lastHeight;
            iframe.style.width = lastWidth + 'px';
            iframe.style.height = lastHeight + 'px';
            return {
                lastWidth,
                lastHeight
            }
        }
        iframe.contentWindow.onload = () => {
            // 预缓存字体，冻结所有动画与过渡效果
            preCache(documentObj, { embedFonts: true });
            setTimeout(async () => {
                try {
                    // 遍历所有 DOM，收集 SVG 图标并计算最大宽高
                    let doms = documentObj.body.querySelectorAll("*");
                    documentObj.body.scrollTop = 0;
                    documentObj.body.style.padding = "0";
                    //let svgIcons = new Set();
                    let fontIcons = new Set();
                    doms && [...doms].map(dom => {
                        // if (curStyle.position === 'fixed') {
                        //     dom.style.width = Math.ceil(rect.width) + 'px';
                        //     dom.style.height = Math.ceil(rect.height) + 'px';
                        //     dom.style.position = 'relative';
                        //     console.log('我是fixed定位的元素', dom)
                        // }
                        // if (dom.tagName === "IMG") {
                        //     const imgSrc = dom.src || '';
                        //     const suffixesToRemove = ['-line', '-面性']; // 可配置的要剔除的后缀列表
                        //     if (imgSrc && imgSrc.toLowerCase().endsWith('.svg')) {
                        //         try {
                        //             let fileName = imgSrc.split('/').pop().split('?')[0].replace(/\s/g, '');
                        //             fileName = window.decodeURI(fileName);
                        //             fileName = fileName.replace(/\.svg$/i, '').replace(/\.SVG$/i, '');
                        //             // 动态构建正则表达式剔除所有指定后缀
                        //             const suffixRegex = new RegExp(`(${suffixesToRemove.join('|')})$`, 'i');
                        //             fileName = fileName.replace(suffixRegex, '').replace(/\s+/g, "").replace(/🧬/g, "")
                        //             svgIcons.add(fileName);
                        //             dom.setAttribute('hiktempsvgname', fileName);
                        //             return fileName;
                        //         } catch (error) {
                        //             console.error('提取图片名称失败:', error);
                        //         }
                        //     }
                        // }
                        if (dom.tagName === "I" && dom.className.indexOf('h-icon-') > -1) {
                            const match = dom.className.match(/h-icon-([^\s]+)/);
                            if (match) {
                                //const iconName = match[1].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()).replace(/^[a-z]/, letter => letter.toUpperCase());
                                // iconName 即为大驼峰命名后的图标名，例如：ArrowDown, UserInfo
                                const iconName = hIconClassToId(match[1]);
                                // iconName 即为大驼峰命名后的图标名，例如：ArrowDown, CloseFill    
                                fontIcons.add(iconName);
                                dom.setAttribute('hiktempiconname', iconName);
                                dom.setAttribute('component-key', iconName);
                            }
                        }
                    })

                    let { lastWidth, lastHeight } = resetIframeSize();

                    // lastWidth = firstMaxWidth || width;//Math.max(width, Math.ceil(maxWidth));
                    // lastHeight = firstMaxHeight || lastHeight;
                    // iframe.style.width = lastWidth + 'px';
                    // iframe.style.height = lastHeight + 'px';
                    // lastWidth = lastWidth % 2 !== 0 ? lastWidth + 1 : lastWidth;
                    // lastHeight = lastHeight % 2 !== 0 ? lastHeight + 1 : lastHeight;
                    //setTimeout(() => {
                    let result = {};//await getDSLComponents({ xpath: true });
                    // console.log('我的带xpath result', result);
                    // 递归提取文本内容
                    const getTexts = (dom) => {
                        const parts = [];
                        const walk = (node) => {
                            if (!node) return;
                            const tag = node.tagName;
                            const style = window.getComputedStyle(node);
                            if (style.display === 'none' || style.visibility === 'hidden') {
                                return;
                            }
                            if (tag === 'SVG'
                                || tag === 'CANVAS'
                                || tag === 'IMG'
                                || tag === 'VIDEO'
                                || tag === 'AUDIO'
                                || tag === 'IFRAME'
                                || tag === 'OBJECT'
                                || tag === 'EMBED'
                                || tag === 'APPLET'
                                || tag === 'AREA'
                            ) {
                                return;
                            }
                            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
                                if (tag === 'INPUT'
                                    && node.getAttribute('type') !== 'hidden'
                                    && node.getAttribute('type') !== 'checkbox'
                                    && node.getAttribute('type') !== 'radio' && node.value) {
                                    parts.push(node.value);
                                    return;
                                }
                                const ph = node.getAttribute('placeholder');
                                if (ph != null && String(ph).trim() !== '') {
                                    parts.push(String(ph));
                                }
                                return;
                            }
                            if (!node.children?.length) {
                                let text = node.innerText?.trim();
                                text && parts.push(text);
                                return;
                            }

                            [...node.children].forEach(walk);
                        };
                        walk(dom);
                        return parts.join(',');
                    };
                    // 将 DSL 组件结果中的 component-key 和文本信息注入到 DOM 元素
                    result?.data?.map(obj => {
                        let { xpath } = obj;
                        let doms = documentObj.querySelectorAll(xpath);
                        doms && [...doms].map(dom => {
                            if (!dom.getAttribute('component-key')) {
                                let texts = getTexts(dom);
                                dom.setAttribute('component-key', obj.key);
                                dom.setAttribute('component-texts', texts);
                            }
                        })
                    })
                    // 获取 DSL 图标数据，并将 component-key 注入到对应的 img 元素

                    // let imgDoms = documentObj.body.querySelectorAll('img[hiktempsvgname]');
                    // if (imgDoms?.length) {
                    //     let svgResult = await getDSLIcons({ icons: [...svgIcons] });
                    //     [...imgDoms].map(img => {
                    //         let svgName = img.getAttribute('hiktempsvgname');
                    //         let svgObj = svgResult.find?.(s => s.name === svgName);
                    //         if (svgObj?.key) {
                    //             img.setAttribute('component-key', svgObj.key);
                    //         }
                    //     })
                    // }
                    // let iconDoms = documentObj.body.querySelectorAll('i[hiktempiconname]');
                    // if (iconDoms?.length) {
                    //     let aliasnames = [...fontIcons];
                    //     //let iconResult = await getDSLIcons({ aliasnames: [...fontIcons] });
                    //     [...iconDoms].map(icon => {
                    //         let iconName = icon.getAttribute('hiktempiconname');
                    //         let iconObj = aliasnames.find?.(s => s?.toLowerCase?.() === iconName.toLowerCase());
                    //         if (iconObj?.key) {
                    //             icon.setAttribute('component-key', iconObj.key);
                    //         }
                    //         // let iconName = icon.getAttribute('hiktempiconname');
                    //         // let iconObj = iconResult.find?.(s => s.aliasname?.toLowerCase?.() === iconName.toLowerCase());
                    //         // if (iconObj?.key) {
                    //         //     icon.setAttribute('component-key', iconObj.key);
                    //         // }
                    //     })
                    // }

                    let htmlKey = '';
                    // setTimeout(async () => {
                    // 核心转换函数：提取主题 → 调用 htmlToDsl → 文本智能匹配 → 回传 DSL JSON
                    const doneHtmlToDsl = async (isMuli, subPageName = '') => {
                        documentObj.head.setAttribute('subpagename', subPageName)
                        if (subPageName) {
                            let size = resetIframeSize();
                            lastWidth = size.lastWidth;
                            lastHeight = size.lastHeight;
                        }
                        if (!global__theme__info) {
                            const themeDom = documentObj.querySelector('meta[name="theme"]');
                            if (themeDom?.getAttribute('content')) {
                                global__theme__info = {
                                    themeValue: themeDom.getAttribute('content')
                                }
                            }
                        }
                        let newId = conversation_id + Math.random();
                        let theme = global__theme__info?.themeValue;
                        let icons = [...fontIcons];
                        let { textsMap, json, sizeMap,font2svgParams } = await htmlToDsl(documentObj, lastWidth, lastHeight, theme)
                        iframe?.remove();
                        callback?.({ type: "dslToPixso", icons,textsMap, json, sizeMap, font2svgParams,theme, id: newId, width: lastWidth, height: lastHeight })
                    }
                    /*
                    HTML侧需暴露 subPages 和 jumpSubPage 以支持多页面导出：
                    
                    1. subPages：HTML/JS 侧在 window 上挂载的子页面列表，格式如下：
                       window.subPages = [
                         { name: 'home' },
                         { name: 'profile'},
                         { name: 'settings' },
                       ];
                       每个元素包含 name（页面唯一标识）和 index（页面顺序）。
                    
                    2. jumpSubPage：HTML/JS 侧在 window 上挂载的跳转回调，接收一个 subPage 对象：
                       window.jumpSubPage = function(subPage) {
                         // 根据 subPage 切换到对应页面，例如：
                         document.querySelectorAll('.page').forEach(el => el.style.display = 'none');
                         document.getElementById(subPage.name).style.display = 'block';
                       };
                    
                    */
                    if (iframe.contentWindow?.subPages?.length) {
                        htmlKey = 'g_' + Math.random()
                        const pageSet = new Set();
                        let count = 0;
                        for (let i = 0; i < iframe.contentWindow.subPages.length; i++) {
                            let subPage = iframe.contentWindow.subPages[i];
                            if (!pageSet.has(subPage.name)) {
                                pageSet.add(subPage.name);
                                iframe.contentWindow.jumpSubPage?.(subPage);
                                await doneHtmlToDsl(true, subPage.name);
                            }
                        }
                        iframe?.remove();
                    } else {
                        await doneHtmlToDsl();
                    }
                } catch (e) {
                   iframe?.remove();
                }
            })
        };
    }
}