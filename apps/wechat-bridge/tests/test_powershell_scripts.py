from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest


SCRIPTS = Path(__file__).parents[1] / "scripts"
SCRIPT_NAMES = ("install.ps1", "run.ps1", "register-task.ps1", "unregister-task.ps1")


def test_deployment_script_set_is_complete_and_contains_no_literal_credentials() -> None:
    for name in SCRIPT_NAMES:
        script = SCRIPTS / name
        assert script.is_file(), f"missing {name}"
        content = script.read_text(encoding="utf-8")
        assert "EFM_WECHAT_BRIDGE_TOKEN=" not in content
        assert "00000000-0000-4000-8000-000000000000" not in content


@pytest.mark.skipif(shutil.which("pwsh") is None, reason="PowerShell AST validation runs on Windows/pwsh hosts")
def test_powershell_scripts_parse_without_errors() -> None:
    pwsh = shutil.which("pwsh")
    assert pwsh is not None
    for name in SCRIPT_NAMES:
        completed = subprocess.run(
            [
                pwsh,
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "$e=$null;$t=$null;[System.Management.Automation.Language.Parser]::ParseFile($args[0],[ref]$t,[ref]$e)>$null;if($e.Count){$e|% Message;exit 1}",
                str(SCRIPTS / name),
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        assert completed.returncode == 0, completed.stdout + completed.stderr


@pytest.mark.skipif(shutil.which("pwsh") is None, reason="PowerShell behavior validation runs on Windows/pwsh hosts")
def test_install_validation_fails_without_required_token() -> None:
    pwsh = shutil.which("pwsh")
    assert pwsh is not None
    completed = subprocess.run(
        [pwsh, "-NoProfile", "-NonInteractive", "-File", str(SCRIPTS / "install.ps1"), "-ValidateOnly"],
        capture_output=True,
        text=True,
        env={"PATH": str(Path(pwsh).parent)},
        check=False,
    )
    assert completed.returncode != 0

