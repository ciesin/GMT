# coding=utf-8

import logging
import inspect

from lib import file_utils, logger_utils, email_utils, geo_db_utils, db_utils
import sys
import time
import os
import re


log = logging.getLogger(__name__)


def format_seconds(seconds):
    m, s = divmod(seconds, 60)
    h, m = divmod(m, 60)
    return "%dh:%02dm:%02ds" % (h, m, s)



def run_gdm(cfg, gdm_func):
    # Init logger
    # log = logger_utils.InitLogger(cfg.LogPath)
    file_utils.mkdir_p(cfg.LogPath.parent)

    print("Saving log to %s" % cfg.LogPath)

    logger = logger_utils.init_log(log_name=None,
                             console_level = logging.DEBUG,
                             file_level = logging.DEBUG,
                             log_path = cfg.LogPath,
                             log_format_str = "%(asctime)s %(filename)s:%(lineno)d %(levelname)s %(name)s ==> %(message)s\n")

    # logging.getLogger('gts.postgis').setLevel(logging.WARNING)

    # Given script parameters
    start_step = int(sys.argv[1])

    try:
        end_step = int(sys.argv[2])
    except:
        end_step = start_step

    log.info('Start python script with parameters: ' + ' '.join(sys.argv))

    current_step_num = gdm_func(start_step, end_step)

    if current_step_num <= end_step:
        log.info("GDM finished running to stop step %s" % current_step_num)
        sys.exit(7)


DOC_GET_DESC_REGEX = re.compile(r"""
        ^
        (.*?)
        \s*
        \n
        \s*?
        (?:\n|\Z)    #A new line or end of string in non capturing groups  
        .*
        """, re.VERBOSE | re.DOTALL)


def run_step(cfg, current_step_num, start_step, stop_step, step_fn, util_cfg, step_desc = None):

    if step_fn.__doc__ is None:
        raise Exception(f"Need to document step #{current_step_num + 1}: {step_fn.__name__}")
    m = DOC_GET_DESC_REGEX.match(step_fn.__doc__)
    if m is None:
        raise Exception(f"Docstring did not match regex step #{current_step_num + 1}: {step_fn.__name__}")

    step_desc = DOC_GET_DESC_REGEX.match(step_fn.__doc__).group(1)
    current_step_num += 1

    if start_step <= current_step_num <= stop_step:

        if 'GDM_GENERATE_DOCS' in os.environ:
            cfg.DocFilePath = os.path.join(cfg.WORKING_FOLDER, 'doc.md')

            if current_step_num == 1:
                if os.path.isfile(cfg.DocFilePath):
                    os.remove(cfg.DocFilePath)

            with open(cfg.DocFilePath, "a") as myfile:
                # myfile.write("-" * 60 + "\n")

                step_name = ''.join([s.capitalize() for s in step_fn.__name__.replace('step_', '').split('_')])

                # markdown autonumbers
                myfile.write(f"1. **{step_name}**\n" )

                pdoc = step_fn.__doc__
                if pdoc is None:
                    pdoc = "TODO"

                pdoc = pdoc.replace('\t', '').strip()

                pdoc = '\n'.join(['     ' + s.strip() for s in pdoc.split('\n')])

                myfile.write("\n%s\n" % pdoc)

                return current_step_num

        fnData = inspect.signature(step_fn)

        start_msg = fr"""
------------------------------------------------------------
			{current_step_num} - {step_fn.__name__}: {step_desc} 
------------------------------------------------------------""" 

        log.info(start_msg);
        

        try:

            startTime = time.time()



            if "current_step_num" in fnData.parameters:
                step_fn(current_step_num)
            elif "conn" in fnData.parameters:

                conn = db_utils.create_db_connection(util_cfg)
                step_fn(conn)
                try:
                    conn.close()
                except Exception as ex:
                    log.info(f"Connection not closed: {ex}")

            else:
                step_fn()

            stepDurationSecs = time.time() - startTime

            completed_msg = "Completed Step #%s - %s in %s" % (
                    current_step_num,
                    step_desc,
                    format_seconds(stepDurationSecs))
            log.info(completed_msg)

        except Exception as e:
            log.error("Caught exception")

            log.exception(e)



            sys.exit(1)

    return current_step_num


def startSubStep(currentStepNum, currentSubSetNum, subStepDesc):
    currentSubSetNum += 1
    log.info("\t%i.%i :        %s" % (currentStepNum, currentSubSetNum, subStepDesc))

    return currentSubSetNum
