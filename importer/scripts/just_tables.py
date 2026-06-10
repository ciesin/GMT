import re

samples = []

r = re.compile(r"""
        (CREATE\ TABLE.*?;)
        """,
re.VERBOSE | re.MULTILINE | re.DOTALL
               )

with open('/data/schema.sql', "r") as myfile:
    text = myfile.read()

print(f"Len of text {len(text)}")
# print('SAMPLES: ', samples)

with open("/data/tables.sql", "w") as myfile2:
    for s in r.finditer(text):
        myfile2.write(s.group(0))
        myfile2.write("\n" * 2)