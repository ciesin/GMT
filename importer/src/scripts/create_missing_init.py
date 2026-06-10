import os
from pathlib import Path


def create_init_files(base_dir: str) -> None:
    """
    Recursively create __init__.py in directories that don't already have it.

    Args:
        base_dir (str): The base directory to start scanning.
    """
    for root, dirs, files in os.walk(base_dir):
        # Check if __init__.py already exists in the current directory
        if Path(root).name in ("python_src", "aopt", ".vscode", "__pycache__"):
            continue

        if ".mypy_cache" in root:
            continue

        if ".pytest_cache" in root:
            continue

        if "__init__.py" not in files:
            init_path = os.path.join(root, "__init__.py")
            with open(init_path, "w") as _f:
                # Create an empty __init__.py file
                pass
            print(f"Created: {init_path}")


if __name__ == "__main__":
    base_directory = "/src/modules"

    if os.path.isdir(base_directory):
        create_init_files(base_directory)
        print("Finished creating __init__.py files.")
    else:
        print(f"Error: {base_directory} is not a valid directory.")
