import json
import shutil
from pathlib import Path

import pytest

from morningreport import manifest as mf
from morningreport import rubric as rb
from morningreport import vtt
from morningreport.roles import NameBoundary
from morningreport.store import Store

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture(scope="session")
def rubric():
    return rb.load()


@pytest.fixture
def man():
    return mf.load(FIXTURES / "manifest-clean.json")


@pytest.fixture
def boundary(man):
    return NameBoundary(man.roles)


@pytest.fixture
def load_tx():
    def _load(name):
        return vtt.parse_file(FIXTURES / name)
    return _load


@pytest.fixture
def store(tmp_path):
    return Store(root=tmp_path)
