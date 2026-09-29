import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = ROOT / ".github" / "workflows" / "release.yml"


class ReleaseWorkflowTests(unittest.TestCase):
    def test_release_workflow_contract(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn('tags: ["v*.*.*"]', workflow)
        self.assertIn("workflow_dispatch:", workflow)
        self.assertIn("contents: write", workflow)
        self.assertIn("verify_release_tag.py", workflow)
        self.assertIn("package_cli.py", workflow)
        self.assertIn("npx electron-builder", workflow)
        self.assertIn("actions/upload-artifact@v4", workflow)
        self.assertIn("SHA256SUMS.txt", workflow)
        self.assertIn("gh release create", workflow)
        for label in (
            "windows-latest",
            "windows-11-arm",
            "macos-15-intel",
            "macos-latest",
            "ubuntu-24.04",
            "ubuntu-24.04-arm",
        ):
            self.assertIn(label, workflow)
        self.assertNotIn("strip-data", workflow)

    def test_tag_validator_accepts_matching_tag_and_rejects_mismatch(self):
        script = ROOT / ".github" / "scripts" / "verify_release_tag.py"
        matching = subprocess.run(
            [sys.executable, str(script), "--tag", "v0.4.0"],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        mismatch = subprocess.run(
            [sys.executable, str(script), "--tag", "v0.3.9"],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        self.assertEqual(matching.returncode, 0, matching.stdout + matching.stderr)
        self.assertNotEqual(mismatch.returncode, 0)

    def test_cli_packager_uses_platform_and_architecture_in_artifact_name(self):
        script = ROOT / ".github" / "scripts" / "package_cli.py"
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "stripdl"
            source.write_bytes(b"standalone cli")
            output = Path(directory) / "out"
            result = subprocess.run(
                [
                    sys.executable,
                    str(script),
                    "--version",
                    "0.4.0",
                    "--platform",
                    "linux",
                    "--arch",
                    "arm64",
                    "--source",
                    str(source),
                    "--output",
                    str(output),
                ],
                cwd=ROOT,
                capture_output=True,
                text=True,
                env={**os.environ, "PYTHONUTF8": "1"},
            )
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertTrue((output / "stripdl-0.4.0-linux-arm64.tar.gz").is_file())


if __name__ == "__main__":
    unittest.main()
