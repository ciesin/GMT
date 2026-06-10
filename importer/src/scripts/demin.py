import sys
from pathlib import Path


import re
from typing import Tuple, List


def parse_stack_trace(trace: str) -> List[Tuple[str, int,int]]:
    pattern = re.compile(
        r"""
        at\s+                      # "at" followed by space(s)
        (?P<function>[^\(]+)       # function name (anything except open parenthesis)
        \s+\(                      # space and open parenthesis
        (?P<location>[^)]+)   
                     # char (column) number after second colon
        \)                         # closing parenthesis
    """,
        re.VERBOSE | re.DOTALL,
    )

    results = []
    for match in pattern.finditer(trace):
        desc = match.group('function').strip()
        location = match.group('location')

        loc_split = location.split(':')

        if len(loc_split) >= 2:
            line_num = int(loc_split[-2])
            char_num = int(loc_split[-1])
        else:
            line_num = -1
            char_num = -1
        results.append((desc, line_num, char_num))

    return results

def main():

    # minified_path = Path("/data/training.js")
    minified_path = Path("/data/main.ddc691e1f0625f8a.js")
    # formatted_path = Path("/data/training2.js")

    stack_trace = """
value@https://gts.health/main.ddc691e1f0625f8a.js:629:2204448 value@https://gts.health/main.ddc691e1f0625f8a.js:629:2202024 value@https://gts.health/main.ddc691e1f0625f8a.js:629:2262356 updateTimelineRangeAccordingToFilters@https://gts.health/main.ddc691e1f0625f8a.js:629:229356 3132/ngOnInit/<@https://gts.health/main.ddc691e1f0625f8a.js:629:227644 next@https://gts.health/main.ddc691e1f0625f8a.js:629:1642539 _next@https://gts.health/main.ddc691e1f0625f8a.js:629:1642206 next@https://gts.health/main.ddc691e1f0625f8a.js:629:1641891 3132/To/</<@https://gts.health/main.ddc691e1f0625f8a.js:1:42131 4360/L/this._next<@https://gts.health/main.ddc691e1f0625f8a.js:629:1649123 next@https://gts.health/main.ddc691e1f0625f8a.js:629:1641891 1413/next/<@https://gts.health/main.ddc691e1f0625f8a.js:629:1639738 L@https://gts.health/main.ddc691e1f0625f8a.js:629:1653477 next@https://gts.health/main.ddc691e1f0625f8a.js:629:1639575 next@https://gts.health/main.ddc691e1f0625f8a.js:629:1637868 Bg@https://gts.health/main.ddc691e1f0625f8a.js:1:287124 activate@https://gts.health/main.ddc691e1f0625f8a.js:1:293869 3132/setupNavigations/</<@https://gts.health/main.ddc691e1f0625f8a.js:1:319204 6354/L/</<@https://gts.health/main.ddc691e1f0625f8a.js:629:1650171 4360/L/this._next<@https://gts.health/main.ddc691e1f0625f8a.js:629:1649123 next@https://gts.health/main.ddc691e1f0625f8a.js:629:1641891 3132/Qi/</<@https://gts.health/main.ddc691e1f0625f8a.js:1:42561 4360/L/this._next<@https://gts.health/main.ddc691e1f0625f8a.js:629:1649123 next@https://gts.health/main.ddc691e1f0625f8a.js:629:1641891 6354/L/</<@https://gts.health/main.ddc691e1f0625f8a.js:629:1650164 4360/L/this._next<@https://gts.health/main.ddc691e1f0625f8a.js:629:1649123 next@https://gts.health/main.ddc691e1f0625f8a.js:629:1641891 5558/F/</</Te<@https://gts.health/main.ddc691e1f0625f8a.js:629:1651557 4360/L/this._next<@https://gts.health/main.ddc691e1f0625f8a.js:629:1649123 next@https://gts.health/main.ddc691e1f0625f8a.js:629:1641891 8750/Pe/<@https://gts.health/main.ddc691e1f0625f8a.js:629:1647911 _trySubscribe@https://gts.health/main.ddc691e1f0625f8a.js:629:1638509 1985/subscribe/<@https://gts.health/main.ddc691e1f0625f8a.js:629:1638451 L@https://gts.health/main.ddc691e1f0625f8a.js:629:1653477 subscribe@https://gts.health/main.ddc691e1f0625f8a.js:629:1638358 5558/F/</<@https://gts.health/main.ddc691e1f0625f8a.js:629:1651526 4360/L/this._next<@https://gts.health/main.ddc691e1f0625f8a.js:629:1649123 next@https://gts.health/main.ddc691e1f0625f8a.js:629:1641891 5558/F/</</Te<@https://gts.health/main.ddc691e1f0625f8a.js:629:1651557 4360/L/this._next<@https://gts.health/main.ddc691e1f0625f8a.js:629:1649123 next@https://gts.health/main.ddc691e1f0625f8a.js:629:1641891 6354/L/</<@https://gts.health/main.ddc691e1f0625f8a.js:629:1650164 4360/L/this._next<@https://gts.health/main.ddc691e1f0625f8a.js:629:1649123 next@https://gts.health/main.ddc691e1f0625f8a.js:629:1641891 8750/Pe/<@https://gts.health/main.ddc691e1f0625f8a.js:629:1647911 _trySubscribe@https://gts.health/main.ddc691e1f0625f8a.js:629:1638509 1985/subscribe/<@https://gts.health/main.ddc691e1f0625f8a.js:629:1638451 L@https://gts.health/main.ddc691e1f0625f8a.js:629:1653477 subscribe@https://gts.health/main.ddc691e1f0625f8a.js:629:1638358 6354/L/<@https://gts.health/main.ddc691e1f0625f8a.js:629:1650137 9974/L/</<@https://gts.health/main.ddc691e1f0625f8a.js:629:1655164 1985/subscribe/<@https://gts.health/main.ddc691e1f0625f8a.js:629:1638411 L@https://gts.health/main.ddc691e1f0625f8a.js:629:1653477 subscribe@https://gts.health/main.ddc691e1f0625f8a.js:629:1638358 5558/F/</<@https://gts.health/main.ddc691e1f0625f8a.js:629:1651526 4360/L/this._next<@https://gts.health/main.ddc691e1f0625f8a.js:629:1649123 next@https://gts.health/main.ddc691e1f0625f8a.js:629:1641891 5558/F/</</Te<@https://gts.health/main.ddc691e1f0625f8a.js:629:1651557 4360/L/this._next<@https://gts.health/main.ddc691e1f0625f8a.js:629:1649123 next@https://gts.health/main.ddc691e1f0625f8a.js:629:1641891 6354/L/</<@https://gts.health/main.ddc691e1f0625f8a.js:629:1650164 4360/L/this._next<@https://gts.health/main.ddc691e1f0625f8a.js:629:1649123 next@https://gts.health/main.ddc691e1f0625f8a.js:629:1641891 3132/ks/</<@https://gts.health/main.ddc691e1f0625f8a.js:1:42288 4360/L/this._next<@https://gts.health/main.ddc691e1f0625f8a.js:629:1649123 next@https://gts.health/main.ddc691e1f0625f8a.js:629:1641891 3132/hT/</<@https://gts.health/main.ddc691e1f0625f8a.js:1:264656 4360/L/this._complete<@https://gts.health/main.ddc691e1f0625f8a.js:629:1649299 complete@https://gts.health/main.ddc691e1f0625f8a.js:629:1642077 8750/Pe/<@https://gts.health/main.ddc691e1f0625f8a.js:629:1647927 _trySubscribe@https://gts.health/main.ddc691e1f0625f8a.js:629:1638509 1985/subscribe/<@https://gts.health/main.ddc691e1f0625f8a.js:629:1638451 L@https://gts.health/main.ddc691e1f0625f8a.js:629:1653477 subscribe@https://gts.health/main.ddc691e1f0625f8a.js:629:1638358 3132/hT/<@https://gts.health/main.ddc691e1f0625f8a.js:1:264605 9974/L/</<@https://gts.health/main.ddc691e1f0625f8a.js:629:1655164 1985/subscribe/<@https://gts.health/main.ddc691e1f0625f8a.js:629:1638411 L@https://gts.health/main.ddc691e1f0625f8a.js:629:1653477 subscribe@https://gts.health/main.ddc691e1f0625f8a.js:629:1638358 3132/ks/<@https://gts.health/main.ddc691e1f0625f8a.js:1:42252 9974/L/</<@https://gts.health/main.ddc691e1f0625f8a.js:629:1655164 1985/subscribe/<@https://gts.health/main.ddc691e1f0625f8a.js:629:1638411 L@https://gts.health/main.ddc691e1f0625f8a.js:629:1653477 subscribe@https://gts.health/main.ddc691e1f0625f8a.js:629:1638358 6354/L/<@https://gts.health/main.ddc691e1f0625f8a.js:629:1650137 9974/L/</<@https://gts.health/main.ddc691e1f0625f8a.js:629:1655164 1985/subscribe/<@https://gts.health/main.ddc691e1f0625f8a.js:629:1638411 L@https://gts.health/main.ddc691e1f0625f8a.js:629:1653477 subscribe@https://gts.health/main.ddc691e1f0625f8a.js:629:1638358 5558/F/</<@https://gts.health/main.ddc691e1f0625f8a.js:629:1651526 4360/L/this._next<@https://gts.health/main.ddc691e1f0625f8a.js:629:1649123 next@https://gts.health/main.ddc691e1f0625f8a.js:629:1641891 5558/F/</</Te<@https://gts.health/main.ddc691e1f0625f8a.js:629:1651557 4360/L/this._next<@https://gts.health/main.ddc691e1f0625f8a.js:629:1649123 next@https://gts.health/main.ddc691e1f0625f8a.js:629:1641891 6354/L/</<@https://gts.health/main.ddc691e1f0625f8a.js:629:1650164 4360/L/this._next<@https://gts.health/main.ddc691e1f0625f8a.js:629:1649123 next@https://gts.health/main.ddc691e1f0625f8a.js:629:1641891 3132/Qi/</<@https://gts.health/main.ddc691e1f0625f8a.js:1:42561 4360/L/this._next<@https://gts.health/main.ddc691e1f0625f8a.js:629:1649123 next@https://gts.health/main.ddc691e1f0625f8a.js:629:1641891 5558/F/</</Te<@https://gts.health/main.ddc691e1f0625f8a.js:629:1651557 4360/L/this._next<@https://gts.health/main.ddc691e1f0625f8a.js:629:1649123 next@https://gts.health/main.ddc691e1f0625f8a.js:629:1641891 3132/Qi/</<@https://gts.health/main.ddc691e1f0625f8a.js:1:42561 4360/L/this._next<@https://gts.health/main.ddc691e1f0625f8a.js:629:1649123 next@https://gts.health/main.ddc691e1f0625f8a.js:629:1641891 1397/oe/</Mt/<@https://gts.health/main.ddc691e1f0625f8a.js:629:1650741 4360/L/this._next<@https://gts.health/main.ddc691e1f0625f8a.js:629:1649123 next@https://gts.health/main.ddc691e1f0625f8a.js:629:1641891 1397/oe/</Mt/<@https://gts.health/main.ddc691e1f0625f8a.js:629:1650741 4360/L/this._next<@https://gts.health/main.ddc691e1f0625f8a.js:629:1649123 next@https://gts.health/main.ddc691e1f0625f8a.js:629:1641891 8750/Pe/<@https://gts.health/main.ddc691e1f0625f8a.js:629:1647911 _trySubscribe@https://gts.health/main.ddc691e1f0625f8a.js:629:1638509 1985/subscribe/<@https://gts.health/main.ddc691e1f0625f8a.js:629:1638451 L@https://gts.health/main.ddc691e1f0625f8a.js:629:1653477 subscribe@https://gts.health/main.ddc691e1f0625f8a.js:629:1638358 Mt@https://gts.health/main.ddc691e1f0625f8a.js:629:1650693 et@https://gts.health/main.ddc691e1f0625f8a.js:629:1650613 4360/L/this._next<@https://gts.health/main.ddc691e1f0625f8a.js:629:1649123 next@https://gts.health/main.ddc691e1f0625f8a.js:629:1641891 3132/Dy/</<@https://gts.health/main.ddc691e1f0625f8a.js:1:265512 4360/L/this._complete<@https://gts.health/main.ddc691e1f0625f8a.js:629:1649299 complete@https://gts.health/main.ddc691e1f0625f8a.js:629:1642077 3132/Qi/</<@https://gts.health/main.ddc691e1f0625f8a.js:1:42633 4360/L/this._complete<@https://gts.health/main.ddc691e1f0625f8a.js:629:1649299 complete@https://gts.health/main.ddc691e1f0625f8a.js:629:1642077


    """

    line_char_list = parse_stack_trace(stack_trace)

    # for (desc, line_num, char_num) in line_char_list:
    #     print(f"{desc} --> {line_num}:{char_num}")



    with open(minified_path, 'r', encoding='utf-8') as f:
        min_str = f.read()

    non_ascii = [ch for ch in min_str if ord(ch) > 127]
    print(f"Non-ASCII chars: {non_ascii[:10]}")
    print(f"Total non-ASCII chars: {len(non_ascii)}")

    with open(minified_path, 'r', encoding='utf-8') as f:

        lines = f.readlines()  # split by line

    context_before = 0
    context_after = 100
    for desc, line_num, target_char in line_char_list:

        line = lines[line_num-1]
        snippet = line[max(0, target_char-1-context_before): target_char + context_after]

        print(f"{desc} --> {line_num}:{target_char}\nSNIPPET: {snippet}\n")

    # # Step 3: Read formatted file
    # with open(formatted_path, 'r', encoding='utf-8') as f:
    #     formatted_lines = f.readlines()
    #
    # # Step 4: Search for matching snippet
    # for i, f_line in enumerate(formatted_lines):
    #     if snippet.strip() in f_line:
    #         print(f"✅ Match found in formatted file at line {i + 1}")
    #         print(f"Line content: {f_line.strip()}")
    #         return
    #
    # print("❌ No match found in the formatted file.")

main()