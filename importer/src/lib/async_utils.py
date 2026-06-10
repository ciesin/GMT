import asyncio
import logging
import os
from pathlib import Path
from typing import Coroutine, Dict, List, Awaitable, Optional, TypeVar

log = logging.getLogger(__name__)


async def run_command(
    command: str,
    args: List[str],
    env_vars: Optional[Dict[str, str]] = None,
    log_stdout: bool = True,
log_command: bool = True,
    fail_on_stderr: bool = False,
        cwd: Optional[Path] = None,
) -> int:
    """
    Note this uses the shell to allow for piping etc.
    It is the caller responsibility to quote appropriately
    """
    # Create the subprocess
    if log_command:
        log.debug(f'Running command: {command} with args {" ".join(args)}')
    env = os.environ.copy()  # Start with the current environment
    if env_vars is not None:
        env.update(env_vars)  # Add or update with custom environment variables

    process = await asyncio.create_subprocess_shell(
        command + " " + " ".join(args),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=env,
        cwd=cwd,
    )

    # https://gist.github.com/gh640/50953484edfa846fda9a95374df57900
    assert isinstance(process.stdout, asyncio.StreamReader)
    assert isinstance(process.stderr, asyncio.StreamReader)

    # all_stdout = []
    # all_stderr = []

    has_stderr = False

    while True:
        if process.stdout.at_eof() and process.stderr.at_eof():
            break

        byte_limit = 10_000

        # Use read instead of readline to read all output up to now
        stdout = (await process.stdout.read(byte_limit)).decode(errors="replace")
        if stdout and log_stdout:
            log.debug(f"[stdout] {stdout}")
            # all_stdout.append(stdout)
        stderr = (await process.stderr.read(byte_limit)).decode(errors="replace")
        if stderr:
            log.debug(f"[sdterr] {stderr}")  # , file=sys.stderr)
            has_stderr = True
            # all_stderr.append(stderr)

        await asyncio.sleep(1)

    # Read stdout and stderr
    # Use communicate because wait can deadlock, see https://docs.python.org/3/library/asyncio-subprocess.html#asyncio.subprocess.Process.wait
    await process.communicate()

    assert isinstance(process.returncode, int)

    if fail_on_stderr and has_stderr:
        raise Exception("Fail on any stderr output was true and stderr had output")

    return process.returncode  # , "".join(all_stdout), "".join(all_stderr)


async def run_command_collect_stdout(
    command: str, args: List[str], env_vars: Optional[Dict[str, str]] = None
) -> str:
    # Create the subprocess
    log.info(f'Running command: {command} with args {" ".join(args)}')
    env = os.environ.copy()  # Start with the current environment
    if env_vars is not None:
        env.update(env_vars)  # Add or update with custom environment variables

    process = await asyncio.create_subprocess_shell(
        command + " " + " ".join(args),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=env,
    )

    # https://gist.github.com/gh640/50953484edfa846fda9a95374df57900
    assert isinstance(process.stdout, asyncio.StreamReader)
    assert isinstance(process.stderr, asyncio.StreamReader)

    all_stdout: List[str] = []
    all_stderr = []

    while True:
        if process.stdout.at_eof() and process.stderr.at_eof():
            break

        byte_limit = 10_000

        # Use read instead of readline to read all output up to now
        stdout = (await process.stdout.read(byte_limit)).decode()
        if stdout:
            all_stdout.append(stdout)
            log.debug(f"Stdout lines now {len(all_stdout)}")
        stderr = (await process.stderr.read(byte_limit)).decode()
        if stderr:
            log.debug(f"[sdterr] {stderr}")  # , file=sys.stderr)
            all_stderr.append(stderr)

        await asyncio.sleep(1)

    # Read stdout and stderr
    # Use communicate because wait can deadlock, see https://docs.python.org/3/library/asyncio-subprocess.html#asyncio.subprocess.Process.wait
    await process.communicate()

    assert isinstance(process.returncode, int)
    assert process.returncode == 0

    return "".join(all_stdout)


# Define a generic type variable for the return type of the coroutine
R = TypeVar("R")


# https://stackoverflow.com/questions/48483348/how-to-limit-concurrency-with-python-asyncio
async def gather_with_concurrency(n: int, *coros: Coroutine[None, None, R]) -> List[R]:
    semaphore = asyncio.Semaphore(n)

    async def sem_coro(coro: Coroutine[None, None, R]) -> R:
        async with semaphore:
            return await coro

    return await asyncio.gather(*(sem_coro(c) for c in coros))


async def as_completed_with_concurrency(n: int, *coros: Awaitable[R]) -> List[R]:
    semaphore = asyncio.Semaphore(n)

    results = []

    async def sem_coro(coro: Awaitable[R]) -> R:
        async with semaphore:
            return await coro

    for finished_task in asyncio.as_completed([sem_coro(c) for c in coros]):
        early_result = await finished_task
        results.append(early_result)

    return results
