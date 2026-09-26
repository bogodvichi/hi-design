#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
parse.py —— 安装期辅助工具（纯 Python 标准库，替代 jq）。

用法：
  python3 parse.py getkey <file> <key>
  python3 parse.py writeid <out> <user> <group> <machine>
  python3 parse.py glen <groups.json>
  python3 parse.py gitem <groups.json> <i>

所有异常都吞掉，输出空，绝不报错退出。
"""
import json
import sys


def cmd_getkey(path, key):
    try:
        with open(path, "r", encoding="utf-8-sig") as f:
            d = json.load(f)
        v = d.get(key, "")
        sys.stdout.write(v if isinstance(v, str) else json.dumps(v, ensure_ascii=False))
    except Exception:
        sys.stdout.write("")


def cmd_writeid(out, user, group, machine):
    try:
        with open(out, "w", encoding="utf-8") as f:
            json.dump({"user": user, "group": group, "machine": machine}, f, ensure_ascii=False)
        sys.stdout.write("OK")
    except Exception:
        sys.stdout.write("ERR")


def cmd_glen(path):
    try:
        with open(path, "r", encoding="utf-8-sig") as f:
            print(len(json.load(f)))
    except Exception:
        print(0)


def cmd_gitem(path, i):
    try:
        with open(path, "r", encoding="utf-8-sig") as f:
            sys.stdout.write(str(json.load(f)[int(i)]))
    except Exception:
        sys.stdout.write("")


def main():
    if len(sys.argv) < 2:
        return
    c = sys.argv[1]
    try:
        if c == "getkey":
            cmd_getkey(sys.argv[2], sys.argv[3])
        elif c == "writeid":
            cmd_writeid(sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5])
        elif c == "glen":
            cmd_glen(sys.argv[2])
        elif c == "gitem":
            cmd_gitem(sys.argv[2], sys.argv[3])
    except Exception:
        pass


if __name__ == "__main__":
    main()
