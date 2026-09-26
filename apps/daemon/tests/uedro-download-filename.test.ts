import { describe, expect, it } from 'vitest';

import { normalizeContentDisposition } from '../src/routes/hik_routes/uedro.js';

// 「稿件.xlsx」的 GBK 字节序列：B8 E5 BC FE（稿件）+ 2E 78 6C 73 78（.xlsx）。
// Node 的 HTTP 头解析器把头值按 latin1 解码，于是这串字节被错误展成 latin1
// 字符串（mojibake）—— 这就是羽点下载文件名乱码的现场。下面用它模拟上游头。
const GBK_MOJIBAKE = Buffer.from('B8E5BCFE2E786C7378', 'hex').toString('latin1');
// 「稿件」的 UTF-8 百分号编码，即 RFC 5987 filename* 段里应该出现的值。
const UTF8_PCT = '%E7%A8%BF%E4%BB%B6.xlsx';

describe('normalizeContentDisposition', () => {
  it('把 GBK 文件名经 latin1 头解析后规整回 UTF-8 RFC 5987 形式', () => {
    const raw = `attachment; filename="${GBK_MOJIBAKE}"`;
    const out = normalizeContentDisposition(raw);
    // 现代浏览器优先解析 filename*=UTF-8''…，拿到正确的中文文件名。
    expect(out).toContain(`filename*=UTF-8''${UTF8_PCT}`);
    // 同时保留 ASCII 兜底，旧客户端不会拿到空名或乱码。
    expect(out).toMatch(/filename="[^"]*\.xlsx"/);
  });

  it('上游已自带 RFC 5987 扩展时原样放行，不重复改写', () => {
    const raw = `attachment; filename*=UTF-8''${UTF8_PCT}`;
    expect(normalizeContentDisposition(raw)).toBe(raw);
  });

  it('纯 ASCII 文件名也补齐 filename* 扩展，保持双段一致性', () => {
    const out = normalizeContentDisposition('attachment; filename="report.xlsx"');
    expect(out).toContain('filename="report.xlsx"');
    expect(out).toContain(`filename*=UTF-8''report.xlsx`);
  });

  it('无 filename 段时原样透传，不凭空造一个出来', () => {
    const raw = 'attachment';
    expect(normalizeContentDisposition(raw)).toBe(raw);
  });
});
