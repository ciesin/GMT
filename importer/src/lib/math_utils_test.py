from lib.math_utils import ceil_div, int_chunk_iterator


def test_ceildiv():

    assert 3 == ceil_div(12, 5)
    assert -2 == ceil_div(-12, 5)


def test_int_chunk_iterator():

    assert list(int_chunk_iterator(1, 4, 10)) == [(1, 4)]

    assert list(int_chunk_iterator(1, 4, 2)) == [(1, 2), (3, 4)]

    assert list(int_chunk_iterator(1, 4, 1)) == [(1, 1), (2, 2), (3, 3), (4, 4)]

    assert list(int_chunk_iterator(1, 5, 3)) == [(1, 3), (4, 5)]

    assert list(int_chunk_iterator(-1, 4, 3)) == [(-1, 1), (2, 4)]

    assert list(int_chunk_iterator(-1, 5, 3)) == [(-1, 1), (2, 4), (5, 5)]