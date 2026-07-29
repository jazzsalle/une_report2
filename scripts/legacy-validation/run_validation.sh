#!/usr/bin/env bash
set -euo pipefail
python validate_package.py
cd ../06_tests
PYTHONPATH=../05_mock_server pytest -q
