import subprocess
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = ROOT / ".github" / "workflows" / "ci.yml"


class CIWorkflowTests(unittest.TestCase):
    def test_ci_workflow_contract(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        for event in ("push:", "pull_request:", "workflow_dispatch:"):
            self.assertIn(event, workflow)
        self.assertIn("contents: read", workflow)
        self.assertNotIn("contents: write", workflow)
        for command in (
            "python -m unittest discover",
            "npm test",
            "npm run build",
            "python scripts/generate_release_assets.py",
            "python scripts/verify_release_assets.py",
            "python build_cli.py",
        ):
            self.assertIn(command, workflow)
        self.assertNotRegex(workflow, r"(?i)(download_dir|downloadDir|strip-data)")

    def test_ci_workflow_verifier_accepts_workflow(self):
        result = subprocess.run(
            [sys.executable, str(ROOT / ".github" / "scripts" / "verify_workflow_config.py")],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
