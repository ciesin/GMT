# coding=utf-8
import argparse
import os
import errno
import re
import shutil
import subprocess
import zipfile
import logging 
import time
from pathlib import Path
from typing import Union

log = logging.getLogger(__name__)


def read_file_to_string(file_path, preserve_new_lines = True):
	with open(file_path, 'r') as myfile:
		data=myfile.read()

		if not preserve_new_lines :
			data = data.replace('\r', '')
			data = data.replace('\n', '')

	return data



def remove_dir(
    dir_path: Path, dir_prefix: Path, raise_exception_on_error: bool = True
) -> None:
    """
    Does a recursive delete.
    Pass a dirPrefix to enforce that the dir starts with it to make sure
    you aren't deleting C:\
    """

    # Already deleted
    if not dir_path.exists():
        return

    assert (
        dir_prefix
    ), "Must provide a dir prefix to prevent accidental deletion of folders"

    # Sanity check to make sure we are not deleting a directory not under the prefix dir
    if not str(dir_path).startswith(str(dir_prefix)):
        raise Exception(f"Directory {dir_path} does not start with {dir_prefix}")

    log.info(f"Removing directory {dir_path}")
    try:
        shutil.rmtree(dir_path, False)
    except Exception as e:
        log.error(f"Error removing {dir_path}; trying rm -rf: {e}")
        subprocess.check_output(["rm", "-rf", str(dir_path.absolute())])

    if raise_exception_on_error and dir_path.exists():
        raise Exception(f"{dir_path} still exists")


def remove_file(file_path: Union[str,Path]) -> None:
	try:
		os.remove(file_path)
	except OSError:
		pass

	if os.path.isfile(file_path):
		raise Exception("Unable to remove file: {}".format(file_path))


def mkdir_p(path: Union[str, Path], retry_count: int = 2) -> None:
    p = Path(path)
    try:
        os.makedirs(path, exist_ok=True)
    except Exception as ex:
        log.error(f"Error creating directory {path}: {ex}")
        if retry_count > 0:
            time.sleep(1)

            # run mkdir -p as well
            subprocess.check_output(["mkdir", "-p", str(p.absolute())])

            mkdir_p(path, retry_count=retry_count - 1)

def parse_path(arg: str) -> Path:
    """
    :param arg: command line argument passed by the user
    :return: parsed path
    """
    p = Path(arg)
    if not p.exists() or not p.is_file():
        raise argparse.ArgumentTypeError(f"[{arg}] is not a valid file")

    return p