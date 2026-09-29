import json
import subprocess
import sys
import unittest
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / "desktop" / "installer" / "assets"


def image_size(path: Path) -> tuple[int, int]:
    with Image.open(path) as image:
        return image.size


class ReleaseAssetTests(unittest.TestCase):
    def test_linux_icon_set_has_required_sizes(self):
        expected = (16, 24, 32, 48, 64, 128, 256, 512, 1024)
        for size in expected:
            path = ASSETS / "icons" / f"{size}x{size}.png"
            self.assertTrue(path.is_file(), path)
            self.assertEqual(image_size(path), (size, size))

    def test_windows_and_macos_icons_are_real_icon_files(self):
        ico = ASSETS / "strip.ico"
        icns = ASSETS / "strip.icns"
        self.assertEqual(ico.read_bytes()[:4], b"\x00\x00\x01\x00")
        self.assertGreater(ico.stat().st_size, 1024)
        icns_data = icns.read_bytes()
        self.assertEqual(icns_data[:4], b"icns")
        self.assertEqual(int.from_bytes(icns_data[4:8], "big"), len(icns_data))

    def test_installer_artwork_has_required_dimensions(self):
        expected = {
            "windows/sidebar.bmp": (164, 314),
            "windows/header.bmp": (150, 57),
            "windows/uninstaller-sidebar.bmp": (164, 314),
            "macos/dmg-background.png": (900, 600),
        }
        for relative, dimensions in expected.items():
            path = ASSETS / relative
            self.assertTrue(path.is_file(), path)
            self.assertEqual(image_size(path), dimensions)

    def test_package_references_only_generated_strip_assets(self):
        package = json.loads((ROOT / "desktop" / "package.json").read_text(encoding="utf-8"))
        build = package["build"]
        self.assertEqual(build["directories"]["buildResources"], "installer")
        self.assertEqual(build["win"]["icon"], "assets/strip.ico")
        self.assertEqual(build["mac"]["icon"], "assets/strip.icns")
        self.assertEqual(build["linux"]["icon"], "assets/icons")
        self.assertEqual(build["linux"]["target"], ["AppImage", "deb"])
        self.assertNotIn("renderer/public/icon", json.dumps(build))

    def test_asset_verifier_accepts_generated_set(self):
        result = subprocess.run(
            [sys.executable, str(ROOT / "scripts" / "verify_release_assets.py")],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
