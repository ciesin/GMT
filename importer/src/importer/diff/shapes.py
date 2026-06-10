import logging
from typing import List, Tuple, Union, Optional

from shapely.geometry.base import BaseGeometry

log = logging.getLogger(__name__)
trace_log = logging.getLogger("trace." + __name__)


class ShapeBounds:
    BUFFER = 0.0005

    def __init__(self, shapes: Union[List[BaseGeometry], Tuple[Optional[BaseGeometry]]]):
        """

        :param shapes: shapes should be in 4326 projection.  Size==2, left & right
        """
        if shapes[0] is not None:
            bounds_obj = shapes[0].bounds
        else:
            bounds_obj = shapes[1].bounds

        if len(bounds_obj) == 4:
            w, s, e, n = bounds_obj
        else:
            w, s, e, n = [0] * 4

        if len(shapes) < 2 or len(shapes[1].bounds) != 4:
            w2, s2, e2, n2 = w, s, e, n
        else:
            w2, s2, e2, n2 = shapes[1].bounds

        buffer = 0.0005
        w = min(w, w2) - buffer
        s = min(s, s2) - buffer
        e = max(e, e2) + buffer
        n = max(n, n2) + buffer
        trace_log.debug(f"Bounds {w}, {s}, {e}, {n}")

        # make it a square
        height = n - s
        width = e - w

        if height > width:
            half_diff = (height - width) / 2
            e += half_diff
            w -= half_diff
        elif width > height:
            half_diff = (width - height) / 2
            n += half_diff
            s -= half_diff

        self.wsen = (w, s, e, n)
        self.wesn = (w, e, s, n)
