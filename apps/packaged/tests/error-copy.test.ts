import { describe, expect, it } from "vitest";
import { PackagedPathAccessError, pathAccessDialogCopy } from "../src/errors.js";

describe("startup error feedback", () => {
  const error = new PackagedPathAccessError("OD_DATA_DIR namespace mismatch /private/path");

  it("keeps paths and configuration identifiers out of the Chinese dialog", () => {
    expect(pathAccessDialogCopy(error, "zh-CN")).toEqual({
      title: "启动失败",
      message: "无法访问本地数据目录，请检查目录设置与访问权限后重新打开 HiDesign。",
    });
    expect(error.message).toContain("OD_DATA_DIR");
  });

  it("retains the existing English diagnostics", () => {
    expect(pathAccessDialogCopy(error, "en-US")).toEqual({ title: error.title, message: error.message });
  });
});
