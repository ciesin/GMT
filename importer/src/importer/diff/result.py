from dataclasses import dataclass


@dataclass
class DiffResult:
    """
    Class to capture result of a thread processing a diff
    """
    output: str
    # markdown link, sanitized.  Used for TOC
    attributes_anchor: str = None
    attributes_equal: bool = None

    # markdown link, sanitized.  Used for TOC
    shape_anchor: str = None
    shape_equal: bool = None

    new_anchor: str = None
    is_new: bool = None

    deleted_anchor: str = None
    is_deleted: bool = None

    is_error: bool = False
    id: str = None

    feature_label: str = None