import { Button } from '@open-design/components';
import { Icon } from './Icon';
import styles from './SkillUploadSummary.module.css';

type UploadSummarySource =
  | { kind: 'folder'; files: { file: File }[]; folderName?: string }
  | { kind: 'files'; files: { file: File }[] }
  | { kind: 'zip' | 'file'; file: File };

interface Props {
  source: UploadSummarySource;
  locale: string;
  disabled: boolean;
  onRemove: () => void;
}

export function SkillUploadSummary({ source, locale, disabled, onRemove }: Props) {
  const summary = uploadSummary(source, locale);
  const removeLabel = locale.startsWith('zh') ? '删除已导入 Skill' : 'Remove imported Skill';
  return (
    <div className={styles.selectedSource} role="group" aria-label={locale.startsWith('zh') ? '已选择的 Skill' : 'Selected Skill'}>
      <Icon name={source.kind === 'folder' ? 'folder' : 'file'} size={22} aria-hidden />
      <div className={styles.sourceInfo}>
        <strong className={styles.sourceName} title={summary.name}>{summary.name}</strong>
        <span className={styles.sourceDetail}>{summary.detail}</span>
      </div>
      <Button variant="ghost" size="icon" disabled={disabled} aria-label={removeLabel} title={removeLabel} onClick={onRemove}>
        <Icon name="trash" size={16} aria-hidden />
      </Button>
    </div>
  );
}

function uploadSummary(source: UploadSummarySource, locale: string): { name: string; detail: string } {
  const bytes = 'files' in source
    ? source.files.reduce((total, entry) => total + entry.file.size, 0) : source.file.size;
  const size = bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if ('files' in source) {
    return {
      name: (source.kind === 'folder' ? source.folderName : undefined) || source.files[0]?.file.name || (locale.startsWith('zh') ? 'Skill 文件夹' : 'Skill folder'),
      detail: `${source.kind === 'files' && source.files.length === 1
        ? (locale.startsWith('zh') ? 'Markdown 文件' : 'Markdown file')
        : locale.startsWith('zh') ? `${source.files.length} 个文件` : `${source.files.length} files`} · ${size}`,
    };
  }
  return { name: source.file.name, detail: `${source.kind === 'zip'
    ? (locale.startsWith('zh') ? 'ZIP 压缩包' : 'ZIP archive')
    : (locale.startsWith('zh') ? 'Markdown 文件' : 'Markdown file')} · ${size}` };
}
