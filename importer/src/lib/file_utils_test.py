import pytest

from lib import file_utils
from lib.test_utils import TestConstants
from importer.tests.test_config import TestConfig as cfg


def test_basic_file_functions():

    sub_path =  cfg.TEMP_DIR / 'a sub'
    test_path =  sub_path / 'directory' / 'nested' / 'filename .txt'
    sub_path2 = cfg.TEMP_DIR / 'a sub2'

    sub_path2.mkdir(parents=True, exist_ok=True)
    sub_path.mkdir(parents=True, exist_ok=True)

    # make sure prefix check works, this is used to not delete C:\ or d:\ by accident
    with pytest.raises(Exception):
        file_utils.remove_dir(sub_path, sub_path2)

    file_utils.remove_dir( sub_path, sub_path)

    # fails
    with pytest.raises(FileNotFoundError):
        with open(test_path, 'w') as test_f:
            test_f.write("hey \n")

    file_utils.mkdir_p(test_path.parent)

    with open(test_path, 'w') as test_f:
        test_f.write("hey \n")

        # These don't throw on linux...
        #with pytest.raises(Exception):
        #    file_utils.remove_dir(test_path.parent.parent.parent, cfg.TEMP_DIR / 'a sub')

        #with pytest.raises(Exception):
        #    file_utils.remove_file(test_path)

    file_utils.remove_file(test_path)
    file_utils.remove_dir(test_path.parent.parent.parent, cfg.TEMP_DIR / 'a sub')