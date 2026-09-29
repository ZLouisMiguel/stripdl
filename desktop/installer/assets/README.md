# Strip release assets

These files are generated from `assets/strip-logo.png` by:

```text
python scripts/generate_release_assets.py
```

The generated files are consumed by `electron-builder` for the application icon, installer surfaces, DMG layout, and Linux desktop integration. Run the verifier before packaging:

```text
python scripts/verify_release_assets.py
```
