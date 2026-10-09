from __future__ import annotations

import logging
import sys
from types import ModuleType, SimpleNamespace

from efm_wechat_bridge.dependency_safety import silence_wechat_logging


def test_disables_dependency_file_and_console_logging(monkeypatch) -> None:
    package = ModuleType("wechatauto")
    logger_module = ModuleType("wechatauto.logger")
    param_module = ModuleType("wechatauto.param")
    logger = logging.getLogger("wechatauto-test")
    console = logging.StreamHandler()
    logging.getLogger().addHandler(console)
    wxlog = SimpleNamespace(logger=logger, console_handler=console, file_handler=None)
    params = SimpleNamespace(ENABLE_FILE_LOGGER=True)
    logger_module.wxlog = wxlog  # type: ignore[attr-defined]
    param_module.WxParam = params  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "wechatauto", package)
    monkeypatch.setitem(sys.modules, "wechatauto.logger", logger_module)
    monkeypatch.setitem(sys.modules, "wechatauto.param", param_module)

    silence_wechat_logging()

    assert params.ENABLE_FILE_LOGGER is False
    assert console not in logging.getLogger().handlers
    assert logger.propagate is False
    assert any(isinstance(handler, logging.NullHandler) for handler in logger.handlers)
