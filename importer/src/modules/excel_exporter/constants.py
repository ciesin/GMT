from enum import StrEnum
from typing import Union, Optional, Protocol


class SheetNames(StrEnum):
    OVERVIEW = "GMT - Overview"
    HF = "GMT - HFs"
    STL = "GMT - STLs"
    CI = "GMT - Catchments"
    HF_CATCHMENTS = "HF_catchments"


class HeaderNames(StrEnum):
    POP_GIS = "POP GIS"


REW_FONT_NAME = "Calibri"


class MypyExcelFormat(Protocol):
    def set_left(self, width: int) -> None: ...
    def set_right(self, width: int) -> None: ...
    def set_top(self, width: int) -> None: ...
    def set_bottom(self, width: int) -> None: ...
    def set_border(self, style: int) -> None: ...
    def set_text_wrap(self) -> None: ...
    def set_num_format(self, format_string: str) -> None: ...


class MypyWorksheet(Protocol):
    def merge_range(
        self, start_row: int, start_col: int, stop_row: int, stop_col: int, data: str
    ) -> int: ...

    def write(
        self,
        start_row: int,
        start_col: int,
        data: Union[str, int],
        format: Optional[MypyExcelFormat] = None,
    ) -> None: ...

    def write_string(
        self,
        start_row: int,
        start_col: int,
        data: str,
        format: Optional[MypyExcelFormat] = None,
    ) -> int: ...

    def set_column(
        self,
        start_row: int,
        start_col: int,
        width: float,
        format: Optional[MypyExcelFormat] = None,
    ) -> int: ...

    def autofit(
        self,
        max_width: Optional[float] = None,
    ) -> None: ...

    def autofilter(
        self, start_row: int, start_col: int, stop_row: int, stop_col: int
    ) -> None: ...
