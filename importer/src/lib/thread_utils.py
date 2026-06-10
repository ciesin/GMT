# coding=utf-8
import shlex
import subprocess
import threading
import signal
import logging
import multiprocessing
import queue
import time
import sys
import os
from typing import Union, Tuple, Dict

import psycopg2.extensions

log = logging.getLogger(__name__)

trace_log = logging.getLogger("trace." + __name__ )

#trace_log.setLevel(logging.CRITICAL)


class InlineExector():
    """
    A drop in replacements for concurrent.futures.ProcessPoolExecutor that
    just executes in the current process/thread
    """
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        pass

    def map(self, f, f_args):
        ret_vals = []
        for func_arguments in f_args:
            #print(func_arguments)
            ret_vals.append(f(func_arguments))

        return ret_vals


def run_process(
        cmd_line, env_override: Dict[str, str] = None, throw_on_error_code=True,
        throw_on_stderr=False,
        cwd=None) -> Union[str, Tuple[int,str,str]]:
    kw_args = {}
    if env_override is not None:
        my_env = os.environ.copy()
        my_env.update(env_override)
        kw_args["env"] = my_env

    trace_log.debug(f"Running: {shlex.split(cmd_line)}")

    if cwd is not None:
        kw_args['cwd'] = cwd

    trace_log.debug(f"with kwargs: {kw_args}")

    # noinspection PyArgumentList
    p = subprocess.Popen(shlex.split(cmd_line), stderr=subprocess.PIPE,
                         encoding="utf-8",
                         stdout=subprocess.PIPE, shell=False,
                         **kw_args)
    output, errors = p.communicate()

    trace_log.debug(output)
    trace_log.debug(errors)

    if (throw_on_stderr and errors) or (throw_on_error_code and p.returncode != 0):
        err_msg = f"Errors {p.returncode} with command line:\n" \
                  f"{cmd_line if isinstance(cmd_line, str) else subprocess.list2cmdline(cmd_line)}\n" \
                  f"StdOut:{output}\nStdErr:\n{errors}"
        if throw_on_error_code:
            raise Exception(err_msg)
        else:
            log.warning(err_msg)

    if not throw_on_error_code:
        return p.returncode, output, errors

    return output


def run_process_stream_output(
        cmd_line, env_override: Dict[str, str] = None,
                throw_on_error=True, cwd = None,
        expected_return_code = 0) -> int:
    kw_args = {}
    if env_override is not None:
        my_env = os.environ.copy()
        my_env.update(env_override)
        kw_args["env"] = my_env

    #log.info(f"""Running: {cmd_line}\n in dir "{cwd}" """)

    if cwd is not None:
        kw_args['cwd'] = cwd

    # noinspection PyArgumentList
    p = subprocess.Popen(cmd_line,
                         # encoding = "utf-8",
                         stderr = subprocess.STDOUT,
                         stdout = subprocess.PIPE,
                         shell = True,
                         **kw_args)
    # output, errors = p.communicate()

    output = ""

    for line in iter(p.stdout.readline, b''):
        decoded_line = line.decode(sys.stdout.encoding)
        sys.stdout.write(decoded_line)
        sys.stdout.flush()
        output = output + decoded_line

    p.wait()

    #trace_log.info(f"Return code is {p.returncode}")

    if expected_return_code is not None and p.returncode != expected_return_code:
        err_msg = f"Errors with command line:\n{cmd_line}\nExpected return code: {expected_return_code} Return Code: {p.returncode}Output: {output}"
        if throw_on_error:
            raise Exception(err_msg)
        else:
            log.warning(err_msg)

    return p.returncode



def finish_database_threads(cfg, task_queue,
            max_num_processes = 8, num_items_in_queue = None,
                            ):
    from lib.db_utils import create_db_connection

    def create_database_connection(threadIndex):
        pyConn = create_db_connection(cfg, )

        pyConn.set_isolation_level(psycopg2.extensions.ISOLATION_LEVEL_AUTOCOMMIT)

        return {
            'connection': pyConn
        }

    def cleanup(context):
        print("\n!!\nCleaning up!\n\n")
        context['connection'].close()

    return finish_threads_with_context(task_queue = task_queue,
                                       fn_context_create= create_database_connection,
                                       max_num_processes = max_num_processes,
                                       num_items_in_queue= num_items_in_queue,
                                       fn_cleanup=cleanup
                                       )

def finish_threads_with_context(task_queue, fn_context_create, max_num_processes = 8, num_items_in_queue = None, fn_cleanup = None):
    """
    Loops through, handles ctrl+c to close connections properly
    """
    threadList = []

    def signal_handler(p_signal, p_frame):
        print('You pressed Ctrl+C!, processes will close once they are done')

        sys.exit(0)

    signal.signal(signal.SIGINT, signal_handler)

    nItemsInQueue = task_queue.qsize()

    # Use passed in value if available as qsize is not necesarily correct
    if num_items_in_queue is not None:
        nItemsInQueue = num_items_in_queue

        max_num_processes = min(max_num_processes, num_items_in_queue)

    NUMBER_OF_PROCESSES = multiprocessing.cpu_count()
    NUMBER_OF_PROCESSES = min(NUMBER_OF_PROCESSES, max_num_processes)

    log.debug("# of threads: %i" % NUMBER_OF_PROCESSES)

    sharedCounterObj = Counter(start = 0)

    for i in range(NUMBER_OF_PROCESSES):
        contextObj = None

        if fn_context_create is not None:
            contextObj = fn_context_create(i)

        p = NormalConsumer(task_queue,
                           totalItemsInQueue = nItemsInQueue,
                           counterObj = sharedCounterObj,
                           idx = i,
                           contextObj = contextObj,
                           fn_cleanup=fn_cleanup
                           )
        threadList.append(p)
        p.start()

    # Wait for threads to finish, listen for Ctrl+C without blocking
    while threading.active_count() > 1:
        time.sleep(0.1)

    for threadObj in threadList:
        if threadObj.exceptionThrown is not None:
            raise threadObj.exceptionThrown

class NormalConsumer(threading.Thread):
    """
    Extends thread to consume normal query tasks
    """

    def __init__(self, task_queue, counterObj, idx = -1, totalItemsInQueue = -1, contextObj = None, fn_cleanup = None):
        # print("Consumer Init")
        # Call base constructor
        super(NormalConsumer, self).__init__()

        self.task_queue = task_queue
        self.idx = idx
        self.totalItemsInQueue = totalItemsInQueue
        self.counter = counterObj
        self.fn_cleanup = fn_cleanup

        self.exceptionThrown = None

        self.context = contextObj

    def run(self):
        # print("Consumer run")

        initialSize = self.totalItemsInQueue
        start = time.time()
        locallyProcessedItems = 0
        lastElapsedSeconds = 0
        # print("\nStarting thread %i.  Processing %i items\n" % (self.idx, initialSize))

        try:
            while True:
                next_task = self.task_queue.get_nowait()
                if next_task is None:
                    # print 'Tasks Complete'
                    self.task_queue.task_done()
                    break
                if self.context:
                    # If we have custom / shared state to pass to the thread,
                    # this will explode the dictionary to named arguments
                    # ie if self.context = {'a': 1, 'b': 37.2} it will be as if
                    # we called next_task(a=1, b=37,2)
                    next_task(**self.context)
                else:
                    next_task()

                self.task_queue.task_done()

                locallyProcessedItems += 1
                self.counter.increment()

                # Use our threadsafe counter to know exactly how many items were processed
                processedItems = self.counter.value
                end = time.time()

                elapsedSeconds = end - start

                # throttle output because of https://github.com/docker/for-win/issues/199
                if elapsedSeconds - lastElapsedSeconds > 2:
                    lastElapsedSeconds = elapsedSeconds
                    estimatedTotalTime = elapsedSeconds * initialSize / processedItems

                    remainingTime = estimatedTotalTime - elapsedSeconds
                    try:
                        if False:
                            print(
                            ("\nIn thread %i.  Processed %i of %i items.  "
                            "Locally processed %i items"
                            "\n\tElapsed time: %s"
                            "\n\tEst. Total Time: %s"
                            "\n\tRemaining Time: %s") % (
                                self.idx,
                                processedItems,
                                initialSize,
                                locallyProcessedItems,
                                format_seconds(elapsedSeconds),
                                format_seconds(estimatedTotalTime),
                                format_seconds(remainingTime)
                            ))
                    except IOError:
                        log.warning("Odd IOError in print")
                        # don't rerease
        # self.result_queue.put(answer)
        except queue.Empty:
            if self.fn_cleanup is not None:
                self.fn_cleanup(self.context)

        except Exception as ex:
            log.warning("Unexpected exception: %s" % ex)
            log.exception(ex)
            # We want to save this so the main thread knows there was a problem
            self.exceptionThrown = ex
        return


class Counter(object):
    def __init__(self, start = 0):
        self.lock = threading.Lock()
        self.value = start

    def increment(self):
        self.lock.acquire()
        try:
            self.value = self.value + 1
        finally:
            self.lock.release()


def format_seconds(seconds):

    if not seconds or not isinstance(seconds, float):
        return "N/A"

    m, s = divmod(seconds, 60)
    h, m = divmod(m, 60)
    return "%dh:%02dm:%02ds" % (h, m, s)