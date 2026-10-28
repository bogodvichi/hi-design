import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { expect, it } from 'vitest';

const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url));

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

it('keeps client directives before imports so Next can compile the application', () => {
  const violations: string[] = [];
  for (const path of sourceFiles(sourceRoot)) {
    const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
    let foundCode = false;
    for (const statement of source.statements) {
      if (ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression)) {
        if (statement.expression.text === 'use client' && foundCode) violations.push(relative(sourceRoot, path));
      } else foundCode = true;
    }
  }
  expect(violations).toEqual([]);
});
