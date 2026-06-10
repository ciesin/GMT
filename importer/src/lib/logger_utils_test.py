import logging
from importer.tests.test_config import TestConfig as cfg

from lib import logger_utils, file_utils

log = logging.getLogger(__name__)


def test_logger():
    """
    Important, make sure no tests are using the test fixture test_logging
    """

    log_dir = cfg.TEMP_DIR / 'logs'

    file_utils.remove_dir(log_dir, cfg.TEMP_DIR)

    log_path = log_dir / 'my test.log'

    summary_path = log_dir / 'summary.log'

    assert not log_path.is_file()
    assert not summary_path.is_file()

    logger_utils.init_log(
        log_name=None,
        console_level=logging.DEBUG,
        file_level=logging.DEBUG,
        log_path=log_path,
        # log_format_str="%(asctime)s %(filename)s:%(lineno)d %(levelname)s %(name)s ==> %(message)s\n"
        log_format_str="[%(message)s]\n"
    )

    log.debug("d")
    log.info("i")
    log.warning("w")
    log.error("e")

    assert log_path.is_file()
    assert summary_path.is_file()

    assert file_utils.read_file_to_string(log_path, preserve_new_lines=False) == "[d][i][w][e]"

    assert file_utils.read_file_to_string(summary_path, preserve_new_lines=False) == "[i][w][e]"


