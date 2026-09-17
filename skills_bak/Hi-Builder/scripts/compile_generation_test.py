#!/usr/bin/env python3
"""兼容旧测试入口；正式实现位于 compile_pattern_page。"""

from compile_pattern_page import (
    PatternPageError as GenerationTestError,
    compile_pattern_page as compile_test,
    main,
)


if __name__ == "__main__":
    raise SystemExit(main())
