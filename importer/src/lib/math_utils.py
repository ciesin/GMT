

def ceil_div(a, b):
    return -(-a // b)


def int_chunk_iterator(start, stop, chunk_size):
    """
    Returns an iterator of [chunk_start,chunk_stop]

    Example: chunk_iterator(1,7, 3) would return
    [1,3], [4, 6], [7, 7]
    :param start: inclusive beginning
    :param stop: inclusive ending
    :param chunk_size:
    :return:
    """

    assert chunk_size > 0

    for chunk_start in range(start, stop+1, chunk_size):

        chunk_stop = min(chunk_start+chunk_size-1, stop)

        yield (chunk_start, chunk_stop)


