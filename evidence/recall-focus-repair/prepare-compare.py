# Prepare helper-only comparator without editing shared source.
from pathlib import Path
import subprocess, hashlib
root = Path(__file__).resolve().parents[2]
d = Path(__file__).resolve().parent
base = '65b9a6302bdfdb4daed8022f6220ee81f70aee3f'
def source(path):
    return subprocess.check_output(['git','show',f'{base}:{path}'],cwd=root,text=True)
helper, engine = source('src/recall-query.ts'), source('src/memory.ts')
(d/'baseline-query.ts').write_text(helper)
engine = engine.replace('"./','"../../src/')
(d/'baseline-memory.ts').write_text(engine.replace('../../src/recall-query.ts','./baseline-query.ts'))
(d/'corrected-memory.ts').write_text(engine)
(d/'engine-source.sha256').write_text(hashlib.sha256(source('src/memory.ts').encode()).hexdigest())
print('Prepared baseline and corrected helper-only modules; no data opened.')
