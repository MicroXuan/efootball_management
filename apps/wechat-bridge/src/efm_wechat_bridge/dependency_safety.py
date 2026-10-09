from __future__ import annotations

import contextlib
import io
import logging
from collections.abc import Callable
from typing import TypeVar

T = TypeVar("T")


def initialize_wechat_dependency(factory: Callable[[], T]) -> T:
    """Initialize the pinned dependency without allowing its diagnostics to escape."""
    sink = io.StringIO()
    with contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
        instance = factory()
    silence_wechat_logging()
    return instance


def silence_wechat_logging() -> None:
    try:
        from wechatauto.logger import wxlog  # type: ignore[import-not-found]
        from wechatauto.param import WxParam  # type: ignore[import-not-found]
    except (ImportError, OSError):
        return
    WxParam.ENABLE_FILE_LOGGER = False
    root = logging.getLogger()
    for handler in (getattr(wxlog, "console_handler", None), getattr(wxlog, "file_handler", None)):
        if handler is not None:
            root.removeHandler(handler)
            try:
                handler.close()
            except Exception:
                pass
    logger = getattr(wxlog, "logger", logging.getLogger("wechatauto"))
    logger.handlers.clear()
    logger.addHandler(logging.NullHandler())
    logger.propagate = False
