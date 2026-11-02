#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""用户体验部静态成员归属表（2026-11-02，来自 AI 应用效能看板）。

仅为已确认的成员覆盖身份文件中的小组，不调用组织架构接口。
看板成员姓名的首字重复已去除；英文 OA 账号按原样保留。
未列入的成员继续使用原 identity.json / 机器兜底分组，避免中断原采集。
"""

GROUP_MEMBERS = {
    "云产品设计组": (
        "周菁16",
        "范秋华",
        "胡金成",
        "胡泽铭",
        "任嘉轩",
    ),
    "EBG软件产品设计组": (
        "应源山",
        "盛童安",
        "袁旭虹",
        "韦雅倩",
        "白楠",
        "李青云9",
        "谢孙",
        "沈立9",
        "郭雯雯7",
        "刘堂青",
        "李海涛11",
        "王楠16",
        "曹时达",
        "潘炜10",
        "曹诗淼",
        "赵露唏",
        "苗任越",
        "周逸阳6",
        "张之杰11",
        "任家沛",
        "陈俊5",
        "llilei84",
        "付钊",
        "刘玲18",
        "陈昱骏",
    ),
    "PBG软件产品设计组": (
        "韩酒坡",
        "郑伟俊7",
        "王景慧5",
        "司传文",
        "武养宁",
        "尹政6",
        "赫英昕5",
        "曾芬",
        "岑玉威",
        "王瑞华",
        "张利艳6",
        "张保琴",
        "胡伊丽",
    ),
    "通用软件产品设计组": (
        "双紫钰",
        "许苗苗6",
        "瞿敏8",
        "钱琰彬",
        "马成海5",
        "王成47",
        "卢倩",
        "蔡阮枫",
        "叶艳旭",
    ),
    "智能设计效能组": (
        "叶波",
        "翁文秀",
        "黄振华",
        "刘璐22",
        "王青宇7",
    ),
    "基础平台设计组": (
        "张佳雯5",
        "石敬超",
        "夏哲怡5",
        "张亚婷5",
        "施立强",
        "崔嘉育",
        "潘虹帆",
        "陈美帆",
        "钱然",
    ),
}

MEMBER_TO_GROUP = {
    member: group
    for group, members in GROUP_MEMBERS.items()
    for member in members
}


def lookup_group(user):
    """根据固定名单获取小组；返回 None 表示未在名单中。"""
    if not isinstance(user, str):
        return None
    username = user.strip()
    if not username:
        return None
    group = MEMBER_TO_GROUP.get(username)
    if group:
        return group
    # 英文 OA 账号不分大小写；中文姓名只尝试兼容看板首字重复的别名。
    group = MEMBER_TO_GROUP.get(username.lower())
    if group:
        return group
    if len(username) >= 3 and "\u3400" <= username[0] <= "\u9fff" and username[0] == username[1]:
        return MEMBER_TO_GROUP.get(username[1:])
    return None
