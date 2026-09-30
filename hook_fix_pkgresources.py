# Runtime hook: Patch pkg_resources to safely handle invalid package versions
# This prevents the 'InvalidVersion: Invalid version: attrs' crash in PyInstaller bundles
import sys

try:
    from packaging.version import Version, InvalidVersion
    import pkg_resources.extern.packaging.version as _v

    original_parse = _v.Version.__init__

    def safe_init(self, version):
        try:
            original_parse(self, version)
        except InvalidVersion:
            original_parse(self, "0.0.0")

    _v.Version.__init__ = safe_init
except Exception:
    pass
