export class PackagedPathAccessError extends Error {
  readonly title: string;

  constructor(message: string, options?: { cause?: unknown; title?: string }) {
    super(message, options);
    this.name = "PackagedPathAccessError";
    this.title = options?.title ?? "Hi Design cannot access its data folder";
  }
}

export function pathAccessDialogCopy(error: PackagedPathAccessError, locale: string): {
  title: string;
  message: string;
} {
  if (locale.toLowerCase().startsWith("zh")) {
    return {
      title: "启动失败",
      message: "无法访问本地数据目录，请检查目录设置与访问权限后重新打开 HiDesign。",
    };
  }
  return { title: error.title, message: error.message };
}
