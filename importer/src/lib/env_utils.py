from dotenv import load_dotenv
from pathlib import Path
from typing import List


def load_env_files(env_base: Path, env_files: List, optional: bool=False):
    print(f'Loading{" optional " if optional else " "}environment variables from *.env files')
    for env_file in env_files:
        dotenv_path = Path(env_base) / env_file
        if optional is False:
            assert dotenv_path.exists(), \
                f'\tCannot find "{env_file}" in path "{dotenv_path.parent}" (Please add or create from template)'
        print(f'\tLoading environemnt variables from "{env_file}"')
        load_dotenv(dotenv_path, override=True)