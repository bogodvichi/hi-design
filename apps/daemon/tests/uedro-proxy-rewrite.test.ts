import { describe, expect, it } from 'vitest';

import { rewriteProxyText } from '../src/routes/hik_routes/uedro.js';

// 羽点稿件预览页经 daemon 根路径反向代理后，响应体里的绝对域名必须改写成根相对，
// 否则浏览器会绕过代理直连原站（跨源 + 无 cookie → 401）。这里覆盖几种现场形态。

describe('rewriteProxyText', () => {
  it('把 https 绝对域名改写为根相对路径', () => {
    const html = `<script src="https://uedro.hikvision.com.cn/uedro/static/main.js"></script>`;
    expect(rewriteProxyText(html, 'text/html')).toBe(
      `<script src="/uedro/static/main.js"></script>`,
    );
  });

  it('把 http 变体绝对域名也改写为根相对', () => {
    expect(rewriteProxyText('http://uedro.hikvision.com.cn/portal/front/x', 'text/html')).toBe(
      '/portal/front/x',
    );
  });

  it('把协议相对 //域名 改写为根相对', () => {
    // 原站 JS 里常见的 protocol-relative 写法：'//uedro.hikvision.com.cn/uedro/web/x'
    expect(rewriteProxyText(`fetch("//uedro.hikvision.com.cn/uedro/web/x")`, 'application/javascript'))
      .toBe(`fetch("/uedro/web/x")`);
  });

  it('剥离 HTML 内联 CSP meta，避免限制代理页脚本/连接来源', () => {
    const html = `<head><meta http-equiv="Content-Security-Policy" content="default-src 'self'"></head>`;
    const out = rewriteProxyText(html, 'text/html');
    expect(out).not.toContain('Content-Security-Policy');
    // 仅剥 CSP meta，其余 head 内容保留。
    expect(out).toContain('</head>');
  });

  it('非 HTML 文本不改写 meta（仅做域名替换）', () => {
    const js = `var base='https://uedro.hikvision.com.cn/uedro'`;
    expect(rewriteProxyText(js, 'application/javascript')).toBe(`var base='/uedro'`);
  });
});
