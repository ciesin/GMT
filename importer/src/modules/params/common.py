from typing import Annotated
from pydantic import StringConstraints


EnvVariableKey = Annotated[
    str,
    StringConstraints(
        pattern=r"^[A-Z][A-Z0-9_]*$",
        min_length=1,
    ),
]

NoWhiteSpace = Annotated[
    str,
    StringConstraints(
        pattern=r"^\S+$",
        min_length=1,
    ),
]
