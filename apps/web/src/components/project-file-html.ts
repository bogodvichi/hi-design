import type { ProjectFile } from '../types';

export function isProjectHtmlFile(file: ProjectFile): boolean {
  const mime = file.mime.split(';', 1)[0]?.trim().toLowerCase();
  if (file.kind === 'html' || mime === 'text/html') return true;
  return /\.(?:html?|xhtml)$/iu.test(file.path || file.name);
}
