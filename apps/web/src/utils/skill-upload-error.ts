import { SKILL_UPLOAD_MAX_MB } from '@open-design/contracts';

/** Shared upload feedback for Community, Personal and Team Skill dialogs. */
export function skillUploadErrorMessage(error: unknown, locale: string): string | null {
  const detail = error && typeof error === 'object' ? error as { code?: string; status?: number; message?: string } : {};
  const text = (error instanceof Error ? error.message : detail.message ?? String(error ?? '')).trim();
  const lower = `${detail.code ?? ''} ${text}`.toLowerCase();
  const localize = (zh: string, en: string) => locale.startsWith('zh') ? zh : en;
  if (/skill_upload_too_large|payload_too_large|skill upload exceeds \d+ mb/.test(lower)) {
    return localize(`文件太大（超过${SKILL_UPLOAD_MAX_MB}MB）`, `File too large (over ${SKILL_UPLOAD_MAX_MB} MB).`);
  }
  if (/skill_md_not_found|skill\.md not found|no files uploaded|no files provided/.test(lower)) {
    return localize('未找到skill.md文件', 'SKILL.md was not found.');
  }
  if (/multiple_skills|select either one folder/.test(lower)) {
    return localize('无法上传多个skill，请单独上传', 'Multiple Skills cannot be uploaded together. Upload each Skill separately.');
  }
  if (detail.status === 401 || /authentication_required|unauthorized|session_expired/.test(lower)) {
    return localize('登录已失效，请重新登录后上传。', 'Your session has expired. Sign in again to upload.');
  }
  if (detail.status === 403) {
    return localize('没有发布权限，请切换账号或工作空间后重试。', 'You do not have permission to publish. Check your account or workspace.');
  }
  if (/resource_name_registry_not_ready/.test(lower)) {
    return localize('发布服务尚未就绪，请联系管理员后重试。', 'The publishing service is not ready. Contact your administrator.');
  }
  if (detail.status === 503) {
    return localize('发布服务暂不可用，请稍后重试。', 'The publishing service is unavailable. Try again later.');
  }
  if (/encrypted zip/.test(lower)) {
    return localize('不支持加密的 ZIP 包，请解密后重新上传。', 'Encrypted ZIP archives are not supported. Decrypt the archive and try again.');
  }
  if (/unsupported zip compression/.test(lower)) {
    return localize('ZIP 压缩格式不支持，请重新压缩后上传。', 'This ZIP compression format is not supported. Recompress the archive and try again.');
  }
  if (/\benospc\b|no space left/.test(lower)) {
    return localize('设备空间不足，请清理磁盘后重试。', 'There is not enough disk space. Free up space and try again.');
  }
  if (/\beacces\b|\beperm\b|permission denied/.test(lower)) {
    return localize('文件读取失败，请检查访问权限后重新选择。', 'The files could not be read. Check access permissions and choose them again.');
  }
  if (/\benoent\b|no such file/.test(lower)) {
    return localize('文件读取失败，请重新选择后上传。', 'The files could not be read. Choose them again and retry the upload.');
  }

  if (/invalid zip|end-of-central-directory|zip.*read|unable to read.*zip|zip entry exceeds|unexpected end|out of bounds/.test(lower)) {
    return localize('ZIP 包无法读取，请确认文件未损坏后重新选择。', 'The ZIP archive could not be read. Check that it is not corrupted and choose it again.');
  }
  if (/unsafe file path|path escapes|absolute zip paths|invalid file name|reserved project path/.test(lower)) {
    return localize('文件路径不符合安全要求，请重新整理或打包后再试。', 'The file paths are not safe. Reorganize or repackage the files and try again.');
  }
  if (/network_error|failed to fetch|networkerror|network request failed/.test(lower)) {
    return localize('网络连接失败，请检查网络后重试。', 'Network request failed. Check your connection and try again.');
  }
  if (/skill_content_empty/.test(lower)) {
    return localize('Skill 文件内容为空，请补充内容后重新选择。', 'The Skill file is empty. Add content and choose it again.');
  }
  if (/skill_name_missing/.test(lower)) {
    return localize('Skill 文件缺少 name 字段，请补充后重新选择。', 'The Skill file is missing the name field. Add it and choose the file again.');
  }
  if (/skill_file_type_unsupported/.test(lower)) {
    return localize('单文件导入仅支持 Markdown（.md）或 ZIP 文件，请重新选择。', 'Choose a Markdown (.md) file or ZIP archive.');
  }
  if (/resource_name_conflict|platform resource with the same name/.test(lower)) {
    return localize('平台中已有相同 Skill，请重新命名。', 'A Skill with the same name already exists on the platform. Rename it.');
  }
  return null;
}
